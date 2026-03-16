/**
 * Gmail inbox sync: polls for new inbound emails, upserts threads/messages,
 * and triggers AI draft generation for new conversations.
 */

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import {
  getMessage,
  getHeader,
  extractBodyText,
  extractBodyHtml,
  listMessages,
  listHistory,
  getProfile,
  type GmailMessage,
} from "./client";
import { generateDraft } from "@/lib/ai/draft-generator";
import type { EmailAccount, GmailCredentials } from "@/lib/supabase/types";

/**
 * Sync inbox for a single email account.
 * Uses Gmail History API for incremental sync, falls back to full query on first run.
 */
export async function syncInbox(account: EmailAccount): Promise<{
  newMessages: number;
  draftsGenerated: number;
}> {
  const creds = account.credentials as GmailCredentials | null;
  if (!creds) {
    logger.warn("No credentials for account, skipping", { accountId: account.id });
    return { newMessages: 0, draftsGenerated: 0 };
  }

  let messageIds: Array<{ id: string; threadId: string }> = [];

  if (account.sync_history_id) {
    // Incremental sync via History API
    const { history, historyId } = await listHistory(
      account.id,
      creds,
      account.sync_history_id,
      "INBOX"
    );

    for (const entry of history) {
      if (entry.messagesAdded) {
        for (const added of entry.messagesAdded) {
          if (added.message.labelIds?.includes("INBOX")) {
            messageIds.push({ id: added.message.id, threadId: added.message.threadId });
          }
        }
      }
    }

    // Update history cursor
    await supabase
      .from("email_accounts")
      .update({ sync_history_id: historyId, last_synced_at: new Date().toISOString() })
      .eq("id", account.id);
  } else {
    // First sync: get recent inbox messages
    messageIds = await listMessages(account.id, creds, "in:inbox is:unread", 50);

    // Store current history ID for future incremental syncs
    const profile = await getProfile(account.id, creds);
    await supabase
      .from("email_accounts")
      .update({
        sync_history_id: profile.historyId,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", account.id);
  }

  let newMessages = 0;
  let draftsGenerated = 0;

  for (const ref of messageIds) {
    // Skip if we already have this message
    const { data: existing } = await supabase
      .from("email_messages")
      .select("id")
      .eq("provider_message_id", ref.id)
      .limit(1);

    if (existing && existing.length > 0) continue;

    try {
      const msg = await getMessage(account.id, creds, ref.id);
      const result = await processInboundMessage(account, msg);
      newMessages++;
      if (result.draftGenerated) draftsGenerated++;
    } catch (err) {
      logger.error("Failed to process message", {
        accountId: account.id,
        messageId: ref.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Inbox sync complete", {
    accountId: account.id,
    email: account.email_address,
    newMessages,
    draftsGenerated,
  });

  return { newMessages, draftsGenerated };
}

/**
 * Process a single inbound Gmail message: upsert thread, store message, generate draft.
 */
async function processInboundMessage(
  account: EmailAccount,
  msg: GmailMessage
): Promise<{ draftGenerated: boolean }> {
  const fromEmail = parseEmailAddress(getHeader(msg, "From") ?? "");
  const toEmail = parseEmailAddress(getHeader(msg, "To") ?? "");
  const subject = getHeader(msg, "Subject") ?? "(no subject)";
  const messageId = getHeader(msg, "Message-ID");
  const receivedAt = msg.internalDate
    ? new Date(parseInt(msg.internalDate)).toISOString()
    : new Date().toISOString();

  // Skip messages FROM our own account (outbound)
  if (fromEmail.toLowerCase() === account.email_address.toLowerCase()) {
    return { draftGenerated: false };
  }

  // Upsert thread
  const threadId = await upsertThread(account, msg.threadId, subject, fromEmail);

  // Store message
  const bodyText = extractBodyText(msg);
  const bodyHtml = extractBodyHtml(msg);

  await supabase.from("email_messages").insert({
    thread_id: threadId,
    provider_message_id: msg.id,
    direction: "inbound" as const,
    from_email: fromEmail,
    to_email: toEmail,
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    received_at: receivedAt,
  });

  // Update thread last_message_at
  await supabase
    .from("email_threads")
    .update({ last_message_at: receivedAt })
    .eq("id", threadId);

  // Generate AI draft reply
  const draftGenerated = await generateAndStoreDraft(account, threadId, subject, messageId);

  return { draftGenerated };
}

/**
 * Upsert a thread record keyed by provider_thread_id.
 */
async function upsertThread(
  account: EmailAccount,
  gmailThreadId: string,
  subject: string,
  senderEmail: string
): Promise<string> {
  // Check for existing thread
  const { data: existing } = await supabase
    .from("email_threads")
    .select("id")
    .eq("email_account_id", account.id)
    .eq("provider_thread_id", gmailThreadId)
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id;

  // Parse sender name from email
  const senderName = senderEmail.includes("<")
    ? senderEmail.split("<")[0].trim().replace(/"/g, "")
    : null;

  const { data, error } = await supabase
    .from("email_threads")
    .insert({
      email_account_id: account.id,
      provider_thread_id: gmailThreadId,
      subject,
      sender_email: parseEmailAddress(senderEmail),
      sender_name: senderName,
      location_id: account.location_id,
      last_message_at: new Date().toISOString(),
      is_active: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create thread: ${error.message}`);
  return data.id;
}

/**
 * Generate an AI draft and store it in the database.
 */
async function generateAndStoreDraft(
  account: EmailAccount,
  threadId: string,
  subject: string,
  inReplyToMessageId: string | null
): Promise<boolean> {
  try {
    // Load full conversation thread for context
    const { data: messages } = await supabase
      .from("email_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("received_at", { ascending: true });

    if (!messages || messages.length === 0) return false;

    // Build conversation text
    const conversationThread = messages
      .map((m) => {
        const dir = m.direction === "inbound" ? "From" : "To";
        return `${dir}: ${m.from_email}\n${m.body_text ?? ""}`;
      })
      .join("\n---\n");

    // Resolve location name
    let locationName = "General";
    if (account.location_id) {
      const { data: loc } = await supabase
        .from("locations")
        .select("name")
        .eq("id", account.location_id)
        .single();
      locationName = loc?.name ?? "General";
    }

    const draft = await generateDraft({
      locationName,
      locationId: account.location_id,
      conversationThread,
    });

    // Store draft in DB
    await supabase.from("email_drafts").insert({
      thread_id: threadId,
      email_account_id: account.id,
      status: "drafted",
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      body_text: draft.bodyText,
      model_used: draft.modelUsed,
      prompt_tokens: draft.promptTokens,
      completion_tokens: draft.completionTokens,
      is_simulation: false,
      cc_emails: [],
      edited_at: null,
      sent_at: null,
      sent_body_text: null,
      was_changed: false,
    });

    logger.info("AI draft generated for thread", { threadId, accountId: account.id });
    return true;
  } catch (err) {
    logger.error("Draft generation failed", {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Parse an email address from a "Name <email>" or plain "email" format.
 */
function parseEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

/**
 * Sync all active Gmail accounts.
 */
export async function syncAllInboxes(): Promise<{
  accounts: number;
  totalNewMessages: number;
  totalDraftsGenerated: number;
}> {
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("provider", "gmail")
    .eq("is_active", true)
    .not("credentials", "is", null);

  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  if (!accounts || accounts.length === 0) {
    return { accounts: 0, totalNewMessages: 0, totalDraftsGenerated: 0 };
  }

  let totalNewMessages = 0;
  let totalDraftsGenerated = 0;

  for (const account of accounts) {
    try {
      const result = await syncInbox(account as EmailAccount);
      totalNewMessages += result.newMessages;
      totalDraftsGenerated += result.draftsGenerated;
    } catch (err) {
      logger.error("Account sync failed", {
        accountId: account.id,
        email: account.email_address,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    accounts: accounts.length,
    totalNewMessages,
    totalDraftsGenerated,
  };
}
