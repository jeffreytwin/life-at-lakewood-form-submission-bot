/**
 * Gmail sent-folder sync: detects when drafts are sent from Gmail,
 * captures the actual sent text, and compares to the AI-generated draft.
 */

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import {
  getMessage,
  getHeader,
  extractBodyText,
  listMessages,
  listHistory,
  getProfile,
} from "./client";
import type { EmailAccount, GmailCredentials } from "@/lib/supabase/types";

/**
 * Sync sent folder for a single email account.
 * Matches sent messages to existing threads/drafts and captures the sent body.
 */
export async function syncSentFolder(account: EmailAccount): Promise<{
  sentMatched: number;
  changedFromDraft: number;
}> {
  const creds = account.credentials as GmailCredentials | null;
  if (!creds) return { sentMatched: 0, changedFromDraft: 0 };

  let messageIds: Array<{ id: string; threadId: string }> = [];

  if (account.sent_sync_history_id) {
    // Incremental sync
    const { history, historyId } = await listHistory(
      account.id,
      creds,
      account.sent_sync_history_id,
      "SENT"
    );

    for (const entry of history) {
      if (entry.messagesAdded) {
        for (const added of entry.messagesAdded) {
          if (added.message.labelIds?.includes("SENT")) {
            messageIds.push({ id: added.message.id, threadId: added.message.threadId });
          }
        }
      }
    }

    await supabase
      .from("email_accounts")
      .update({ sent_sync_history_id: historyId })
      .eq("id", account.id);
  } else {
    // First sync: get recent sent messages (last 50)
    messageIds = await listMessages(account.id, creds, "in:sent", 50);

    const profile = await getProfile(account.id, creds);
    await supabase
      .from("email_accounts")
      .update({ sent_sync_history_id: profile.historyId })
      .eq("id", account.id);
  }

  let sentMatched = 0;
  let changedFromDraft = 0;

  for (const ref of messageIds) {
    try {
      const result = await processSentMessage(account, ref.id, ref.threadId);
      if (result.matched) sentMatched++;
      if (result.changed) changedFromDraft++;
    } catch (err) {
      logger.error("Failed to process sent message", {
        accountId: account.id,
        messageId: ref.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Sent folder sync complete", {
    accountId: account.id,
    email: account.email_address,
    sentMatched,
    changedFromDraft,
  });

  return { sentMatched, changedFromDraft };
}

/**
 * Process a single sent message: find matching draft, compare body, update.
 */
async function processSentMessage(
  account: EmailAccount,
  gmailMessageId: string,
  gmailThreadId: string
): Promise<{ matched: boolean; changed: boolean }> {
  const creds = account.credentials as GmailCredentials;

  // Find our thread by provider_thread_id
  const { data: thread } = await supabase
    .from("email_threads")
    .select("id")
    .eq("email_account_id", account.id)
    .eq("provider_thread_id", gmailThreadId)
    .limit(1);

  if (!thread || thread.length === 0) return { matched: false, changed: false };

  const threadId = thread[0].id;

  // Check if we already processed this sent message
  const { data: existingMsg } = await supabase
    .from("email_messages")
    .select("id")
    .eq("provider_message_id", gmailMessageId)
    .limit(1);

  if (existingMsg && existingMsg.length > 0) return { matched: false, changed: false };

  // Fetch the full message
  const msg = await getMessage(account.id, creds, gmailMessageId);
  const fromEmail = parseEmailAddress(getHeader(msg, "From") ?? "");

  // Only process outbound messages (from our account)
  if (fromEmail.toLowerCase() !== account.email_address.toLowerCase()) {
    return { matched: false, changed: false };
  }

  const sentBodyText = extractBodyText(msg);
  const toEmail = parseEmailAddress(getHeader(msg, "To") ?? "");
  const subject = getHeader(msg, "Subject") ?? "(no subject)";
  const sentAt = msg.internalDate
    ? new Date(parseInt(msg.internalDate)).toISOString()
    : new Date().toISOString();

  // Store outbound message
  await supabase.from("email_messages").insert({
    thread_id: threadId,
    provider_message_id: gmailMessageId,
    direction: "outbound" as const,
    from_email: fromEmail,
    to_email: toEmail,
    subject,
    body_text: sentBodyText,
    body_html: null,
    received_at: sentAt,
  });

  // Find the most recent drafted/edited draft for this thread
  const { data: drafts } = await supabase
    .from("email_drafts")
    .select("*")
    .eq("thread_id", threadId)
    .eq("email_account_id", account.id)
    .in("status", ["drafted", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (!drafts || drafts.length === 0) return { matched: false, changed: false };

  const draft = drafts[0];
  const originalDraftText = draft.body_text ?? "";
  const wasChanged = normalizeForComparison(sentBodyText) !== normalizeForComparison(originalDraftText);

  // Update draft with sent info
  await supabase
    .from("email_drafts")
    .update({
      status: "sent",
      sent_at: sentAt,
      sent_body_text: sentBodyText,
      was_changed: wasChanged,
    })
    .eq("id", draft.id);

  logger.info("Matched sent message to draft", {
    draftId: draft.id,
    threadId,
    wasChanged,
  });

  return { matched: true, changed: wasChanged };
}

/**
 * Normalize text for comparison: trim whitespace, collapse runs, lowercase.
 */
function normalizeForComparison(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}

function parseEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

/**
 * Sync sent folder for all active Gmail accounts.
 */
export async function syncAllSentFolders(): Promise<{
  accounts: number;
  totalMatched: number;
  totalChanged: number;
}> {
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("provider", "gmail")
    .eq("is_active", true)
    .not("credentials", "is", null);

  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  if (!accounts || accounts.length === 0) {
    return { accounts: 0, totalMatched: 0, totalChanged: 0 };
  }

  let totalMatched = 0;
  let totalChanged = 0;

  for (const account of accounts) {
    try {
      const result = await syncSentFolder(account as EmailAccount);
      totalMatched += result.sentMatched;
      totalChanged += result.changedFromDraft;
    } catch (err) {
      logger.error("Sent folder sync failed", {
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { accounts: accounts.length, totalMatched, totalChanged };
}
