import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export type LeadStatusUpdate = "nurture_active" | "disqualified";

export interface UpdateLeadStatusResult {
  success: boolean;
  error?: string;
  alreadyApplied?: boolean;
}

/**
 * Fire the Zapier webhook to set the Salesforce lead status, then record
 * which status was applied on the draft. Used by the manual UI button and
 * by the auto-handoff flow in sync-sent.
 *
 * Idempotent: returns alreadyApplied=true if the draft has already had a
 * status update recorded (caller decides whether that's an error).
 */
export async function updateDraftLeadStatus(
  draftId: string,
  status: LeadStatusUpdate
): Promise<UpdateLeadStatusResult> {
  const { data: draft, error: draftError } = await supabase
    .from("email_drafts")
    .select("*, email_threads:thread_id(sender_email, sender_name, salesforce_lead_id)")
    .eq("id", draftId)
    .single();

  if (draftError || !draft) {
    return { success: false, error: "Draft not found" };
  }

  if (draft.lead_status_update) {
    return {
      success: false,
      alreadyApplied: true,
      error: `Lead status already updated to: ${draft.lead_status_update}`,
    };
  }

  const thread = draft.email_threads as {
    sender_email: string | null;
    sender_name: string | null;
    salesforce_lead_id: string | null;
  } | null;

  const zapierUrl =
    status === "nurture_active"
      ? process.env.ZAPIER_NURTURE_ACTIVE_HOOK
      : process.env.ZAPIER_DISQUALIFIED_HOOK;

  if (!zapierUrl) {
    return {
      success: false,
      error: `ZAPIER_${status === "nurture_active" ? "NURTURE_ACTIVE" : "DISQUALIFIED"}_HOOK not configured`,
    };
  }

  const webhookPayload = {
    draft_id: draftId,
    thread_id: draft.thread_id,
    sender_email: thread?.sender_email ?? null,
    sender_name: thread?.sender_name ?? null,
    salesforce_lead_id: thread?.salesforce_lead_id ?? null,
    subject: draft.subject,
    new_status: status,
    updated_at: new Date().toISOString(),
  };

  let zapRes: Response;
  try {
    zapRes = await fetch(zapierUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
  } catch (err) {
    return {
      success: false,
      error: `Zapier webhook fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!zapRes.ok) {
    const errText = await zapRes.text().catch(() => "");
    return {
      success: false,
      error: `Zapier webhook returned ${zapRes.status}: ${errText}`,
    };
  }

  const { error: updateError } = await supabase
    .from("email_drafts")
    .update({ lead_status_update: status })
    .eq("id", draftId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  logger.info("Lead status updated via Zapier", {
    draftId,
    status,
    senderEmail: thread?.sender_email,
    salesforceLeadId: thread?.salesforce_lead_id,
  });

  return { success: true };
}

/**
 * Check whether a contact's current Salesforce lead_status already matches
 * the target — useful to avoid firing the Zapier webhook redundantly when
 * the lead is already in the right state.
 */
export async function senderAlreadyHasLeadStatus(
  senderEmail: string | null,
  status: LeadStatusUpdate
): Promise<boolean> {
  if (!senderEmail) return false;
  const { data } = await supabase
    .from("salesforce_contacts")
    .select("lead_status")
    .eq("email", senderEmail)
    .limit(1);
  const current = data?.[0]?.lead_status?.toLowerCase().replace(/\s+/g, "_");
  return current === status;
}
