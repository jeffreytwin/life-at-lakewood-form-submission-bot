import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { generateAndStoreDraft, type MatchedContact } from "@/lib/gmail/sync-inbox";
import type { EmailAccount } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Check whether any email in the given list belongs to an active agent.
 */
async function hasAgentRecipient(emails: string[]): Promise<boolean> {
  if (emails.length === 0) return false;

  const { data: agents } = await supabase
    .from("agents")
    .select("email")
    .eq("is_active", true)
    .not("email", "is", null);

  if (!agents || agents.length === 0) return false;

  const agentEmails = new Set(
    agents.map((a: { email: string | null }) => (a.email as string).toLowerCase())
  );

  return emails.some((e) => agentEmails.has(e));
}

/**
 * POST /api/internal/email-hub/rescan
 *
 * Re-scans today's inbound emails across all active inboxes for threads
 * that should have drafts but don't (e.g. due to missed Zapier callbacks).
 * Matches senders against the local salesforce_contacts table and generates
 * drafts directly. Follows the same filtering rules as the normal flow:
 * skips threads where an agent is already a recipient or the sender is an agent.
 */
export async function POST() {
  try {
    // Load all active email accounts
    const { data: accounts, error: acctErr } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("is_active", true);

    if (acctErr) throw acctErr;
    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ draftsGenerated: 0, threadsScanned: 0, message: "No active accounts" });
    }

    // Only scan threads with activity today (Eastern time)
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    nowET.setHours(0, 0, 0, 0);
    const todayStr = `${nowET.getFullYear()}-${String(nowET.getMonth() + 1).padStart(2, "0")}-${String(nowET.getDate()).padStart(2, "0")}T00:00:00`;
    const naive = new Date(todayStr);
    const sample = new Date(naive.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const offsetMs = sample.getTime() - naive.getTime();
    const todayCutoff = new Date(naive.getTime() - offsetMs).toISOString();

    let totalDraftsGenerated = 0;
    let totalThreadsScanned = 0;

    for (const account of accounts) {
      const ownEmail = account.email_address.toLowerCase();

      // Find active threads for this account with activity today
      const { data: threads } = await supabase
        .from("email_threads")
        .select("id, subject, sender_email, salesforce_lead_id")
        .eq("email_account_id", account.id)
        .eq("is_active", true)
        .gte("last_message_at", todayCutoff);

      if (!threads || threads.length === 0) continue;

      for (const thread of threads) {
        totalThreadsScanned++;
        if (!thread.sender_email) continue;

        // Skip if sender is an agent
        if (await hasAgentRecipient([thread.sender_email.toLowerCase()])) continue;

        // Check if there's already a drafted/approved/discarded draft for this thread
        const { data: existingDrafts } = await supabase
          .from("email_drafts")
          .select("id")
          .eq("thread_id", thread.id)
          .in("status", ["drafted", "approved", "discarded"])
          .limit(1);

        if (existingDrafts && existingDrafts.length > 0) continue;

        // If there's an existing "drafted" or "approved" draft, it was already
        // caught above. Now check sent drafts — only proceed if there's a new
        // inbound message after the last sent draft.
        const { data: lastSentDraft } = await supabase
          .from("email_drafts")
          .select("sent_at")
          .eq("thread_id", thread.id)
          .eq("status", "sent")
          .order("sent_at", { ascending: false })
          .limit(1);

        if (lastSentDraft && lastSentDraft.length > 0 && lastSentDraft[0].sent_at) {
          const { data: newInbound } = await supabase
            .from("email_messages")
            .select("id")
            .eq("thread_id", thread.id)
            .eq("direction", "inbound")
            .gt("received_at", lastSentDraft[0].sent_at)
            .limit(1);

          if (!newInbound || newInbound.length === 0) continue;
        } else {
          // No sent drafts — make sure there's at least one inbound message
          const { data: anyInbound } = await supabase
            .from("email_messages")
            .select("id")
            .eq("thread_id", thread.id)
            .eq("direction", "inbound")
            .limit(1);

          if (!anyInbound || anyInbound.length === 0) continue;
        }

        // Skip if an agent is already a recipient on any message in this thread
        // (but exclude the monitored account's own email — every inbound is TO it)
        const { data: threadMessages } = await supabase
          .from("email_messages")
          .select("to_email")
          .eq("thread_id", thread.id);

        const recipientEmails = (threadMessages ?? [])
          .map((m: { to_email: string | null }) => (m.to_email ?? "").toLowerCase())
          .flatMap((e: string) => e.split(",").map((s: string) => s.trim()))
          .filter((e: string) => e && e !== ownEmail);

        if (await hasAgentRecipient(recipientEmails)) continue;

        // Match sender to a known Salesforce contact in local DB
        const { data: contacts } = await supabase
          .from("salesforce_contacts")
          .select("id, salesforce_id, email, first_name, last_name, phone, budget, timeline, property_interest, lead_status, location_name, salesforce_owner_id, salesforce_owner_name, is_master_agent_owned")
          .ilike("email", thread.sender_email)
          .eq("is_active", true)
          .order("synced_at", { ascending: false })
          .limit(1);

        if (!contacts || contacts.length === 0) continue;

        const contact = contacts[0] as MatchedContact;

        // Update thread with Salesforce info if not already linked
        if (!thread.salesforce_lead_id) {
          await supabase
            .from("email_threads")
            .update({
              salesforce_lead_id: contact.salesforce_id,
              salesforce_owner_id: contact.salesforce_owner_id ?? null,
              salesforce_owner_name: contact.salesforce_owner_name ?? null,
              is_master_agent_owned: contact.is_master_agent_owned ?? null,
            })
            .eq("id", thread.id);
        }

        try {
          const success = await generateAndStoreDraft(
            account as EmailAccount,
            thread.id,
            thread.subject ?? "(no subject)",
            null,
            contact
          );
          if (success) {
            totalDraftsGenerated++;
            logger.info("Rescan generated draft for missed thread", {
              threadId: thread.id,
              senderEmail: thread.sender_email,
              accountId: account.id,
            });
          }
        } catch (err) {
          logger.error("Rescan draft generation failed", {
            threadId: thread.id,
            senderEmail: thread.sender_email,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    logger.info("Manual inbox rescan complete", {
      threadsScanned: totalThreadsScanned,
      draftsGenerated: totalDraftsGenerated,
    });

    return NextResponse.json({
      threadsScanned: totalThreadsScanned,
      draftsGenerated: totalDraftsGenerated,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Manual inbox rescan failed", { error: errMsg });
    return NextResponse.json(
      { error: "Rescan failed", detail: errMsg },
      { status: 500 }
    );
  }
}
