import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/email-hub/drafts/:id/lead-status
 *
 * Sends a Zapier webhook to update the Salesforce lead status
 * and records which status was set on the draft.
 *
 * Body: { status: "nurture_active" | "disqualified" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !["nurture_active", "disqualified"].includes(status)) {
      return NextResponse.json(
        { error: "status must be 'nurture_active' or 'disqualified'" },
        { status: 400 }
      );
    }

    // Load the draft with its thread info
    const { data: draft, error: draftError } = await supabase
      .from("email_drafts")
      .select("*, email_threads:thread_id(sender_email, sender_name, salesforce_lead_id)")
      .eq("id", id)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.lead_status_update) {
      return NextResponse.json(
        { error: `Lead status already updated to: ${draft.lead_status_update}` },
        { status: 400 }
      );
    }

    const thread = draft.email_threads as {
      sender_email: string | null;
      sender_name: string | null;
      salesforce_lead_id: string | null;
    } | null;

    // Pick the right Zapier webhook URL
    const zapierUrl =
      status === "nurture_active"
        ? process.env.ZAPIER_NURTURE_ACTIVE_HOOK
        : process.env.ZAPIER_DISQUALIFIED_HOOK;

    if (!zapierUrl) {
      return NextResponse.json(
        { error: `ZAPIER_${status === "nurture_active" ? "NURTURE_ACTIVE" : "DISQUALIFIED"}_HOOK not configured` },
        { status: 500 }
      );
    }

    // Send webhook to Zapier
    const webhookPayload = {
      draft_id: id,
      thread_id: draft.thread_id,
      sender_email: thread?.sender_email ?? null,
      sender_name: thread?.sender_name ?? null,
      salesforce_lead_id: thread?.salesforce_lead_id ?? null,
      subject: draft.subject,
      new_status: status,
      updated_at: new Date().toISOString(),
    };

    const zapRes = await fetch(zapierUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    if (!zapRes.ok) {
      const errText = await zapRes.text().catch(() => "");
      throw new Error(`Zapier webhook failed (${zapRes.status}): ${errText}`);
    }

    // Record the status update on the draft
    const { error: updateError } = await supabase
      .from("email_drafts")
      .update({ lead_status_update: status })
      .eq("id", id);

    if (updateError) throw new Error(updateError.message);

    logger.info("Lead status updated via Zapier", {
      draftId: id,
      status,
      senderEmail: thread?.sender_email,
      salesforceLeadId: thread?.salesforce_lead_id,
    });

    return NextResponse.json({ success: true, status });
  } catch (error) {
    logger.error("Lead status update failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
