import {
  updateRoutingAttemptStatus,
  createRoutingAttempt,
  getMaxAttemptNumber,
} from "@/lib/supabase/queries/routing-attempts";
import { updateLeadStatus } from "@/lib/supabase/queries/leads";
import { getAgentById, getFrontlinesAgent } from "@/lib/supabase/queries/agents";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { supabase } from "@/lib/supabase/client";
import { notifyAcceptance } from "@/lib/zapier/notify-acceptance";
import {
  sendLeadNotification,
  sendFollowUp,
  sendMovedOn,
  sendDeclineAck,
  sendAcceptedNotification,
  sendManualFallbackNotification,
  sendUnclearResponseNotification,
} from "@/lib/twilio/send-sms";
import { selectNextAgent } from "./select-agent";
import { logger } from "@/lib/shared/logger";
import { ROUTING_TIMEOUT_MS, MAX_ESCALATION_ATTEMPTS } from "@/lib/shared/constants";
import type { Lead, RoutingAttempt } from "@/lib/supabase/types";
import type { AgentScore } from "@/lib/scoring/types";

function getExpiresAt(): string {
  return new Date(Date.now() + ROUTING_TIMEOUT_MS).toISOString();
}

/**
 * Start routing a lead to the best available agent.
 */
export async function startRouting(
  lead: Lead,
  locationName: string
): Promise<void> {
  const bestAgent = await selectNextAgent(lead, locationName);

  if (!bestAgent) {
    logger.warn("No agents available for routing", { leadId: lead.id });
    await handleManualFallback(lead);
    return;
  }

  await sendToAgent(lead, bestAgent, locationName);
}

/**
 * Send a lead notification to the selected agent and create a routing attempt.
 */
async function sendToAgent(
  lead: Lead,
  agentScore: AgentScore,
  locationName: string
): Promise<void> {
  const agent = await getAgentById(agentScore.agentId);
  if (!agent) {
    logger.error("Agent not found during routing", { agentId: agentScore.agentId });
    return;
  }

  const attemptNumber = (await getMaxAttemptNumber(lead.id)) + 1;

  if (attemptNumber > MAX_ESCALATION_ATTEMPTS) {
    await handleManualFallback(lead);
    return;
  }

  const messageSid = await sendLeadNotification(
    agent.phone,
    lead,
    locationName
  );

  await createRoutingAttempt({
    lead_id: lead.id,
    agent_id: agent.id,
    attempt_number: attemptNumber,
    status: "sms_sent",
    expires_at: getExpiresAt(),
    twilio_message_sid: messageSid,
    agent_response: null,
    score_snapshot: {
      total: agentScore.totalScore,
      factors: agentScore.factors,
    },
  });

  await updateLeadStatus(lead.id, "routing");

  await logAuditEvent("sms_sent", {
    leadId: lead.id,
    details: {
      agent_name: agent.name,
      agent_id: agent.id,
      attempt_number: attemptNumber,
      score: agentScore.totalScore,
      message_sid: messageSid,
    },
  });

  logger.info("Lead routed to agent", {
    leadId: lead.id,
    agentName: agent.name,
    attemptNumber,
    score: agentScore.totalScore,
  });
}

/**
 * Handle agent accepting a lead.
 */
