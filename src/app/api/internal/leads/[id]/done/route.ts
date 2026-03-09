import { NextRequest, NextResponse } from "next/server";
import { getLeadById, updateLeadStatus } from "@/lib/supabase/queries/leads";
import { getFrontlinesAgent } from "@/lib/supabase/queries/agents";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { supabase } from "@/lib/supabase/client";
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

    if (lead.routing_status !== "manual" && lead.routing_status !== "failed") {
      return NextResponse.json(
        { error: `Done is only available for manual or failed leads` },
        { status: 400 }
      );
    }

    // Assign to frontlines agent and mark accepted
    const frontlinesAgent = await getFrontlinesAgent();
    if (frontlinesAgent) {
      await supabase
        .from("leads")
        .update({ final_agent_id: frontlinesAgent.id })
        .eq("id", id);
    }

    const updated = await updateLeadStatus(id, "accepted");

    await logAuditEvent("lead_done_manually", {
      leadId: id,
      details: {
        previous_status: lead.routing_status,
        assigned_to: frontlinesAgent?.name ?? "frontlines",
      },
    });

    logger.info("Lead marked done manually", {
      leadId: id,
      previousStatus: lead.routing_status,
    });

    return NextResponse.json({ lead: updated });
  } catch (error) {
    logger.error("Failed to mark lead as done", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
