/**
 * Push AI-generated drafts to Gmail as actual Gmail drafts.
 * This allows the user to review/edit/send from Gmail directly.
 */

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import {
  createDraft,
  updateDraft,
  draftExists,
  getHeader,
  getMessage,
  getSignature,
  buildRawMessage,
} from "./client";
import { buildQuotedText, buildQuotedHtml, stripQuotedText } from "./quote";
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

  // Load the thread to get reply context and provider_thread_id
  let inReplyTo: string | null = null;
  let references: string | null = null;
  let replyToEmail: string | null = null;
  let providerThreadId: string | null = null;
  let quote: { text: string; html: string } | undefined;

  if (draft.thread_id) {
    // Get provider_thread_id for Gmail threading
    const { data: thread } = await supabase
      .from("email_threads")
      .select("provider_thread_id, sender_name, sender_email")
      .eq("id", draft.thread_id)
      .single();

    if (thread) {
      providerThreadId = thread.provider_thread_id;
    }

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

      // Quote the message being replied to, like Gmail's own compose does.
      // Its body carries the thread's earlier quote chain, so recipients
      // CC'd for the first time (agent handoffs) see the full context.
      if (lastMsg.from_email && lastMsg.body_text) {
        const senderName =
          thread?.sender_email &&
          thread.sender_email.toLowerCase() === lastMsg.from_email.toLowerCase()
            ? thread.sender_name
            : null;
        const source = {
          receivedAt: lastMsg.received_at ?? lastMsg.created_at,
          senderName,
          senderEmail: lastMsg.from_email,
          bodyText: lastMsg.body_text,
          bodyHtml: lastMsg.body_html,
        };
        quote = {
          text: buildQuotedText(source),
          html: buildQuotedHtml(source),
        };
      }

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

  // Fetch Gmail signature to include in the draft
  let signatureHtml: string | undefined;
  try {
    const sig = await getSignature(account.id, creds, account.email_address);
    if (sig) signatureHtml = sig;
  } catch {
    // Non-critical: draft will work without signature
  }

  const raw = buildRawMessage({
    from: account.email_address,
    to: replyToEmail ?? "",
    subject: draft.subject ?? "",
    bodyText: draft.body_text ?? "",
    cc: draft.cc_emails?.length ? draft.cc_emails : undefined,
    inReplyTo: inReplyTo ?? undefined,
    references: references ?? undefined,
    signatureHtml,
    quote,
  });

  let gmailDraftId: string;

  if (draft.provider_draft_id) {
    // Update existing Gmail draft
    const result = await updateDraft(account.id, creds, draft.provider_draft_id, raw, providerThreadId ?? undefined);
    gmailDraftId = result.id;
    logger.info("Updated Gmail draft", { draftId: draft.id, gmailDraftId });
  } else {
    // Create new Gmail draft
    const result = await createDraft(account.id, creds, raw, providerThreadId ?? undefined);
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
    .in("status", ["drafted", "approved"])
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

/**
 * Check approved drafts that were pushed to Gmail — if the Gmail draft
 * was deleted (user decided not to send), mark it as "discarded" in our app.
 *
 * Important: Sending a draft from Gmail also makes the Gmail draft disappear
 * (it gets converted into a sent message). To avoid mis-flagging a sent reply
 * as discarded, we first look for an outbound message on the same thread that
 * arrived after the draft was created — if one exists, the draft was sent and
 * we mark it accordingly. We also defer the decision for drafts approved
 * within the last few minutes, giving sync-sent time to record the outbound
 * message before we make a call.
 */
const APPROVE_GRACE_MS = 10 * 60 * 1000;

export async function reconcileDeletedDrafts(): Promise<{ discarded: number; sent: number }> {
  // Find drafted/approved drafts that have been pushed to Gmail
  const { data: drafts, error } = await supabase
    .from("email_drafts")
    .select("id, provider_draft_id, email_account_id, thread_id, status, body_text, created_at, approved_at")
    .in("status", ["drafted", "approved"])
    .eq("is_simulation", false)
    .not("provider_draft_id", "is", null)
    .not("email_account_id", "is", null);

  if (error || !drafts || drafts.length === 0) return { discarded: 0, sent: 0 };

  let discarded = 0;
  let sent = 0;

  // Group by account to reuse credentials
  const byAccount: Record<string, typeof drafts> = {};
  for (const d of drafts) {
    const key = d.email_account_id!;
    if (!byAccount[key]) byAccount[key] = [];
    byAccount[key].push(d);
  }

  for (const [accountId, accountDrafts] of Object.entries(byAccount)) {
    const { data: account } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", accountId)
      .single();

    if (!account?.credentials) continue;
    const creds = account.credentials as GmailCredentials;

    for (const draft of accountDrafts) {
      try {
        const exists = await draftExists(accountId, creds, draft.provider_draft_id!);
        if (exists) continue;

        // Gmail draft is gone — figure out whether it was sent or discarded.
        let outbound: { body_text: string | null; received_at: string | null } | null = null;
        if (draft.thread_id) {
          const { data: outboundRows } = await supabase
            .from("email_messages")
            .select("body_text, received_at")
            .eq("thread_id", draft.thread_id)
            .eq("direction", "outbound")
            .gte("received_at", draft.created_at)
            .order("received_at", { ascending: false })
            .limit(1);
          outbound = outboundRows?.[0] ?? null;
        }

        if (outbound) {
          const sentAt = outbound.received_at ?? new Date().toISOString();
          const sentBody = outbound.body_text ?? "";
          // Sent bodies include the quoted-history trailer the draft body
          // never has — strip it so only real edits count as changes.
          const wasChanged =
            stripQuotedText(sentBody).replace(/\s+/g, " ").trim() !==
            (draft.body_text ?? "").replace(/\s+/g, " ").trim();
          await supabase
            .from("email_drafts")
            .update({
              status: "sent",
              sent_at: sentAt,
              sent_body_text: sentBody,
              was_changed: wasChanged,
            })
            .eq("id", draft.id);
          sent++;
          logger.info("Draft reconciled as sent — outbound message found", {
            draftId: draft.id,
            gmailDraftId: draft.provider_draft_id,
          });
          continue;
        }

        // No outbound message yet. If the user just approved, give sync-sent
        // a chance to catch up before we mark this discarded.
        if (draft.status === "approved" && draft.approved_at) {
          const approvedMs = new Date(draft.approved_at).getTime();
          if (Date.now() - approvedMs < APPROVE_GRACE_MS) {
            logger.info("Deferring discard for recently-approved draft", {
              draftId: draft.id,
              gmailDraftId: draft.provider_draft_id,
            });
            continue;
          }
        }

        await supabase
          .from("email_drafts")
          .update({ status: "discarded" })
          .eq("id", draft.id);
        discarded++;
        logger.info("Draft discarded — deleted from Gmail", {
          draftId: draft.id,
          gmailDraftId: draft.provider_draft_id,
        });
      } catch (err) {
        logger.warn("Failed to check Gmail draft status", {
          draftId: draft.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (discarded > 0 || sent > 0) {
    logger.info("Draft reconciliation complete", { discarded, sent });
  }

  return { discarded, sent };
}
