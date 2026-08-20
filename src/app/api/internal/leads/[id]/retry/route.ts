import { NextRequest, NextResponse } from "next/server";
import { getLeadById } from "@/lib/supabase/queries/leads";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { startRouting } from "@/lib/routing/state-machine";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { isUniqueViolation } from "@/lib/shared/errors";

/**
 * POST /api/internal/leads/:id/retry
 *
 * Re-runs the routing process for a lead that previously exhausted all
 * candidates ("manual" status) or hit some other failure ("failed").
 * Resets routing_status to "pending" and clears final_agent_id, then
 * delegates to startRouting to score agents fresh and start a new
 * attempt sequence. Prior routing_attempts rows are preserved for
 * audit history; the manual_retry audit event marks the start of the
 * new routing cycle so previously timed-out agents become re-eligible
 * and the escalation counter resets. Agents who explicitly declined
 * the lead remain excluded across cycles.
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
        { error: `Retry is only available for manual or failed leads (current: ${lead.routing_status})` },
        { status: 400 }
      );
    }

    let locationName = "Life At Lakewood";
    if (lead.location_id) {
      const { data: location } = await supabase
        .from("locations")
        .select("name")
        .eq("id", lead.location_id)
        .single();
      if (location) locationName = location.name;
    }

    // Reset routing state. Keep prior routing_attempts rows — the new
    // attempts continue from getMaxAttemptNumber + 1.
    const { error: resetError } = await supabase
      .from("leads")
      .update({ routing_status: "pending", final_agent_id: null })
      .eq("id", id);

    if (resetError) {
      // Losing the partial unique index on active leads per Salesforce record
      // means another submission for the same record is already routing —
      // retrying here would put the lead in front of a second agent.
      if (isUniqueViolation(resetError)) {
        return NextResponse.json(
          {
            error:
              "Another submission for this Salesforce record is already routing. Resolve that lead first.",
          },
          { status: 409 }
        );
      }
      throw new Error(`Failed to reset lead state: ${resetError.message}`);
    }

    await logAuditEvent("manual_retry", {
      leadId: id,
      details: {
        previous_status: lead.routing_status,
      },
    });

    // Reload the lead so startRouting sees the reset state.
    const refreshed = await getLeadById(id);
    if (!refreshed) {
      throw new Error("Lead vanished during retry");
    }

    await startRouting(refreshed, locationName);

    logger.info("Lead routing retried", {
      leadId: id,
      previousStatus: lead.routing_status,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to retry lead routing", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
