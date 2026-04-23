/**
 * Gmail inbox sync: polls for new inbound emails, upserts threads/messages,
 * and fires a Zapier webhook to get fresh Salesforce data for every sender.
 *
 * Draft generation is NOT done here — it happens in the Zapier callback
 * (/api/webhooks/salesforce-contacts) after Salesforce confirms the contact
 * and returns current ownership info. This ensures drafts always use
 * authoritative data instead of potentially stale local records.
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
import { getTwilioClient, getTwilioPhoneNumber } from "@/lib/twilio/client";
import type { EmailAccount, GmailCredentials } from "@/lib/supabase/types";

export interface MatchedContact {
  id: string;
  salesforce_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  budget: string | null;
  timeline: string | null;
  property_interest: string | null;
  lead_status: string | null;
  location_name: string | null;
  salesforce_owner_id: string | null;
  salesforce_owner_name: string | null;
  is_master_agent_owned: boolean | null;
}

/**
 * Sync inbox for a single email account.
 * Uses Gmail History API for incremental sync, falls back to full query on first run.
 */
export async function syncInbox(account: EmailAccount): Promise<{
  newMessages: number;
  draftsGenerated: number;
  skippedNonLead: number;
}> {
  const creds = account.credentials as GmailCredentials | null;
  if (!creds) {
    logger.warn("No credentials for account, skipping", { accountId: account.id });
    return { newMessages: 0, draftsGenerated: 0, skippedNonLead: 0 };
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

    // Safety net: always cross-check with a direct inbox query for recent
    // emails. The History API can miss messages during rapid bursts when a
    // push notification arrives before Gmail has indexed the new message.
    // Downstream dedup on provider_message_id prevents double-processing.
    const fallback = await listMessages(account.id, creds, "in:inbox newer_than:5m", 10);
    if (fallback.length > 0) {
      const seen = new Set(messageIds.map(m => m.id));
      let merged = 0;
      for (const msg of fallback) {
        if (!seen.has(msg.id)) {
          messageIds.push(msg);
          merged++;
        }
      }
      if (merged > 0) {
        logger.info("Fallback query found messages missed by History API", {
          accountId: account.id,
          historyCount: messageIds.length - merged,
          mergedCount: merged,
        });
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
  let skippedNonLead = 0;

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
      if (result.skippedNonLead) skippedNonLead++;
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
    skippedNonLead,
  });

  return { newMessages, draftsGenerated, skippedNonLead };
}

/**
 * Check whether any of the given recipient emails belong to an active agent.
 * Used to skip auto-drafting when an agent is already on the thread.
 */
async function hasAgentRecipient(recipientEmails: string[]): Promise<boolean> {
  if (recipientEmails.length === 0) return false;

  const { data: agents } = await supabase
    .from("agents")
    .select("email")
    .eq("is_active", true)
    .not("email", "is", null);

  if (!agents || agents.length === 0) return false;

  const agentEmails = new Set(
    agents.map((a: { email: string | null }) => (a.email as string).toLowerCase())
  );

  return recipientEmails.some((r) => agentEmails.has(r));
}

/**
 * Match a sender email address to a known Salesforce contact.
 * Looks up by email (case-insensitive) in the salesforce_contacts table.
 * Only returns active contacts.
 */
async function matchSenderToContact(senderEmail: string): Promise<MatchedContact | null> {
  const { data: contacts } = await supabase
    .from("salesforce_contacts")
    .select("id, salesforce_id, email, first_name, last_name, phone, budget, timeline, property_interest, lead_status, location_name, salesforce_owner_id, salesforce_owner_name, is_master_agent_owned")
    .ilike("email", senderEmail)
    .eq("is_active", true)
    .order("synced_at", { ascending: false })
    .limit(1);

  if (!contacts || contacts.length === 0) return null;
  return contacts[0] as MatchedContact;
}

/**
 * Process a single inbound Gmail message: upsert thread, store message,
 * match to lead, and generate draft only if sender is a known lead.
 */
async function processInboundMessage(
  account: EmailAccount,
  msg: GmailMessage
): Promise<{ draftGenerated: boolean; skippedNonLead: boolean }> {
  const rawFrom = getHeader(msg, "From") ?? "";
  const fromEmail = parseEmailAddress(rawFrom);
  const toEmail = parseEmailAddress(getHeader(msg, "To") ?? "");
  const rawSubject = getHeader(msg, "Subject") ?? "(no subject)";
  // Clean non-breaking spaces that cause Â artifacts in email headers
  const subject = rawSubject.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");
  const messageId = getHeader(msg, "Message-ID");
  const receivedAt = msg.internalDate
    ? new Date(parseInt(msg.internalDate)).toISOString()
    : new Date().toISOString();

  // Skip messages FROM our own account (outbound)
  if (fromEmail.toLowerCase() === account.email_address.toLowerCase()) {
    return { draftGenerated: false, skippedNonLead: false };
  }

  // Skip if any recipient (To/Cc) is one of our agents — the agent has
  // already taken over this conversation so we shouldn't auto-draft.
  // Also skip if the sender IS an agent (e.g. agent emailing the client
  // and the message appears in the monitored inbox).
  const ccRaw = getHeader(msg, "Cc") ?? "";
  const ownEmail = account.email_address.toLowerCase();
  const allRecipients = [toEmail, ccRaw]
    .join(",")
    .split(",")
    .map((r) => parseEmailAddress(r.trim()).toLowerCase())
    .filter(Boolean);

  const senderIsAgent = await hasAgentRecipient([fromEmail.toLowerCase()]);
  if (senderIsAgent) {
    logger.info("Skipping draft — sender is an agent", {
      senderEmail: fromEmail,
      accountId: account.id,
    });
    return { draftGenerated: false, skippedNonLead: false };
  }

  // Exclude the monitored account's own email from the recipient check —
  // every inbound email is addressed TO this account, so including it
  // would cause every message to be incorrectly skipped.
  const otherRecipients = allRecipients.filter((r) => r !== ownEmail);
  const agentOnThread = await hasAgentRecipient(otherRecipients);
  if (agentOnThread) {
    logger.info("Skipping draft — another agent is a recipient on this email", {
      senderEmail: fromEmail,
      recipients: otherRecipients,
      accountId: account.id,
    });
    return { draftGenerated: false, skippedNonLead: false };
  }

  // Match sender to a known Salesforce contact
  const contact = await matchSenderToContact(fromEmail);

  // Upsert thread (with Salesforce ID link and owner info if matched)
  const threadId = await upsertThread(
    account,
    msg.threadId,
    subject,
    fromEmail,
    rawFrom,
    contact?.salesforce_id ?? null,
    contact
  );

  // Store message (always, even for non-leads — useful for auditing)
  // Uses upsert with ignoreDuplicates to prevent race conditions between
  // push notifications and cron sync processing the same message.
  const bodyText = extractBodyText(msg);
  const bodyHtml = extractBodyHtml(msg);

  const { data: inserted, error: upsertError } = await supabase
    .from("email_messages")
    .upsert(
      {
        thread_id: threadId,
        provider_message_id: msg.id,
        direction: "inbound" as const,
        from_email: fromEmail,
        to_email: toEmail,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        received_at: receivedAt,
      },
      { onConflict: "provider_message_id", ignoreDuplicates: true }
    )
    .select("id");

  // Log and surface upsert errors instead of silently skipping
  if (upsertError) {
    logger.error("Failed to upsert email message", {
      providerMessageId: msg.id,
      accountId: account.id,
      error: upsertError.message,
      code: upsertError.code,
    });
    return { draftGenerated: false, skippedNonLead: false };
  }

  // If no row was returned, another sync already inserted this message — skip
  if (!inserted || inserted.length === 0) {
    logger.info("Skipping duplicate message (already processed by another sync)", {
      providerMessageId: msg.id,
      accountId: account.id,
    });
    return { draftGenerated: false, skippedNonLead: false };
  }

  // Update thread last_message_at
  await supabase
    .from("email_threads")
    .update({ last_message_at: receivedAt })
    .eq("id", threadId);

  // Always delegate to Zapier for a fresh Salesforce lookup.
  // The callback at /api/webhooks/salesforce-contacts will:
  //   1. Upsert the contact with current owner info
  //   2. Update thread owner fields
  //   3. Generate the AI draft with authoritative data
  // This single path ensures drafts always use fresh Salesforce data.
  await requestSalesforceCheck(fromEmail, threadId, account.id);

  logger.info("Salesforce check requested — draft will be generated on callback", {
    senderEmail: fromEmail,
    threadId,
    accountId: account.id,
    contactKnown: !!contact,
  });

  return { draftGenerated: false, skippedNonLead: !contact };
}

/**
 * Upsert a thread record keyed by provider_thread_id.
 * Links to Salesforce lead if matched.
 */
async function upsertThread(
  account: EmailAccount,
  gmailThreadId: string,
  subject: string,
  senderEmail: string,
  rawFromHeader: string,
  salesforceLeadId: string | null,
  contact: MatchedContact | null
): Promise<string> {
  // Check for existing thread
  const { data: existing } = await supabase
    .from("email_threads")
    .select("id, salesforce_lead_id, sender_name")
    .eq("email_account_id", account.id)
    .eq("provider_thread_id", gmailThreadId)
    .limit(1);

  if (existing && existing.length > 0) {
    // If thread exists but didn't have a lead link, update it
    const updates: Record<string, unknown> = {};
    if (!existing[0].salesforce_lead_id && salesforceLeadId) {
      updates.salesforce_lead_id = salesforceLeadId;
    }
    // Backfill sender_name if it was missing and we now have it
    if (!existing[0].sender_name) {
      const parsed = rawFromHeader.includes("<")
        ? rawFromHeader.split("<")[0].trim().replace(/"/g, "") || null
        : null;
      if (parsed) {
        updates.sender_name = parsed;
      }
    }
    // Always update owner info if we have contact data
    if (contact) {
      updates.salesforce_owner_id = contact.salesforce_owner_id ?? null;
      updates.salesforce_owner_name = contact.salesforce_owner_name ?? null;
      updates.is_master_agent_owned = contact.is_master_agent_owned ?? null;
    }
    if (Object.keys(updates).length > 0) {
      await supabase
        .from("email_threads")
        .update(updates)
        .eq("id", existing[0].id);
    }
    return existing[0].id;
  }

  // Parse sender name from the raw From header (e.g. "Lisa S" <lisa@gmail.com>)
  const senderName = rawFromHeader.includes("<")
    ? rawFromHeader.split("<")[0].trim().replace(/"/g, "") || null
    : null;

  const { data, error } = await supabase
    .from("email_threads")
    .insert({
      email_account_id: account.id,
      provider_thread_id: gmailThreadId,
      subject,
      sender_email: parseEmailAddress(senderEmail),
      sender_name: senderName,
      salesforce_lead_id: salesforceLeadId,
      salesforce_owner_id: contact?.salesforce_owner_id ?? null,
      salesforce_owner_name: contact?.salesforce_owner_name ?? null,
      is_master_agent_owned: contact?.is_master_agent_owned ?? null,
      location_id: account.location_id,
      last_message_at: new Date().toISOString(),
      is_active: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create thread: ${error.message}`);
  return data.id;
}

export interface DraftHandoffAgent {
  agentId: string;
  agentName: string;
  agentEmail: string;
}

/**
 * Generate an AI draft and store it in the database.
 * Includes Salesforce contact info in the prompt for personalized responses.
 *
 * If `handoffAgent` is provided, the draft is generated as a handoff email:
 * the agent is CC'd, the prompt instructs the model to introduce them, and
 * `agent_handoff_id` is stored on the draft so the Salesforce owner-change
 * routine auto-fires when the email is actually sent.
 */
export async function generateAndStoreDraft(
  account: EmailAccount,
  threadId: string,
  subject: string,
  _inReplyToMessageId: string | null,
  contact: MatchedContact,
  handoffAgent?: DraftHandoffAgent | null
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

    // Build contact info for the prompt
    const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || undefined;

    const draft = await generateDraft({
      locationName,
      locationId: account.location_id,
      emailAddress: account.email_address,
      conversationThread,
      leadInfo: {
        name: contactName,
        budget: contact.budget ?? undefined,
        timeline: contact.timeline ?? undefined,
        interests: contact.property_interest ?? undefined,
      },
      agentHandoff: handoffAgent
        ? {
            agentName: handoffAgent.agentName,
            agentEmail: handoffAgent.agentEmail,
          }
        : undefined,
    });

    // Store draft in DB.
    // A partial unique index (thread_id WHERE status IN ('drafted','approved'))
    // prevents duplicate active drafts from concurrent Zapier callbacks.
    const { data: insertedDraft, error: draftInsertError } = await supabase.from("email_drafts").insert({
      thread_id: threadId,
      email_account_id: account.id,
      status: "drafted",
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      body_text: draft.bodyText,
      model_used: draft.modelUsed,
      prompt_tokens: draft.promptTokens,
      completion_tokens: draft.completionTokens,
      is_simulation: false,
      cc_emails: handoffAgent ? [handoffAgent.agentEmail] : [],
      agent_handoff_id: handoffAgent?.agentId ?? null,
      edited_at: null,
      sent_at: null,
      sent_body_text: null,
      was_changed: false,
    }).select("id").single();

    // If another callback already created an active draft for this thread,
    // the unique index will reject this insert — that's expected, not an error.
    if (draftInsertError) {
      if (draftInsertError.code === "23505") {
        logger.info("Draft already exists for thread (concurrent callback won the race)", {
          threadId,
          accountId: account.id,
        });
        return false;
      }
      throw new Error(`Failed to insert draft: ${draftInsertError.message}`);
    }

    logger.info("AI draft generated for Salesforce contact", {
      threadId,
      accountId: account.id,
      salesforceId: contact.salesforce_id,
      contactName,
    });

    // Auto-approve if the global setting is enabled
    if (insertedDraft?.id) {
      await maybeAutoApproveDraft(insertedDraft.id, locationName, contactName);
    }

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
 * If the global auto_approve_drafts setting is enabled, immediately approve
 * the draft and send SMS to eligible agents with a warning message.
 */
async function maybeAutoApproveDraft(
  draftId: string,
  locationName: string,
  leadName?: string
): Promise<void> {
  try {
    // Check the global setting
    const { data: settings } = await supabase
      .from("system_settings")
      .select("auto_approve_drafts")
      .eq("id", 1)
      .single();

    if (!settings?.auto_approve_drafts) return;

    // Auto-approve the draft
    await supabase
      .from("email_drafts")
      .update({
        status: "approved" as string,
        approved_at: new Date().toISOString(),
      })
      .eq("id", draftId);

    logger.info("Draft auto-approved", { draftId });

    // Send SMS to eligible frontlines agents with the warning message
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, draft_success_phone, send_draft_success_texts")
      .eq("is_active", true)
      .eq("is_frontlines", true)
      .eq("send_draft_success_texts", true);

    const eligible = (agents ?? []).filter(
      (a: { draft_success_phone: string | null }) => a.draft_success_phone?.trim()
    );

    const prefix = locationName && locationName !== "General" ? `${locationName} ` : "";
    const leadSuffix = leadName ? ` (${leadName})` : "";
    const smsBody =
      `${prefix}Draft Ready${leadSuffix}\n\nJeff is likely sleeping - please review the draft carefully before sending`;

    for (const agent of eligible) {
      try {
        await getTwilioClient().messages.create({
          to: agent.draft_success_phone!,
          from: getTwilioPhoneNumber(),
          body: smsBody,
        });
        logger.info("Auto-approve SMS sent", {
          draftId,
          agentName: agent.name,
        });
      } catch (smsErr) {
        logger.error("Auto-approve SMS failed", {
          draftId,
          agentName: agent.name,
          error: smsErr instanceof Error ? smsErr.message : String(smsErr),
        });
      }
    }
  } catch (err) {
    // Non-blocking: draft was still created, just not auto-approved
    logger.error("Auto-approve check failed", {
      draftId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fire an outbound webhook to Zapier requesting a Salesforce lookup for an
 * email sender. Zapier will check SF and POST back to
 * /api/webhooks/salesforce-contacts with the current contact data.
 *
 * Called for EVERY inbound email (not just unknown senders) so that
 * ownership changes in Salesforce are picked up promptly.
 *
 * This is fire-and-forget — failures are logged but don't block sync.
 */
async function requestSalesforceCheck(
  senderEmail: string,
  threadId: string,
  accountId: string
): Promise<void> {
  const zapierUrl = process.env.ZAPIER_SF_CHECK_HOOK;
  if (!zapierUrl) return; // Not configured, skip silently

  try {
    await fetch(zapierUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender_email: senderEmail,
        thread_id: threadId,
        account_id: accountId,
        requested_at: new Date().toISOString(),
      }),
    });
    logger.info("Salesforce check requested via Zapier", {
      senderEmail,
      threadId,
    });
  } catch (err) {
    // Non-blocking: draft will be backfilled if Zapier responds later
    logger.warn("Failed to request Salesforce check", {
      senderEmail,
      error: err instanceof Error ? err.message : String(err),
    });
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
  totalSkippedNonLead: number;
}> {
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("provider", "gmail")
    .eq("is_active", true)
    .not("credentials", "is", null);

  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  if (!accounts || accounts.length === 0) {
    return { accounts: 0, totalNewMessages: 0, totalDraftsGenerated: 0, totalSkippedNonLead: 0 };
  }

  let totalNewMessages = 0;
  let totalDraftsGenerated = 0;
  let totalSkippedNonLead = 0;

  for (const account of accounts) {
    try {
      const result = await syncInbox(account as EmailAccount);
      totalNewMessages += result.newMessages;
      totalDraftsGenerated += result.draftsGenerated;
      totalSkippedNonLead += result.skippedNonLead;
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
    totalSkippedNonLead,
  };
}
