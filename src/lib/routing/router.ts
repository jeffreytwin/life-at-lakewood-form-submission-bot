import { supabase } from "@/lib/supabase/client";
import {
  createLead,
  checkDuplicateLead,
  updateLeadStatus,
  findAssignedLeadForRecord,
} from "@/lib/supabase/queries/leads";
import {
  getFrontlinesAgent,
  getAgentBySalesforceUserId,
  getAgentById,
} from "@/lib/supabase/queries/agents";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { sendOwnedByNotification, sendExistingOwnerNotification } from "@/lib/twilio/send-sms";
import { getQuietHoursSettings, isInQuietHours, getEffectiveQuietHoursEnd } from "./quiet-hours";
import { startRouting } from "./state-machine";
import { logger } from "@/lib/shared/logger";
import { isUniqueViolation } from "@/lib/shared/errors";
import type { ZapierPayload } from "@/lib/shared/validation/zapier-payload";
import type { Agent, Lead } from "@/lib/supabase/types";

/**
 * Main entry point: route a lead from a Zapier webhook payload.
 */
export async function routeLead(payload: ZapierPayload): Promise<{
  status: string;
  leadId: string;
}> {
  // De-duplication check
  if (payload.salesforce_record_id) {
    const isDuplicate = await checkDuplicateLead(payload.salesforce_record_id);
    if (isDuplicate) {
      logger.info("Duplicate webhook received, skipping", {
        salesforce_record_id: payload.salesforce_record_id,
      });
      return { status: "duplicate", leadId: "" };
    }
  }

  // Resolve location
  const { data: location } = await supabase
    .from("locations")
    .select("*")
    .eq("name", payload.location)
    .single();

  // Stamp whether this lead arrived during quiet hours (immutable snapshot)
  const quietHours = await getQuietHoursSettings();
  const effectiveEnd = getEffectiveQuietHoursEnd(quietHours);
  const arrivedDuringQuietHours =
    quietHours.quiet_hours_enabled &&
    isInQuietHours(quietHours.quiet_hours_start, effectiveEnd);

  // Create lead record. The partial unique index on active leads per
  // Salesforce record is the last line of defence behind the duplicate read
  // above: two webhook deliveries that arrive together can both see no active
  // lead, and only one of them may go on to route.
  let lead: Lead;
  try {
    lead = await createLead({
      salesforce_record_id: payload.salesforce_record_id ?? null,
      location_id: location?.id ?? null,
      form_name: payload.form_name,
      first_name: payload.first_name,
      last_name: payload.last_name,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      floor_plan: payload.floor_plan ?? null,
      village: payload.village ?? null,
      price: payload.price ?? null,
      home_type: payload.home_type ?? null,
      property_address: payload.property_address ?? null,
      url: payload.url ?? null,
      builder: payload.builder ?? null,
      timeline: payload.timeline ?? null,
      message: payload.message ?? null,
      salesforce_owner_id: payload.salesforce_owner_id ?? null,
      is_master_agent_owned: payload.is_master_agent_owned ?? false,
      raw_payload: payload as unknown as Record<string, unknown>,
      arrived_during_quiet_hours: arrivedDuringQuietHours,
      routing_status: "pending",
      final_agent_id: null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.info("Concurrent submission is already routing this record, skipping", {
        salesforce_record_id: payload.salesforce_record_id,
      });
      return { status: "duplicate", leadId: "" };
    }
    throw error;
  }

  await logAuditEvent("lead_received", {
    leadId: lead.id,
    details: {
      location: payload.location,
      form_name: payload.form_name,
      contact_name: `${payload.first_name} ${payload.last_name}`,
    },
  });

  const locationName = location?.name ?? payload.location;

  // If the checkbox is unchecked, the lead is owned by a non-frontlines agent
  if (!payload.is_master_agent_owned) {
    return await handleOwnedByOther(lead, locationName, "salesforce");
  }

  // Salesforce says nobody owns this lead yet — but we may have assigned it
  // ourselves moments ago. Acceptance writes the new owner back to Salesforce
  // asynchronously through Zapier, so a second submission that lands before
  // that write-back completes still arrives flagged as master-agent-owned.
  // Our own assignment is authoritative while Salesforce catches up;
  // re-auctioning here is what hands one lead to two different agents.
  if (payload.salesforce_record_id) {
    const assigned = await findAssignedLeadForRecord(payload.salesforce_record_id);
    if (assigned?.final_agent_id) {
      const owner = await getAgentById(assigned.final_agent_id);
      logger.info("Repeat submission for a lead we already assigned", {
        leadId: lead.id,
        priorLeadId: assigned.id,
        ownerAgentId: assigned.final_agent_id,
        ownerAgentName: owner?.name,
      });
      return await handleOwnedByOther(lead, locationName, "prior_assignment", owner);
    }
  }

  // Check if routing is paused system-wide
  const { data: settings } = await supabase
    .from("system_settings")
    .select("routing_enabled")
    .eq("id", 1)
    .single();

  if (settings && !settings.routing_enabled) {
    logger.info("Routing is paused — lead queued as pending", {
      leadId: lead.id,
    });
    await logAuditEvent("lead_received", {
      leadId: lead.id,
      details: { routing_decision: "paused", note: "System routing is paused" },
    });
    return { status: "paused", leadId: lead.id };
  }

  // Route to best available agent
  await startRouting(lead, locationName);

  return { status: "routing", leadId: lead.id };
}

/**
 * Handle a lead that already belongs to an agent: notify that agent and
 * frontlines, record the assignment, and hold the auction.
 *
 * `source` distinguishes how we learned who owns it — "salesforce" when the
 * payload names an owner, and "prior_assignment" when this bot assigned the
 * lead earlier and Salesforce has not caught up yet. In the latter case the
 * owning agent is already resolved and passed in as `knownOwner`.
 */
async function handleOwnedByOther(
  lead: Lead,
  locationName: string,
  source: "salesforce" | "prior_assignment",
  knownOwner?: Agent | null
): Promise<{ status: string; leadId: string }> {
  // Look up the existing owner agent by their Salesforce user ID
  const ownerAgent =
    knownOwner ??
    (lead.salesforce_owner_id
      ? await getAgentBySalesforceUserId(lead.salesforce_owner_id)
      : null);

  // Send SMS to the existing owner agent
  if (ownerAgent?.phone) {
    await sendExistingOwnerNotification(ownerAgent.phone, lead, locationName);
    logger.info("Notified existing owner agent", {
      leadId: lead.id,
      agentId: ownerAgent.id,
      agentName: ownerAgent.name,
    });
  }

  // Send notification to frontlines
  const frontlinesAgent = await getFrontlinesAgent();
  const frontlinesPhone = frontlinesAgent?.phone ?? process.env.FRONTLINES_AGENT_PHONE;

  if (frontlinesPhone) {
    await sendOwnedByNotification(frontlinesPhone, lead, locationName, ownerAgent?.name ?? null);
  }

  // Assign the existing owner as the final agent
  await updateLeadStatus(lead.id, "owned_by_other", ownerAgent?.id);

  await logAuditEvent("lead_received", {
    leadId: lead.id,
    details: {
      routing_decision: "owned_by_other",
      ownership_source: source,
      salesforce_owner_id: lead.salesforce_owner_id,
      owner_agent_id: ownerAgent?.id ?? null,
      owner_agent_name: ownerAgent?.name ?? null,
    },
  });

  logger.info("Lead owned by non-frontlines agent", {
    leadId: lead.id,
    ownershipSource: source,
    salesforce_owner_id: lead.salesforce_owner_id,
    ownerAgentId: ownerAgent?.id,
  });

  return { status: "owned_by_other", leadId: lead.id };
}
