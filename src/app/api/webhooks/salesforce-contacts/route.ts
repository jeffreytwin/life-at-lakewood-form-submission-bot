import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { generateAndStoreDraft, pendingSfChecks, type MatchedContact } from "@/lib/gmail/sync-inbox";
import type { EmailAccount } from "@/lib/supabase/types";

/**
 * POST /api/webhooks/salesforce-contacts
 *
 * Receives Salesforce lead/contact data from Zapier and upserts into the
 * salesforce_contacts table. Used by the Email Hub to identify known leads
 * so we only generate AI drafts for real leads, not random emails.
 *
 * After upserting, checks for existing email threads from this contact that
 * don't have drafts yet and generates them retroactively. This handles the
 * case where the cron sync already stored the inbound email but skipped
 * draft generation because the contact wasn't confirmed yet.
 *
 * Supports two formats:
 * 1. Single contact: { webhook_secret, salesforce_id, email, ... }
 * 2. Batch: { webhook_secret, contacts: [{ salesforce_id, email, ... }, ...] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Authenticate
    const secret = String(body?.webhook_secret || "").trim();
    const envSecret = String(process.env.ZAPIER_SF_CONTACTS_WEBHOOK_SECRET || "").trim();
    if (!secret || !envSecret || secret !== envSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Normalize to array of contacts
    let contacts: Array<Record<string, unknown>>;
    if (Array.isArray(body.contacts)) {
      contacts = body.contacts;
    } else if (body.salesforce_id && body.email) {
      // Single contact format
      contacts = [body];
    } else {
      return NextResponse.json(
        { error: "Invalid payload: must include salesforce_id and email, or a contacts array" },
        { status: 400 }
      );
    }

    let upserted = 0;
    let skipped = 0;
    let draftsGenerated = 0;

    for (const contact of contacts) {
      const salesforceId = String(contact.salesforce_id || "").trim();
      const email = String(contact.email || "").trim().toLowerCase();

      if (!salesforceId || !email) {
        logger.warn("Skipping contact: missing salesforce_id or email", { contact });
        skipped++;
        continue;
      }

      const row = {
        salesforce_id: salesforceId,
        email,
        first_name: contact.first_name ? String(contact.first_name) : null,
        last_name: contact.last_name ? String(contact.last_name) : null,
        phone: contact.phone ? String(contact.phone) : null,
        company: contact.company ? String(contact.company) : null,
        lead_status: contact.lead_status ? String(contact.lead_status) : null,
        lead_source: contact.lead_source ? String(contact.lead_source) : null,
        property_interest: contact.property_interest ? String(contact.property_interest) : null,
        budget: contact.budget ? String(contact.budget) : null,
        timeline: contact.timeline ? String(contact.timeline) : null,
        location_name: contact.location_name ? String(contact.location_name) : null,
        is_active: contact.is_active !== false,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("salesforce_contacts")
        .upsert(row, { onConflict: "salesforce_id" });

      if (error) {
        logger.warn("Failed to upsert Salesforce contact", {
          salesforceId,
          email,
          error: error.message,
        });
        skipped++;
        continue;
      }

      upserted++;

      // Clear from pending SF check set so future emails get re-checked if needed
      pendingSfChecks.delete(email);

      // Backfill: find threads from this email that don't have drafts yet
      const generated = await backfillDraftsForContact(email, {
        id: "",
        salesforce_id: salesforceId,
        email,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        budget: row.budget,
        timeline: row.timeline,
        property_interest: row.property_interest,
        lead_status: row.lead_status,
        location_name: row.location_name,
      });
      draftsGenerated += generated;
    }

    logger.info("Salesforce contacts synced", {
      upserted,
      skipped,
      draftsGenerated,
      total: contacts.length,
    });

    return NextResponse.json({ upserted, skipped, draftsGenerated });
  } catch (error) {
    logger.error("Salesforce contacts webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Find threads from a given email that don't have any drafts yet,
 * and generate AI drafts for them. This handles the race condition
 * where the cron sync stored the inbound email but the Salesforce
 * contact confirmation hadn't arrived yet.
 */
async function backfillDraftsForContact(
  email: string,
  contact: MatchedContact
): Promise<number> {
  // Find threads where sender matches this email
  const { data: threads } = await supabase
    .from("email_threads")
    .select("id, subject, email_account_id, salesforce_lead_id")
    .ilike("sender_email", email)
    .eq("is_active", true);

  if (!threads || threads.length === 0) return 0;

  let generated = 0;

  for (const thread of threads) {
    // Link Salesforce ID to thread if not already linked
    if (!thread.salesforce_lead_id) {
      await supabase
        .from("email_threads")
        .update({ salesforce_lead_id: contact.salesforce_id })
        .eq("id", thread.id);
    }

    // Check if this thread already has a draft
    const { data: existingDrafts } = await supabase
      .from("email_drafts")
      .select("id")
      .eq("thread_id", thread.id)
      .in("status", ["drafted", "approved", "sent"])
      .limit(1);

    if (existingDrafts && existingDrafts.length > 0) continue;

    // Load the email account
    if (!thread.email_account_id) continue;
    const { data: account } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", thread.email_account_id)
      .single();

    if (!account) continue;

    try {
      const success = await generateAndStoreDraft(
        account as EmailAccount,
        thread.id,
        thread.subject ?? "(no subject)",
        null,
        contact
      );
      if (success) {
        generated++;
        logger.info("Backfill draft generated for confirmed contact", {
          threadId: thread.id,
          email,
          salesforceId: contact.salesforce_id,
        });
      }
    } catch (err) {
      logger.error("Backfill draft generation failed", {
        threadId: thread.id,
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return generated;
}
