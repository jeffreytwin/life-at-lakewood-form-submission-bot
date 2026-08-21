import { NextRequest, NextResponse } from "next/server";
import { getLeadById, updateLeadStatus } from "@/lib/supabase/queries/leads";
import { getAttemptsByLeadId } from "@/lib/supabase/queries/routing-attempts";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { notifyBadData } from "@/lib/zapier/notify-bad-data";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/leads/[id]/bad-data
 *
 * Marks a manually-handled lead as bogus:
 *   1. Fires the Zapier hook that sets the Salesforce lead Status to
 *      "Bad Data" and "Bad Data / Disqualified" to "Bogus Lead". If that
 *      fails the whole action fails — local state must not say "bogus"
 *      while Salesforce still counts the lead.
 *   2. Erases the lead's hand-raise data: takes back monthly_lead_counts
 *      for any accepted attempt, then deletes its routing_attempts, so the
 *      lead stops feeding the locally-computed daily/monthly agent counts.
 *      (The Salesforce hand raise report drops the lead on its own once
 *      the status flips there; the next snapshot sync picks that up.)
 *   3. Sets routing_status to "bad_data".
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const lead = await getLeadById(id);
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (lead.routing_status !== "manual" && lead.routing_status !== "failed") {
      return NextResponse.json(
        { error: "Bad Data is only available for manual or failed leads" },
        { status: 400 }
      );
    }

    // Update Salesforce first. Skipped when the lead never got an SF record
    // (nothing there to update) — local cleanup still proceeds.
    let salesforceNotified = false;
    if (lead.salesforce_record_id) {
      const result = await notifyBadData({
        salesforce_record_id: lead.salesforce_record_id,
        lead_id: lead.id,
        lead_name: `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim(),
        email: lead.email,
        phone: lead.phone,
        form_name: lead.form_name,
        new_status: "Bad Data",
        bad_data_disqualified: "Bogus Lead",
        marked_at: new Date().toISOString(),
      });

      if (!result.success) {
        logger.error("Bad data zap failed — aborting local update", {
          leadId: id,
          error: result.error,
        });
        return NextResponse.json(
          { error: `Salesforce update failed: ${result.error}` },
          { status: 502 }
        );
      }
      salesforceNotified = true;
    }

    // Accepted attempts were counted into monthly_lead_counts at acceptance
    // time — take those back before erasing the attempts themselves.
    const attempts = await getAttemptsByLeadId(id);
    for (const attempt of attempts) {
      if (attempt.status !== "accepted") continue;
      const yearMonth = attempt.updated_at.slice(0, 7);
      const { data: existing } = await supabase
        .from("monthly_lead_counts")
        .select("id, lead_count")
        .eq("agent_id", attempt.agent_id)
        .eq("year_month", yearMonth)
        .maybeSingle();
      if (existing && (existing.lead_count as number) > 0) {
        await supabase
          .from("monthly_lead_counts")
          .update({ lead_count: (existing.lead_count as number) - 1 })
          .eq("id", existing.id);
      }
    }

    if (attempts.length > 0) {
      // audit_log rows point at routing_attempts; detach them before the
      // delete or the FK blocks it. The audit events themselves survive.
      const attemptIds = attempts.map((a) => a.id);
      const { error: detachError } = await supabase
        .from("audit_log")
        .update({ routing_attempt_id: null })
        .in("routing_attempt_id", attemptIds);
      if (detachError) {
        throw new Error(`Failed to detach audit log rows: ${detachError.message}`);
      }

      const { error: deleteError } = await supabase
        .from("routing_attempts")
        .delete()
        .eq("lead_id", id);
      if (deleteError) {
        throw new Error(`Failed to delete routing attempts: ${deleteError.message}`);
      }
    }

    const updated = await updateLeadStatus(id, "bad_data");

    await logAuditEvent("lead_marked_bad_data", {
      leadId: id,
      details: {
        source: "admin_button",
        previous_status: lead.routing_status,
        salesforce_record_id: lead.salesforce_record_id,
        salesforce_notified: salesforceNotified,
        attempts_erased: attempts.length,
      },
    });

    logger.info("Lead marked as bad data by admin", {
      leadId: id,
      previousStatus: lead.routing_status,
      salesforceNotified,
      attemptsErased: attempts.length,
    });

    return NextResponse.json({
      lead: updated,
      salesforce_notified: salesforceNotified,
    });
  } catch (error) {
    logger.error("Failed to mark lead as bad data", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
