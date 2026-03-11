import { NextRequest, NextResponse } from "next/server";
import { getLeadById, updateLeadStatus } from "@/lib/supabase/queries/leads";
import {
  getActiveAttemptForLead,
  updateRoutingAttemptStatus,
} from "@/lib/supabase/queries/routing-attempts";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { logger } from "@/lib/shared/logger";

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

    // Cancel any active routing attempt so the cron job won't escalate it
    const activeAttempt = await getActiveAttemptForLead(id);
    if (activeAttempt) {
      await updateRoutingAttemptStatus(activeAttempt.id, "timed_out", {
        expires_at: null,
      });
    }

    const updated = await updateLeadStatus(id, "bad_data");

    await logAuditEvent("lead_marked_bad_data", {
      leadId: id,
      details: {
        previous_status: lead.routing_status,
      },
    });

    logger.info("Lead marked as bad data", {
      leadId: id,
      previousStatus: lead.routing_status,
    });

    return NextResponse.json({ lead: updated });
  } catch (error) {
    logger.error("Failed to mark lead as bad data", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
