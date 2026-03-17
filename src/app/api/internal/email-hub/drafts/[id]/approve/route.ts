import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getTwilioClient, getTwilioPhoneNumber } from "@/lib/twilio/client";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/email-hub/drafts/:id/approve
 *
 * Approves a draft and sends an SMS to all frontlines agents who have
 * send_draft_success_texts enabled, notifying them a draft is ready in Gmail.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Load the draft
    const { data: draft, error: draftError } = await supabase
      .from("email_drafts")
      .select("*, email_accounts(email_address, display_name, location_id)")
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

    // Update draft status to "approved" — we keep "edited" since it hasn't been sent yet,
    // but mark it with approved_at so we know it was approved
    const { error: updateError } = await supabase
      .from("email_drafts")
      .update({ status: "edited" as string })
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

    // Build the SMS body
    const account = draft.email_accounts as {
      email_address: string;
      display_name: string | null;
    } | null;
    const accountLabel =
      account?.display_name ?? account?.email_address ?? "an inbox";
    const subjectLine = draft.subject ?? "(no subject)";

    const smsBody = [
      `Email draft ready to send for ${accountLabel}.`,
      `Subject: ${subjectLine}`,
      "",
      "Please check Gmail drafts to review and send.",
    ].join("\n");

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
