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

    // Load thread messages if draft has a thread
    let thread_messages: unknown[] = [];
    if (draft.thread_id) {
      const { data: messages } = await supabase
        .from("email_messages")
        .select("*")
        .eq("thread_id", draft.thread_id)
        .order("received_at", { ascending: false });
      thread_messages = messages ?? [];
    }

    return NextResponse.json({ ...draft, feedback: feedback ?? [], thread_messages });
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
    const { body_text, status, cc_emails } = body;

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
      updates.edited_at = new Date().toISOString();
    }
    if (cc_emails !== undefined) {
      updates.cc_emails = cc_emails;
    }
    if (status !== undefined) {
      updates.status = status;
      if (status === "sent") {
        updates.sent_at = new Date().toISOString();
      }
    }

    // Load full draft before update (need provider_draft_id for Gmail delete)
    const { data: fullDraft } = await supabase
      .from("email_drafts")
      .select("*, email_accounts(id, credentials)")
      .eq("id", id)
      .single();

    const { data, error } = await supabase
      .from("email_drafts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // If discarding, delete the Gmail draft too
    if (status === "discarded" && fullDraft?.provider_draft_id && fullDraft?.email_account_id) {
      try {
        const { deleteDraft } = await import("@/lib/gmail/client");
        const account = fullDraft.email_accounts as { id: string; credentials: import("@/lib/supabase/types").GmailCredentials | null } | null;
        if (account?.credentials) {
          await deleteDraft(fullDraft.email_account_id, account.credentials, fullDraft.provider_draft_id);
        }
      } catch (deleteError) {
        // Non-blocking: draft is discarded locally even if Gmail delete fails
        console.warn("Gmail draft delete failed:", deleteError);
      }
    }

    // Sync edits to Gmail draft if connected (only for non-discard updates)
    if (status !== "discarded" && data.provider_draft_id && data.email_account_id) {
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
