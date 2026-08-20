import { NextRequest, NextResponse } from "next/server";
import { getLeadById } from "@/lib/supabase/queries/leads";
import { getAgentById } from "@/lib/supabase/queries/agents";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { sendExistingOwnerNotification } from "@/lib/twilio/send-sms";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/leads/:id/notify-owner
 *
 * Texts the lead's recorded owner when that owner is off the active roster.
 * Routing deliberately skips them, so this is frontlines choosing to reach
 * out — typically to ask whether a former agent still wants the relationship.
 *
 * The lead stays in "manual". Notifying is not a decision: frontlines can
 * still hand it to the auction ("Retry") or close it out ("Done") afterwards,
 * and can text again if the first message goes unanswered.
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

    if (!lead.final_agent_id) {
      return NextResponse.json(
        { error: "This lead has no recorded owner to notify" },
        { status: 400 }
      );
    }

    const owner = await getAgentById(lead.final_agent_id);
    if (!owner) {
      return NextResponse.json(
        { error: "The recorded owner no longer exists" },
        { status: 400 }
      );
    }

    // Guard the premise rather than the status: this action exists because
    // routing would not text an off-roster owner on its own. An active agent
    // already got the lead through the normal path, so texting again here
    // would duplicate it.
    if (owner.is_active && !owner.is_frontlines) {
      return NextResponse.json(
        { error: `${owner.name} is on the active roster and was already notified` },
        { status: 400 }
      );
    }

    if (!owner.phone) {
      return NextResponse.json(
        { error: `No phone number on file for ${owner.name}` },
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

    const messageSid = await sendExistingOwnerNotification(
      owner.phone,
      lead,
      locationName
    );

    await logAuditEvent("owner_notified", {
      leadId: id,
      details: {
        owner_agent_id: owner.id,
        owner_agent_name: owner.name,
        owner_is_active: owner.is_active,
        message_sid: messageSid,
      },
    });

    logger.info("Off-roster owner notified by frontlines", {
      leadId: id,
      ownerAgentId: owner.id,
      ownerAgentName: owner.name,
    });

    return NextResponse.json({ ok: true, ownerName: owner.name });
  } catch (error) {
    logger.error("Failed to notify lead owner", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
