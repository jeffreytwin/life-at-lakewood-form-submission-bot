/**
 * Gmail Pub/Sub watch management.
 * Registers and renews push notification watches for email accounts.
 */

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { watchInbox } from "./client";
import type { EmailAccount, GmailCredentials } from "@/lib/supabase/types";

const PUBSUB_TOPIC = process.env.GMAIL_PUBSUB_TOPIC;

// Renew watches that expire within 24 hours
const RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000;

/**
 * Register a Pub/Sub watch for a single account.
 * Stores the watch expiration in the database.
 */
export async function registerWatch(account: EmailAccount): Promise<boolean> {
  if (!PUBSUB_TOPIC) {
    logger.warn("GMAIL_PUBSUB_TOPIC not configured, skipping watch registration");
    return false;
  }

  const creds = account.credentials as GmailCredentials | null;
  if (!creds) return false;

  try {
    const result = await watchInbox(account.id, creds, PUBSUB_TOPIC);

    // Google returns expiration as a Unix timestamp in milliseconds (string)
    const expirationDate = new Date(Number(result.expiration)).toISOString();

    await supabase
      .from("email_accounts")
      .update({ watch_expiration: expirationDate })
      .eq("id", account.id);

    logger.info("Gmail watch registered", {
      accountId: account.id,
      email: account.email_address,
      expiration: expirationDate,
    });

    return true;
  } catch (err) {
    logger.error("Failed to register Gmail watch", {
      accountId: account.id,
      email: account.email_address,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Renew watches for all active Gmail accounts that are expired or expiring soon.
 * Called from the sync cron job.
 */
export async function renewAllWatches(): Promise<{ renewed: number; failed: number }> {
  if (!PUBSUB_TOPIC) return { renewed: 0, failed: 0 };

  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("provider", "gmail")
    .eq("is_active", true)
    .not("credentials", "is", null);

  if (error || !accounts) return { renewed: 0, failed: 0 };

  let renewed = 0;
  let failed = 0;
  const now = Date.now();

  for (const account of accounts) {
    const watchExp = account.watch_expiration
      ? new Date(account.watch_expiration).getTime()
      : 0;

    // Renew if expired or expiring within buffer
    if (watchExp < now + RENEWAL_BUFFER_MS) {
      const ok = await registerWatch(account as EmailAccount);
      if (ok) renewed++;
      else failed++;
    }
  }

  if (renewed > 0 || failed > 0) {
    logger.info("Gmail watch renewal complete", { renewed, failed });
  }

  return { renewed, failed };
}
