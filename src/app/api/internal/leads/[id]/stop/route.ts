import { NextRequest, NextResponse } from "next/server";
import { getLeadById, updateLeadStatus } from "@/lib/supabase/queries/leads";
import {
  getActiveAttemptForLead,
  updateRoutingAttemptStatus,
} from "@/lib/supabase/queries/routing-attempts";
import { getAgentById } from "@/lib/supabase/queries/agents";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { sendRoutingStoppedByAdmin } from "@/lib/twilio/send-sms";
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

    if (lead.routing_status !== "pending" && lead.routing_status !== "routing" && lead.routing_status !== "failed") {
      return NextResponse.json(
        { error: `Cannot stop a lead with status "${lead.routing_status}"` },
        { status: 400 }
      );
    }

    // Cancel any active routing attempt so the cron job won't escalate it
    const activeAttempt = await getActiveAttemptForLead(id);
    if (activeAttempt) {
      await updateRoutingAttemptStatus(activeAttempt.id, "timed_out", {
        expires_at: null,
      });

      // Tell the agent currently on the hook that they can disregard the lead.
      const agent = await getAgentById(activeAttempt.agent_id);
      if (agent?.phone) {
        try {
          await sendRoutingStoppedByAdmin(agent.phone);
        } catch (smsErr) {
          logger.warn("Failed to notify agent that routing was stopped", {
            agentId: agent.id,
            error: smsErr instanceof Error ? smsErr.message : String(smsErr),
          });
        }
      }
    }

    // Move lead to manual
    const updated = await updateLeadStatus(id, "manual");

    await logAuditEvent("routing_stopped", {
      leadId: id,
      routingAttemptId: activeAttempt?.id,
      details: {
        previous_status: lead.routing_status,
        reason: "stopped_by_admin",
      },
    });

    logger.info("Routing stopped by admin", {
      leadId: id,
      previousStatus: lead.routing_status,
    });

    return NextResponse.json({ lead: updated });
  } catch (error) {
    logger.error("Failed to stop routing", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
