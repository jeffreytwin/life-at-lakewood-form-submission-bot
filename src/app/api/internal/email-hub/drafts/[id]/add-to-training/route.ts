import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { stripQuotedText } from "@/lib/gmail/quote";
import { logger } from "@/lib/shared/logger";

/**
 * Strip email signature block from the end of the body.
 * Matches patterns like:
 *   Lynn Brown, Realtor
 *   *Life in Longboat Key* (Coldwell Banker)
 *   920.410.8778
 * Or:
 *   Lynn Brown, Realtor
 *   Coldwell Banker Realty (Life At Lakewood)
 *   920.410.8778
 */
function stripSignature(text: string): string {
  // Pattern 1: "*Life in/at X* (Coldwell Banker)" style
  // Pattern 2: "Coldwell Banker Realty (Life At/in X)" style
  // Both preceded by a name line with title, possibly followed by phone
  const sigPattern = /\n\s*\n\s*[A-Z][a-z]+ [A-Z][a-z]+,?\s*(?:Realtor|REALTOR|Agent)?\s*\n\s*(?:\*?Life (?:in |at |At |in the )[^*\n]+\*?\s*\(Coldwell Banker\)|Coldwell Banker[^\n]*\(Life [^\n)]+\))[\s\S]*$/i;
  const stripped = text.replace(sigPattern, "");
  return stripped.trim();
}

/**
 * POST /api/internal/email-hub/drafts/:id/add-to-training
 *
 * Takes a sent draft and its inbound message and creates a training example.
 * Body: { category: TrainingCategory }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { category } = body;

    if (!category) {
      return NextResponse.json(
        { error: "category is required" },
        { status: 400 }
      );
    }

    // Load the draft with its account info
    const { data: draft, error: draftError } = await supabase
      .from("email_drafts")
      .select("*, email_accounts(email_address, location_id)")
      .eq("id", id)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.status !== "sent") {
      return NextResponse.json(
        { error: "Only sent drafts can be added to training data" },
        { status: 400 }
      );
    }

    // The response text is sent_body_text (what was actually sent) or body_text
    // Strip quoted reply text so only the actual response is used for training
    const rawResponse = draft.sent_body_text ?? draft.body_text;
    const responseText = rawResponse
      ? stripSignature(stripQuotedText(rawResponse))
      : null;
    if (!responseText) {
      return NextResponse.json(
        { error: "Draft has no body text to use as training" },
        { status: 400 }
      );
    }

    // Find the most recent inbound message in the thread
    let inboundText = "";
    if (draft.thread_id) {
      const { data: messages } = await supabase
        .from("email_messages")
        .select("body_text, direction, from_email")
        .eq("thread_id", draft.thread_id)
        .eq("direction", "inbound")
        .order("received_at", { ascending: false })
        .limit(1);

      if (messages && messages.length > 0) {
        inboundText = (messages[0].body_text ?? "").trim();
      }
    }

    if (!inboundText) {
      return NextResponse.json(
        { error: "No inbound message found in thread to pair with this draft" },
        { status: 400 }
      );
    }

    const account = draft.email_accounts as {
      email_address: string;
      location_id: string | null;
    } | null;

    // Create the training example
    const { data: training, error: trainingError } = await supabase
      .from("training_examples")
      .insert({
        email_address: account?.email_address ?? null,
        location_id: account?.location_id ?? null,
        category,
        inbound_email: inboundText,
        ideal_response: responseText,
        context_notes: `Added from sent draft ${id}`,
        is_active: true,
      })
      .select()
      .single();

    if (trainingError) throw trainingError;

    logger.info("Sent draft added to training data", {
      draftId: id,
      trainingExampleId: training.id,
      category,
    });

    return NextResponse.json(training, { status: 201 });
  } catch (error) {
    logger.error("Add to training failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
