import { NextRequest, NextResponse } from "next/server";
import { generateDraft } from "@/lib/ai/draft-generator";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      location_id,
      location_name,
      inbound_email,
      sender_name,
      lead_info,
    } = body;

    if (!inbound_email) {
      return NextResponse.json(
        { error: "inbound_email is required" },
        { status: 400 }
      );
    }

    // Resolve location name if only ID provided
    let resolvedLocationName = location_name;
    let resolvedLocationId = location_id || null;

    if (location_id && !location_name) {
      const { data: loc } = await supabase
        .from("locations")
        .select("name")
        .eq("id", location_id)
        .single();
      resolvedLocationName = loc?.name ?? "Unknown Location";
    }

    if (!resolvedLocationName) {
      resolvedLocationName = "General";
    }

    // Build a simulated conversation thread
    const senderLabel = sender_name || "Prospective Buyer";
    const conversationThread = `From: ${senderLabel}\nTo: Lynn Brown\n\n${inbound_email}`;

    logger.info("Running email simulation", {
      locationName: resolvedLocationName,
      senderName: senderLabel,
    });

    const draft = await generateDraft({
      locationName: resolvedLocationName,
      locationId: resolvedLocationId,
      conversationThread,
      leadInfo: lead_info,
    });

    // Store as a simulation draft
    const { data: savedDraft, error: saveError } = await supabase
      .from("email_drafts")
      .insert({
        thread_id: null,
        email_account_id: null,
        provider_draft_id: null,
        status: "drafted",
        subject: null,
        body_text: draft.bodyText,
        body_html: null,
        cc_emails: [],
        agent_handoff_id: null,
        model_used: draft.modelUsed,
        prompt_tokens: draft.promptTokens,
        completion_tokens: draft.completionTokens,
        is_simulation: true,
        simulation_input: {
          location_id: resolvedLocationId,
          location_name: resolvedLocationName,
          inbound_email,
          sender_name: senderLabel,
          lead_info: lead_info || null,
        },
        edited_at: null,
        sent_at: null,
      })
      .select()
      .single();

    if (saveError) {
      logger.error("Failed to save simulation draft", { error: saveError.message });
    }

    return NextResponse.json({
      draft_id: savedDraft?.id ?? null,
      body_text: draft.bodyText,
      model_used: draft.modelUsed,
      prompt_tokens: draft.promptTokens,
      completion_tokens: draft.completionTokens,
    });
  } catch (error) {
    logger.error("Simulation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
