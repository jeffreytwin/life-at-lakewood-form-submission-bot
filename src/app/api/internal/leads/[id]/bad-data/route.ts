import { NextRequest, NextResponse } from "next/server";
import { getLeadById, updateLeadStatus } from "@/lib/supabase/queries/leads";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { notifyBadData } from "@/lib/zapier/notify-bad-data";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/leads/[id]/bad-data
 *
 * Marks a manually-handled lead as bogus:
 *   1. Fires the Zapier hook that sets the Salesforce lead Status to
 *      "Bad Data" and "Bad Data / Disqualified" to "Bogus Lead". If that
 *      fails the whole action fails — local state must not say "bogus"
 *      while Salesforce still counts the lead.
 *   2. Sets routing_status to "bad_data".
 *
 * Nothing else is touched locally. Erasing the hand-raise data and
 * removing the lead from agent daily/monthly counts happens in Salesforce
 * by its own process once the status flips there; the hand raise snapshot
 * sync then carries the corrected counts back into the app.
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
    // (nothing there to update) — the local status still flips.
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

    const updated = await updateLeadStatus(id, "bad_data");

    await logAuditEvent("lead_marked_bad_data", {
      leadId: id,
      details: {
        source: "admin_button",
        previous_status: lead.routing_status,
        salesforce_record_id: lead.salesforce_record_id,
        salesforce_notified: salesforceNotified,
      },
    });

    logger.info("Lead marked as bad data by admin", {
      leadId: id,
      previousStatus: lead.routing_status,
      salesforceNotified,
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
