import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { sendHandoffNotification } from "@/lib/twilio/send-sms";

export interface HandoffResult {
  success: boolean;
  error?: string;
  status?: number;
}

/**
 * Core handoff routine: fires the Zapier owner-change webhook, sends the
 * agent an SMS, and marks the draft transferred. Shared by the manual
 * "Transfer to Agent" endpoint and the auto-trigger on draft send.
 *
 * @param draftId - The email_drafts.id to hand off.
 * @param agentId - Optional override for which agent to use. Falls back to
 *                  draft.agent_handoff_id.
 */
export async function triggerAgentHandoff(
  draftId: string,
  agentId?: string | null
): Promise<HandoffResult> {
  const zapierUrl = process.env.ZAPIER_CHANGE_OWNER_EMAIL;
  if (!zapierUrl) {
    return {
      success: false,
      error: "ZAPIER_CHANGE_OWNER_EMAIL environment variable not configured",
      status: 500,
    };
  }

  const { data: draft, error: draftError } = await supabase
    .from("email_drafts")
    .select(`
      *,
      email_accounts(id, email_address, display_name, location_id, locations(id, name)),
      email_threads(id, subject, sender_email, sender_name, salesforce_lead_id, provider_thread_id)
    `)
    .eq("id", draftId)
    .single();

  if (draftError || !draft) {
    return { success: false, error: "Draft not found", status: 404 };
  }

  if (!["drafted", "approved", "sent"].includes(draft.status)) {
    return {
      success: false,
      error: "Discarded drafts cannot be handed off",
      status: 400,
    };
  }

  if (draft.agent_handoff_transferred) {
    return {
      success: false,
      error: "This email has already been handed off",
      status: 400,
    };
  }

  const resolvedAgentId = agentId ?? draft.agent_handoff_id;
  if (!resolvedAgentId) {
    return {
      success: false,
      error: "No agent specified for handoff",
      status: 400,
    };
  }

  const { data: agentInfo } = await supabase
    .from("agents")
    .select("id, name, email, phone, salesforce_user_id")
    .eq("id", resolvedAgentId)
    .single();

  if (!agentInfo) {
    return { success: false, error: "Agent not found", status: 404 };
  }

  const thread = draft.email_threads as {
    id: string;
    subject: string | null;
    sender_email: string | null;
    sender_name: string | null;
    salesforce_lead_id: string | null;
    provider_thread_id: string | null;
  } | null;

  const account = draft.email_accounts as {
    id: string;
    email_address: string;
    display_name: string | null;
    location_id: string | null;
    locations: { id: string; name: string } | null;
  } | null;

  const payload = {
    draft_id: draft.id,
    thread_id: draft.thread_id,
    subject: draft.subject,
    sender_email: thread?.sender_email ?? null,
    sender_name: thread?.sender_name ?? null,
    salesforce_lead_id: thread?.salesforce_lead_id ?? null,
    location_name: account?.locations?.name ?? null,
    location_id: account?.location_id ?? null,
    email_account: account?.email_address ?? null,
    agent_id: agentInfo.id,
    agent_name: agentInfo.name,
    agent_email: agentInfo.email,
    agent_salesforce_id: agentInfo.salesforce_user_id ?? null,
    sent_at: draft.sent_at,
    handoff_at: new Date().toISOString(),
  };

  const zapRes = await fetch(zapierUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!zapRes.ok) {
    const text = await zapRes.text();
    logger.error("Zapier handoff webhook failed", {
      draftId,
      status: zapRes.status,
      body: text,
    });
    return {
      success: false,
      error: `Zapier webhook failed: ${zapRes.status}`,
      status: 502,
    };
  }

  if (agentInfo.phone) {
    const agentFirstName = agentInfo.name?.split(" ")[0] ?? "there";
    try {
      await sendHandoffNotification(
        agentInfo.phone,
        agentFirstName,
        thread?.sender_name || "New lead",
        account?.locations?.name ?? null
      );
    } catch (smsError) {
      logger.error("Handoff SMS notification failed (non-blocking)", {
        draftId,
        agentPhone: agentInfo.phone,
        error: smsError instanceof Error ? smsError.message : String(smsError),
      });
    }
  }

  await supabase
    .from("email_drafts")
    .update({
      agent_handoff_id: resolvedAgentId,
      agent_handoff_transferred: true,
      agent_handoff_transferred_at: new Date().toISOString(),
    })
    .eq("id", draftId);

  try {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { data: existing } = await supabase
      .from("monthly_lead_counts")
      .select("id, lead_count")
      .eq("agent_id", resolvedAgentId)
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
        .insert({ agent_id: resolvedAgentId, year_month: yearMonth, lead_count: 1 });
    }
  } catch (countError) {
    logger.error("Failed to increment monthly_lead_counts after handoff (non-blocking)", {
      draftId,
      agentId: resolvedAgentId,
      error: countError instanceof Error ? countError.message : String(countError),
    });
  }

  logger.info("Agent handoff transferred", {
    draftId,
    agentName: agentInfo.name ?? "none",
    salesforceLeadId: thread?.salesforce_lead_id ?? "none",
  });

  return { success: true };
}
