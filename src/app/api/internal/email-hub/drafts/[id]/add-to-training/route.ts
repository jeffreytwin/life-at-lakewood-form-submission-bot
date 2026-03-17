import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

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
    const responseText = draft.sent_body_text ?? draft.body_text;
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
        inboundText = messages[0].body_text ?? "";
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
