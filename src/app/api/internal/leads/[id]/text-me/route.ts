import { NextRequest, NextResponse } from "next/server";
import { getLeadById } from "@/lib/supabase/queries/leads";
import { getFrontlinesAgent } from "@/lib/supabase/queries/agents";
import { sendFrontlinesLeadDetails } from "@/lib/twilio/send-sms";
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
        { error: `Text Me is only available for manual or failed leads` },
        { status: 400 }
      );
    }

    const frontlinesAgent = await getFrontlinesAgent();
    const frontlinesPhone = frontlinesAgent?.phone ?? process.env.FRONTLINES_AGENT_PHONE;

    if (!frontlinesPhone) {
      return NextResponse.json(
        { error: "No frontlines agent configured" },
        { status: 400 }
      );
    }

    // Resolve location name
    let locationName = "Life At Lakewood";
    if (lead.location_id) {
      const { data: location } = await supabase
        .from("locations")
        .select("name")
        .eq("id", lead.location_id)
        .single();
      if (location) locationName = location.name;
    }

    await sendFrontlinesLeadDetails(frontlinesPhone, lead, locationName);

    await logAuditEvent("text_me_sent", {
      leadId: id,
      details: {
        frontlines_phone: frontlinesPhone,
        routing_status: lead.routing_status,
      },
    });

    logger.info("Text Me sent to frontlines", {
      leadId: id,
      frontlinesPhone,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to send Text Me", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
