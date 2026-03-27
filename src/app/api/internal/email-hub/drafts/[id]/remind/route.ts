import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getTwilioClient, getTwilioPhoneNumber } from "@/lib/twilio/client";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/email-hub/drafts/:id/remind
 *
 * Sends an SMS reminder to frontlines agents about an approved draft
 * that hasn't been sent yet.
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
      .select("*, email_accounts(email_address, display_name, location_id, locations(name)), email_threads:thread_id(sender_name, sender_email)")
      .eq("id", id)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.status !== "approved") {
      return NextResponse.json(
        { error: "Only approved drafts can have reminders sent" },
        { status: 400 }
      );
    }

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
        reminded: false,
        message: "No frontlines agents have draft success texts enabled.",
      });
    }

    // Build SMS
    const account = draft.email_accounts as {
      email_address: string;
      display_name: string | null;
      location_id: string | null;
      locations: { name: string } | null;
    } | null;
    const locationName = account?.locations?.name ?? null;

    const thread = draft.email_threads as {
      sender_name: string | null;
      sender_email: string | null;
    } | null;
    const leadName = thread?.sender_name || thread?.sender_email || null;

    let smsBody = "Reminder: ";
    smsBody += locationName ? `${locationName} Draft Ready` : "Draft Ready";
    if (leadName) smsBody += ` (${leadName})`;
    smsBody += " — still waiting to be sent.";

    const results: { agentName: string; success: boolean; error?: string }[] = [];

    for (const agent of eligibleAgents) {
      try {
        await getTwilioClient().messages.create({
          to: agent.draft_success_phone!,
          from: getTwilioPhoneNumber(),
          body: smsBody,
        });
        results.push({ agentName: agent.name, success: true });
        logger.info("Draft reminder SMS sent", {
          draftId: id,
          agentName: agent.name,
        });
      } catch (smsError) {
        const errMsg = smsError instanceof Error ? smsError.message : String(smsError);
        results.push({ agentName: agent.name, success: false, error: errMsg });
        logger.error("Draft reminder SMS failed", {
          draftId: id,
          agentName: agent.name,
          error: errMsg,
        });
      }
    }

    return NextResponse.json({ reminded: true, results });
  } catch (error) {
    logger.error("Draft reminder failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
