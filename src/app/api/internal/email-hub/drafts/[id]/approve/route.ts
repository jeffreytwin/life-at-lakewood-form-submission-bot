import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getTwilioClient, getTwilioPhoneNumber } from "@/lib/twilio/client";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/email-hub/drafts/:id/approve
 *
 * Approves a draft (status → 'approved') and sends an SMS to all frontlines
 * agents who have send_draft_success_texts enabled, notifying them a draft
 * is ready in Gmail.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Load the draft with account + location info
    const { data: draft, error: draftError } = await supabase
      .from("email_drafts")
      .select("*, email_accounts(email_address, display_name, location_id, locations(name))")
      .eq("id", id)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.status === "sent") {
      return NextResponse.json(
        { error: "Draft has already been sent" },
        { status: 400 }
      );
    }

    // Update draft status to "approved"
    const { error: updateError } = await supabase
      .from("email_drafts")
      .update({
        status: "approved" as string,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) throw updateError;

    // Find frontlines agents with draft success texts enabled
    const { data: agents, error: agentError } = await supabase
      .from("agents")
      .select("id, name, draft_success_phone, send_draft_success_texts")
      .eq("is_active", true)
      .eq("is_frontlines", true)
      .eq("send_draft_success_texts", true);

    if (agentError) throw agentError;

    const eligibleAgents = (agents ?? []).filter(
      (a) => a.draft_success_phone?.trim()
    );

    if (eligibleAgents.length === 0) {
      return NextResponse.json({
        approved: true,
        sms_sent: false,
        message:
          "Draft approved, but no frontlines agents have draft success texts enabled.",
      });
    }

    // Determine location name and lead name for SMS
    const account = draft.email_accounts as {
      email_address: string;
      display_name: string | null;
      location_id: string | null;
      locations: { name: string } | null;
    } | null;
    const locationName = account?.locations?.name ?? null;

    // Get the lead name from the email thread
    let leadName: string | null = null;
    if (draft.thread_id) {
      const { data: thread } = await supabase
        .from("email_threads")
        .select("sender_name, sender_email")
        .eq("id", draft.thread_id)
        .single();
      leadName = thread?.sender_name || thread?.sender_email || null;
    }

    // SMS body: "[LOCATION] Draft Ready (LEAD NAME)" or just "Draft Ready"
    let smsBody = locationName ? `${locationName} Draft Ready` : "Draft Ready";
    if (leadName) smsBody += ` (${leadName})`;

    // Send SMS to each eligible agent
    const results: { agentName: string; success: boolean; error?: string }[] =
      [];

    for (const agent of eligibleAgents) {
      try {
        await getTwilioClient().messages.create({
          to: agent.draft_success_phone!,
          from: getTwilioPhoneNumber(),
          body: smsBody,
        });
        results.push({ agentName: agent.name, success: true });
        logger.info("Draft approval SMS sent", {
          draftId: id,
          agentName: agent.name,
          phone: agent.draft_success_phone,
        });
      } catch (smsError) {
        const errMsg =
          smsError instanceof Error ? smsError.message : String(smsError);
        results.push({ agentName: agent.name, success: false, error: errMsg });
        logger.error("Draft approval SMS failed", {
          draftId: id,
          agentName: agent.name,
          error: errMsg,
        });
      }
    }

    return NextResponse.json({
      approved: true,
      sms_sent: true,
      results,
    });
  } catch (error) {
    logger.error("Draft approval failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
