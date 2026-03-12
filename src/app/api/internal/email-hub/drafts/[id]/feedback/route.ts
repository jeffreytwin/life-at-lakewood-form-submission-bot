import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();
    const { rating, feedback_notes, edited_version } = body;

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "rating (1-5) is required" },
        { status: 400 }
      );
    }

    // Verify draft exists
    const { data: draft, error: draftError } = await supabase
      .from("email_drafts")
      .select("id")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("draft_feedback")
      .insert({
        draft_id: draftId,
        rating,
        feedback_notes: feedback_notes || null,
        edited_version: edited_version || null,
        added_as_training: false,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
