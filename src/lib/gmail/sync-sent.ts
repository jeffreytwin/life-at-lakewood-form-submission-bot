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
import { triggerAgentHandoff } from "./trigger-handoff";
import { stripQuotedText } from "./quote";
import {
  updateDraftLeadStatus,
  senderAlreadyHasLeadStatus,
} from "@/lib/email/update-lead-status";
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
  const ccEmails = parseEmailList(getHeader(msg, "Cc") ?? "");
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
  // Sent bodies include the quoted-history trailer the draft body never
  // has — strip it so only real edits count as changes.
  const wasChanged =
    normalizeForComparison(stripQuotedText(sentBodyText)) !==
    normalizeForComparison(originalDraftText);

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

  // Reconcile the draft's agent_handoff_id against the actual CC header —
  // this catches manual CC edits the user made before sending, and also
  // acts as a backstop for any miss in the draft-time reconciler.
  const resolvedHandoffId = draft.agent_handoff_transferred
    ? (draft.agent_handoff_id as string | null)
    : await reconcileHandoffToSentCc({
        draftId: draft.id,
        currentHandoffId: (draft.agent_handoff_id as string | null) ?? null,
        sentCcEmails: ccEmails,
      });

  // If a handoff agent is resolved and this draft hasn't been transferred
  // yet, auto-fire the Salesforce owner-change + agent-SMS routine now
  // that the email has actually gone out.
  let handoffFired = false;
  if (resolvedHandoffId && !draft.agent_handoff_transferred) {
    try {
      const result = await triggerAgentHandoff(draft.id, resolvedHandoffId);
      if (result.success) {
        handoffFired = true;
      } else {
        logger.error("Auto handoff on send failed", {
          draftId: draft.id,
          error: result.error,
        });
      }
    } catch (err) {
      logger.error("Auto handoff on send threw", {
        draftId: draft.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Every handoff implies the lead is in nurture_active territory. If we
  // haven't already marked it (either via the manual UI button or because
  // it's already that status in Salesforce), fire the status update too.
  // Failures here are non-blocking — the handoff itself already succeeded.
  if (handoffFired && !draft.lead_status_update) {
    try {
      const senderEmail = await getThreadSenderEmail(draft.thread_id as string);
      const alreadyNurture = await senderAlreadyHasLeadStatus(senderEmail, "nurture_active");
      if (!alreadyNurture) {
        const res = await updateDraftLeadStatus(draft.id, "nurture_active");
        if (!res.success && !res.alreadyApplied) {
          logger.warn("Auto nurture-active update failed", {
            draftId: draft.id,
            error: res.error,
          });
        }
      } else {
        logger.info("Skipped auto nurture-active update — sender already in that status", {
          draftId: draft.id,
          senderEmail,
        });
      }
    } catch (err) {
      logger.warn("Auto nurture-active update threw", {
        draftId: draft.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { matched: true, changed: wasChanged };
}

async function getThreadSenderEmail(threadId: string): Promise<string | null> {
  const { data } = await supabase
    .from("email_threads")
    .select("sender_email")
    .eq("id", threadId)
    .single();
  return data?.sender_email ?? null;
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

export function parseEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

export function parseEmailList(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => parseEmailAddress(s.trim()))
    .filter((s) => s.length > 0);
}

/**
 * Reconcile the draft's `agent_handoff_id` against the actual CC header of
 * the sent message. If a user manually changed the CC before sending, the
 * draft row's stored handoff won't match what actually went out; we update
 * it here so the downstream transfer fires for the real CC'd agent.
 *
 * Returns the resolved handoff agent id (possibly the same as before, or
 * null if no active agent is CC'd).
 */
async function reconcileHandoffToSentCc(params: {
  draftId: string;
  currentHandoffId: string | null;
  sentCcEmails: string[];
}): Promise<string | null> {
  const { draftId, currentHandoffId, sentCcEmails } = params;

  if (sentCcEmails.length === 0) {
    if (currentHandoffId) {
      await supabase
        .from("email_drafts")
        .update({ agent_handoff_id: null, cc_emails: [] })
        .eq("id", draftId);
      logger.info("Cleared agent_handoff_id on send (no CC on sent message)", {
        draftId,
        previousHandoffId: currentHandoffId,
      });
    }
    return null;
  }

  const { data: agents } = await supabase
    .from("agents")
    .select("id, email")
    .eq("is_active", true)
    .not("email", "is", null);

  const lowerCc = sentCcEmails.map((e) => e.toLowerCase());
  const matched = (agents ?? []).find(
    (a) => a.email && lowerCc.includes(a.email.toLowerCase())
  );

  if (!matched) {
    if (currentHandoffId) {
      await supabase
        .from("email_drafts")
        .update({ agent_handoff_id: null, cc_emails: sentCcEmails })
        .eq("id", draftId);
      logger.info("Cleared agent_handoff_id on send (no active agent in CC)", {
        draftId,
        previousHandoffId: currentHandoffId,
        sentCcEmails,
      });
    }
    return null;
  }

  if (matched.id !== currentHandoffId) {
    await supabase
      .from("email_drafts")
      .update({ agent_handoff_id: matched.id, cc_emails: sentCcEmails })
      .eq("id", draftId);
    logger.info("Reconciled agent_handoff_id to match sent CC", {
      draftId,
      previousHandoffId: currentHandoffId,
      newHandoffId: matched.id,
      sentCcEmails,
    });
  } else {
    // Still sync cc_emails in case the user added/removed other CCs while
    // keeping the same agent.
    await supabase
      .from("email_drafts")
      .update({ cc_emails: sentCcEmails })
      .eq("id", draftId);
  }

  return matched.id;
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