export async function handleAcceptance(
  attempt: RoutingAttempt,
  lead: Lead,
  responseText: string
): Promise<void> {
  const agent = await getAgentById(attempt.agent_id);
  if (!agent) return;

  // Update routing attempt
  await updateRoutingAttemptStatus(attempt.id, "accepted", {
    agent_response: responseText,
    expires_at: null,
  });

  // Update lead status
  await updateLeadStatus(lead.id, "accepted", agent.id);

  // Increment monthly lead count via upsert
  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data: existing } = await supabase
    .from("monthly_lead_counts")
    .select("id, lead_count")
    .eq("agent_id", agent.id)
    .eq("year_month", yearMonth)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("monthly_lead_counts")
      .update({ lead_count: (existing.lead_count as number) + 1 })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("monthly_lead_counts")
      .insert({ agent_id: agent.id, year_month: yearMonth, lead_count: 1 });
  }

  // Notify frontlines
  const frontlinesAgent = await getFrontlinesAgent();
  const frontlinesPhone = frontlinesAgent?.phone ?? process.env.FRONTLINES_AGENT_PHONE;
  if (frontlinesPhone) {
    await sendAcceptedNotification(
      frontlinesPhone,
      agent.name,
      lead.first_name ?? "",
      lead.last_name ?? ""
    );
  }

  // Notify Zapier to update SF record owner
  if (lead.salesforce_record_id) {
    await notifyAcceptance({
      salesforce_record_id: lead.salesforce_record_id,
      agent_name: agent.name,
      agent_salesforce_user_id: agent.salesforce_user_id,
      lead_name: `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim(),
      accepted_at: new Date().toISOString(),
    });
  }

  await logAuditEvent("accepted", {
    leadId: lead.id,
    routingAttemptId: attempt.id,
    details: { agent_name: agent.name, response: responseText },
  });

  logger.info("Lead accepted by agent", {
    leadId: lead.id,
    agentName: agent.name,
  });
}

/**
 * Handle agent declining a lead.
 */
export async function handleDecline(
  attempt: RoutingAttempt,
  lead: Lead,
  locationName: string,
  responseText: string
): Promise<void> {
  const agent = await getAgentById(attempt.agent_id);
  if (!agent) return;

  // Update routing attempt
  await updateRoutingAttemptStatus(attempt.id, "declined", {
    agent_response: responseText,
    expires_at: null,
  });

  // Send acknowledgment
  await sendDeclineAck(agent.phone);

  await logAuditEvent("declined", {
    leadId: lead.id,
    routingAttemptId: attempt.id,
    details: { agent_name: agent.name, response: responseText },
  });

  logger.info("Lead declined by agent, escalating", {
    leadId: lead.id,
    agentName: agent.name,
  });

  // Immediately select next agent
  const nextAgent = await selectNextAgent(lead, locationName);
  if (nextAgent) {
    await sendToAgent(lead, nextAgent, locationName);
  } else {
    await handleManualFallback(lead);
  }
}

/**
 * Handle unclear response from agent.
 */
export async function handleUnclearResponse(
  attempt: RoutingAttempt,
  lead: Lead,
  responseText: string
): Promise<void> {
  const agent = await getAgentById(attempt.agent_id);
  if (!agent) return;

  // Forward to frontlines for manual interpretation
  const frontlinesAgent = await getFrontlinesAgent();
  const frontlinesPhone = frontlinesAgent?.phone ?? process.env.FRONTLINES_AGENT_PHONE;
  if (frontlinesPhone) {
    await sendUnclearResponseNotification(
      frontlinesPhone,
      agent.name,
      responseText,
      lead.first_name ?? "",
      lead.last_name ?? ""
    );
  }

  // Keep the timeout running - frontlines can intervene manually
  await logAuditEvent("sms_received", {
    leadId: lead.id,
    routingAttemptId: attempt.id,
    details: {
      agent_name: agent.name,
      response: responseText,
      classification: "unclear",
    },
  });
}

/**
 * Handle first timeout (send follow-up).
 */
export async function handleFirstTimeout(
  attempt: RoutingAttempt
): Promise<void> {
  const agent = await getAgentById(attempt.agent_id);
  if (!agent) return;

  const messageSid = await sendFollowUp(agent.phone);

  await updateRoutingAttemptStatus(attempt.id, "followup_sent", {
    expires_at: getExpiresAt(),
    twilio_message_sid: messageSid,
  });

  await logAuditEvent("followup_sent", {
    leadId: attempt.lead_id,
    routingAttemptId: attempt.id,
    details: { agent_name: agent.name, message_sid: messageSid },
  });

  logger.info("Follow-up sent to agent", {
    leadId: attempt.lead_id,
    agentName: agent.name,
  });
}

/**
 * Handle second timeout (moved on, escalate to next agent).
 */
export async function handleSecondTimeout(
  attempt: RoutingAttempt,
  lead: Lead,
  locationName: string
): Promise<void> {
  const agent = await getAgentById(attempt.agent_id);
  if (!agent) return;

  await sendMovedOn(agent.phone);

  await updateRoutingAttemptStatus(attempt.id, "timed_out", {
    expires_at: null,
  });

  await logAuditEvent("escalated", {
    leadId: lead.id,
    routingAttemptId: attempt.id,
    details: { agent_name: agent.name, reason: "second_timeout" },
  });

  logger.info("Agent timed out twice, escalating", {
    leadId: lead.id,
    agentName: agent.name,
  });

  // Select next agent
  const nextAgent = await selectNextAgent(lead, locationName);
  if (nextAgent) {
    await sendToAgent(lead, nextAgent, locationName);
  } else {
    await handleManualFallback(lead);
  }
}

/**
 * Handle manual fallback (all agents exhausted).
 */
async function handleManualFallback(lead: Lead): Promise<void> {
  await updateLeadStatus(lead.id, "manual");

  const frontlinesAgent = await getFrontlinesAgent();
  const frontlinesPhone = frontlinesAgent?.phone ?? process.env.FRONTLINES_AGENT_PHONE;
  if (frontlinesPhone) {
    await sendManualFallbackNotification(
      frontlinesPhone,
      lead.first_name ?? "",
      lead.last_name ?? ""
    );
  }

  await logAuditEvent("manual_fallback", {
    leadId: lead.id,
    details: { reason: "all_agents_exhausted" },
  });

  logger.warn("Manual fallback triggered", { leadId: lead.id });
}
