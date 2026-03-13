/**
 * Push AI-generated drafts to Gmail as actual Gmail drafts.
 * This allows the user to review/edit/send from Gmail directly.
 */

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import {
  createDraft,
  updateDraft,
  getHeader,
  getMessage,
  buildRawMessage,
} from "./client";
import type { EmailAccount, EmailDraft, GmailCredentials } from "@/lib/supabase/types";

/**
 * Push a single draft to Gmail. Creates or updates the Gmail draft.
 * Returns the Gmail draft ID.
 */
export async function pushDraftToGmail(
  account: EmailAccount,
  draft: EmailDraft
): Promise<string> {
  const creds = account.credentials as GmailCredentials | null;
  if (!creds) throw new Error("Account has no Gmail credentials");

  // Load the thread to get reply context
  let inReplyTo: string | null = null;
  let references: string | null = null;
  let replyToEmail: string | null = null;

  if (draft.thread_id) {
    // Get the last inbound message in the thread for reply headers
    const { data: messages } = await supabase
      .from("email_messages")
      .select("*")
      .eq("thread_id", draft.thread_id)
      .eq("direction", "inbound")
      .order("received_at", { ascending: false })
      .limit(1);

    if (messages && messages.length > 0) {
      const lastMsg = messages[0];
      replyToEmail = lastMsg.from_email;

      // Get the Gmail message to extract Message-ID header
      if (lastMsg.provider_message_id) {
        try {
          const gmailMsg = await getMessage(account.id, creds, lastMsg.provider_message_id);
          inReplyTo = getHeader(gmailMsg, "Message-ID");
          references = getHeader(gmailMsg, "References");
          if (inReplyTo) {
            references = references ? `${references} ${inReplyTo}` : inReplyTo;
          }
        } catch {
          // Non-critical: draft will work without reply headers
        }
      }
    }
  }

  const raw = buildRawMessage({
    from: account.email_address,
    to: replyToEmail ?? "",
    subject: draft.subject ?? "",
    bodyText: draft.body_text ?? "",
    cc: draft.cc_emails?.length ? draft.cc_emails : undefined,
    inReplyTo: inReplyTo ?? undefined,
    references: references ?? undefined,
  });

  let gmailDraftId: string;

  if (draft.provider_draft_id) {
    // Update existing Gmail draft
    const result = await updateDraft(account.id, creds, draft.provider_draft_id, raw);
    gmailDraftId = result.id;
    logger.info("Updated Gmail draft", { draftId: draft.id, gmailDraftId });
  } else {
    // Create new Gmail draft
    const result = await createDraft(account.id, creds, raw);
    gmailDraftId = result.id;
    logger.info("Created Gmail draft", { draftId: draft.id, gmailDraftId });
  }

  // Store the Gmail draft ID
  await supabase
    .from("email_drafts")
    .update({ provider_draft_id: gmailDraftId })
    .eq("id", draft.id);

  return gmailDraftId;
}

/**
 * Push all unpushed drafts (no provider_draft_id yet) to Gmail.
 */
export async function pushAllPendingDrafts(): Promise<{
  pushed: number;
  failed: number;
}> {
  // Find drafts that haven't been pushed to Gmail yet
  const { data: drafts, error } = await supabase
    .from("email_drafts")
    .select("*")
    .is("provider_draft_id", null)
    .in("status", ["drafted", "edited"])
    .eq("is_simulation", false)
    .not("thread_id", "is", null)
    .not("email_account_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load pending drafts: ${error.message}`);
  if (!drafts || drafts.length === 0) return { pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;

  for (const draft of drafts) {
    // Load the account for this draft
    const { data: account } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", draft.email_account_id)
      .single();

    if (!account?.credentials) {
      logger.warn("No credentials for draft account", { draftId: draft.id });
      failed++;
      continue;
    }

    try {
      await pushDraftToGmail(account as EmailAccount, draft as EmailDraft);
      pushed++;
    } catch (err) {
      logger.error("Failed to push draft to Gmail", {
        draftId: draft.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  logger.info("Push drafts complete", { pushed, failed });
  return { pushed, failed };
}
