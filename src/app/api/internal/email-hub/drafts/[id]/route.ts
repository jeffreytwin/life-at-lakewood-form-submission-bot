import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: draft, error } = await supabase
      .from("email_drafts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // Load feedback for this draft
    const { data: feedback } = await supabase
      .from("draft_feedback")
      .select("*")
      .eq("draft_id", id)
      .order("created_at", { ascending: false });

    return NextResponse.json({ ...draft, feedback: feedback ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { body_text, status } = body;

    // Check current draft status - can't edit sent drafts
    const { data: existing, error: fetchError } = await supabase
      .from("email_drafts")
      .select("status")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (existing.status === "sent") {
      return NextResponse.json(
        { error: "Cannot edit a sent draft" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (body_text !== undefined) {
      updates.body_text = body_text;
      updates.status = "edited";
      updates.edited_at = new Date().toISOString();
    }
    if (status !== undefined) {
      updates.status = status;
      if (status === "sent") {
        updates.sent_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from("email_drafts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Sync edits to Gmail draft if connected
    if (data.provider_draft_id && data.email_account_id) {
      try {
        const { pushDraftToGmail } = await import("@/lib/gmail/push-draft");
        const { data: account } = await supabase
          .from("email_accounts")
          .select("*")
          .eq("id", data.email_account_id)
          .single();

        if (account?.credentials) {
          await pushDraftToGmail(
            account as import("@/lib/supabase/types").EmailAccount,
            data as import("@/lib/supabase/types").EmailDraft
          );
        }
      } catch (syncError) {
        // Non-blocking: draft is saved locally even if Gmail sync fails
        console.warn("Gmail draft sync failed:", syncError);
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
