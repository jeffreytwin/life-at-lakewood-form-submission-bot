import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { sendHandoffNotification } from "@/lib/twilio/send-sms";

/**
 * POST /api/internal/email-hub/drafts/:id/handoff
 *
 * Triggers an agent handoff for a sent email draft.
 * Sends draft/thread/agent data to Zapier which updates Salesforce owner.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Accept agent_id from request body (new flow) or fall back to draft.agent_handoff_id (legacy)
    let bodyAgentId: string | null = null;
    try {
      const body = await request.json();
      bodyAgentId = body.agent_id ?? null;
    } catch {
      // No body or invalid JSON — that's fine, will use draft.agent_handoff_id
    }

    const zapierUrl = process.env.ZAPIER_CHANGE_OWNER_EMAIL;
    if (!zapierUrl) {
      return NextResponse.json(
        { error: "ZAPIER_CHANGE_OWNER_EMAIL environment variable not configured" },
        { status: 500 }
      );
    }

    // Load draft with thread and account info
    const { data: draft, error: draftError } = await supabase
      .from("email_drafts")
      .select(`
        *,
        email_accounts(id, email_address, display_name, location_id, locations(id, name)),
        email_threads(id, subject, sender_email, sender_name, salesforce_lead_id, provider_thread_id)
      `)
      .eq("id", id)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.status !== "sent") {
      return NextResponse.json(
        { error: "Only sent emails can be handed off" },
        { status: 400 }
      );
    }

    if (draft.agent_handoff_transferred) {
      return NextResponse.json(
        { error: "This email has already been handed off" },
        { status: 400 }
      );
    }

    // Determine which agent to use: request body takes priority, then draft.agent_handoff_id
    const agentId = bodyAgentId ?? draft.agent_handoff_id;
    if (!agentId) {
      return NextResponse.json(
        { error: "No agent specified for handoff" },
        { status: 400 }
      );
    }

    // Load agent info
    let agentInfo = null;
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, email, phone, salesforce_user_id")
      .eq("id", agentId)
      .single();
    agentInfo = agent;

    if (!agentInfo) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 }
      );
    }

    const thread = draft.email_threads as {
      id: string;
      subject: string | null;
      sender_email: string | null;
      sender_name: string | null;
      salesforce_lead_id: string | null;
      provider_thread_id: string | null;
    } | null;

    const account = draft.email_accounts as {
      id: string;
      email_address: string;
      display_name: string | null;
      location_id: string | null;
      locations: { id: string; name: string } | null;
    } | null;

    // Send to Zapier
    const payload = {
      draft_id: draft.id,
      thread_id: draft.thread_id,
      subject: draft.subject,
      sender_email: thread?.sender_email ?? null,
      sender_name: thread?.sender_name ?? null,
      salesforce_lead_id: thread?.salesforce_lead_id ?? null,
      location_name: account?.locations?.name ?? null,
      location_id: account?.location_id ?? null,
      email_account: account?.email_address ?? null,
      agent_id: agentInfo?.id ?? null,
      agent_name: agentInfo?.name ?? null,
      agent_email: agentInfo?.email ?? null,
      agent_salesforce_id: agentInfo?.salesforce_user_id ?? null,
      sent_at: draft.sent_at,
      handoff_at: new Date().toISOString(),
    };

    const zapRes = await fetch(zapierUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!zapRes.ok) {
      const text = await zapRes.text();
      logger.error("Zapier handoff webhook failed", {
        draftId: id,
        status: zapRes.status,
        body: text,
      });
      return NextResponse.json(
        { error: `Zapier webhook failed: ${zapRes.status}` },
        { status: 502 }
      );
    }

    // Send SMS notification to the agent
    if (agentInfo.phone) {
      const agentFirstName = agentInfo.name?.split(" ")[0] ?? "there";

      try {
        await sendHandoffNotification(
          agentInfo.phone,
          agentFirstName,
          thread?.sender_name || "New lead",
          account?.locations?.name ?? null
        );
      } catch (smsError) {
        logger.error("Handoff SMS notification failed (non-blocking)", {
          draftId: id,
          agentPhone: agentInfo.phone,
          error: smsError instanceof Error ? smsError.message : String(smsError),
        });
      }
    }

    // Mark as transferred and store the agent used
    await supabase
      .from("email_drafts")
      .update({
        agent_handoff_id: agentId,
        agent_handoff_transferred: true,
        agent_handoff_transferred_at: new Date().toISOString(),
      })
      .eq("id", id);

    logger.info("Agent handoff transferred", {
      draftId: id,
      agentName: agentInfo?.name ?? "none",
      salesforceLeadId: thread?.salesforce_lead_id ?? "none",
    });

    return NextResponse.json({
      success: true,
      message: "Agent handoff transferred successfully",
    });
  } catch (error) {
    logger.error("Agent handoff failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
