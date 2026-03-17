import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

/**
 * POST /api/webhooks/salesforce-contacts
 *
 * Receives Salesforce lead/contact data from Zapier and upserts into the
 * salesforce_contacts table. Used by the Email Hub to identify known leads
 * so we only generate AI drafts for real leads, not random emails.
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
      } else {
        upserted++;
      }
    }

    logger.info("Salesforce contacts synced", { upserted, skipped, total: contacts.length });

    return NextResponse.json({ upserted, skipped });
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
