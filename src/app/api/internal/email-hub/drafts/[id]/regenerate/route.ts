import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { generateDraft } from "@/lib/ai/draft-generator";
import { stripQuotedText } from "@/lib/gmail/quote";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/internal/email-hub/drafts/:id/regenerate
 *
 * Regenerates an AI draft for an existing draft record.
 * Replaces the body_text with a fresh AI generation using the same
 * thread context. Only works on non-sent, non-discarded drafts.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Load the draft with account and thread info
    const { data: draft, error: draftError } = await supabase
      .from("email_drafts")
      .select(
        "*, email_accounts(id, email_address, display_name, location_id, locations(id, name))"
      )
      .eq("id", id)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.status === "sent" || draft.status === "discarded") {
      return NextResponse.json(
        { error: "Cannot regenerate a sent or discarded draft" },
        { status: 400 }
      );
    }

    const account = draft.email_accounts as {
      id: string;
      email_address: string;
      display_name: string | null;
      location_id: string | null;
      locations: { id: string; name: string } | null;
    } | null;

    const locationName =
      account?.locations?.name ?? account?.display_name ?? "General";
    const locationId = account?.location_id ?? null;

    // Load conversation thread
    let conversationThread = "";
    if (draft.thread_id) {
      const { data: messages } = await supabase
        .from("email_messages")
        .select("*")
        .eq("thread_id", draft.thread_id)
        .order("received_at", { ascending: true });

      if (messages && messages.length > 0) {
        conversationThread = messages
          .map((m: { direction: string; from_email: string | null; body_text: string | null }) => {
            const dir = m.direction === "inbound" ? "From" : "To";
            // Our own sent replies carry a quoted-history trailer; strip it
            // so the prompt doesn't repeat every earlier message.
            const body =
              m.direction === "outbound"
                ? stripQuotedText(m.body_text ?? "")
                : (m.body_text ?? "");
            return `${dir}: ${m.from_email}\n${body}`;
          })
          .join("\n---\n");
      }
    }

    // Generate a new draft
    const newDraft = await generateDraft({
      locationName,
      locationId,
      emailAddress: account?.email_address ?? null,
      conversationThread,
    });

    // Update the draft with the new body
    const { data: updated, error: updateError } = await supabase
      .from("email_drafts")
      .update({
        body_text: newDraft.bodyText,
        model_used: newDraft.modelUsed,
        prompt_tokens: newDraft.promptTokens,
        completion_tokens: newDraft.completionTokens,
        edited_at: new Date().toISOString(),
        status: "drafted",
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Sync to Gmail if connected
    if (updated.provider_draft_id && updated.email_account_id) {
      try {
        const { pushDraftToGmail } = await import("@/lib/gmail/push-draft");
        const { data: fullAccount } = await supabase
          .from("email_accounts")
          .select("*")
          .eq("id", updated.email_account_id)
          .single();

        if (fullAccount?.credentials) {
          await pushDraftToGmail(
            fullAccount as import("@/lib/supabase/types").EmailAccount,
            updated as import("@/lib/supabase/types").EmailDraft
          );
        }
      } catch (syncError) {
        console.warn("Gmail draft sync failed after regeneration:", syncError);
      }
    }

    logger.info("Draft regenerated", { draftId: id });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Draft regeneration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
