/**
 * Gmail Push Notifications: watch/stop mailbox changes via Pub/Sub.
 *
 * Calls Gmail users.watch to register push notifications.
 * Watch must be renewed before expiration (max 7 days).
 */

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import type { EmailAccount, GmailCredentials } from "@/lib/supabase/types";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function getOAuthConfig() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret };
}

async function getValidToken(
  accountId: string,
  credentials: GmailCredentials
): Promise<string> {
  if (credentials.expiry_date < Date.now() + 5 * 60 * 1000) {
    const { clientId, clientSecret } = getOAuthConfig();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = await res.json();
    const updated: GmailCredentials = {
      ...credentials,
      access_token: data.access_token,
      expiry_date: Date.now() + data.expires_in * 1000,
      token_type: data.token_type ?? credentials.token_type,
    };
    await supabase
      .from("email_accounts")
      .update({ credentials: updated as unknown as Record<string, unknown> })
      .eq("id", accountId);
    return updated.access_token;
  }
  return credentials.access_token;
}

/**
 * Register Gmail push notifications for an account.
 * Returns the watch expiration timestamp.
 */
export async function watchMailbox(account: EmailAccount): Promise<Date> {
  const creds = account.credentials as GmailCredentials | null;
  if (!creds) throw new Error("No credentials for account");

  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) throw new Error("GMAIL_PUBSUB_TOPIC env var is required");

  const token = await getValidToken(account.id, creds);

  const res = await fetch(`${GMAIL_API}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName,
      labelIds: ["INBOX"],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail watch failed: ${res.status} ${text}`);
  }

  const data: { historyId: string; expiration: string } = await res.json();
  const expiration = new Date(parseInt(data.expiration));

  // Store watch expiration and update history ID
  await supabase
    .from("email_accounts")
    .update({
      watch_expiration: expiration.toISOString(),
      sync_history_id: data.historyId,
    })
    .eq("id", account.id);

  logger.info("Gmail watch registered", {
    accountId: account.id,
    email: account.email_address,
    expiration: expiration.toISOString(),
  });

  return expiration;
}

/**
 * Stop Gmail push notifications for an account.
 */
export async function stopWatch(account: EmailAccount): Promise<void> {
  const creds = account.credentials as GmailCredentials | null;
  if (!creds) return;

  const token = await getValidToken(account.id, creds);

  const res = await fetch(`${GMAIL_API}/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn("Gmail stop watch failed", { status: res.status, body: text });
  }

  await supabase
    .from("email_accounts")
    .update({ watch_expiration: null })
    .eq("id", account.id);
}

/**
 * Renew watch for all active Gmail accounts whose watch is expiring soon (within 1 day).
 */
export async function renewExpiringWatches(): Promise<{ renewed: number; failed: number }> {
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("provider", "gmail")
    .eq("is_active", true)
    .not("credentials", "is", null)
    .or(`watch_expiration.is.null,watch_expiration.lt.${oneDayFromNow}`);

  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  if (!accounts || accounts.length === 0) return { renewed: 0, failed: 0 };

  let renewed = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      await watchMailbox(account as EmailAccount);
      renewed++;
    } catch (err) {
      failed++;
      logger.error("Watch renewal failed", {
        accountId: account.id,
        email: account.email_address,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Watch renewal complete", { renewed, failed });
  return { renewed, failed };
}
