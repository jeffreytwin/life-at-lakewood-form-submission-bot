/**
 * Gmail API client using raw fetch (no googleapis dependency).
 * Handles OAuth token refresh and core Gmail operations.
 */

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import type { GmailCredentials } from "@/lib/supabase/types";

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

/**
 * Refresh an expired access token using the refresh token.
 */
async function refreshAccessToken(
  accountId: string,
  credentials: GmailCredentials
): Promise<GmailCredentials> {
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

  if (!res.ok) {
    const text = await res.text();
    logger.error("Token refresh failed", { accountId, status: res.status, body: text });
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  const updated: GmailCredentials = {
    ...credentials,
    access_token: data.access_token,
    expiry_date: Date.now() + data.expires_in * 1000,
    token_type: data.token_type ?? credentials.token_type,
  };

  // Persist refreshed token
  await supabase
    .from("email_accounts")
    .update({ credentials: updated as unknown as Record<string, unknown> })
    .eq("id", accountId);

  return updated;
}

/**
 * Get a valid access token, refreshing if necessary.
 */
async function getValidToken(
  accountId: string,
  credentials: GmailCredentials
): Promise<string> {
  // Refresh if token expires within 5 minutes
  if (credentials.expiry_date < Date.now() + 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(accountId, credentials);
    return refreshed.access_token;
  }
  return credentials.access_token;
}

/**
 * Make an authenticated Gmail API request.
 */
async function gmailFetch(
  accountId: string,
  credentials: GmailCredentials,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getValidToken(accountId, credentials);
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

// ============================================================
// Gmail API Operations
// ============================================================

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: GmailMessagePart[];
  };
  internalDate?: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

/**
 * List messages matching a query.
 */
export async function listMessages(
  accountId: string,
  credentials: GmailCredentials,
  query: string,
  maxResults = 20
): Promise<Array<{ id: string; threadId: string }>> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const res = await gmailFetch(accountId, credentials, `/messages?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`listMessages failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.messages ?? [];
}

/**
 * Get a single message with full payload.
 */
export async function getMessage(
  accountId: string,
  credentials: GmailCredentials,
  messageId: string
): Promise<GmailMessage> {
  const res = await gmailFetch(accountId, credentials, `/messages/${messageId}?format=full`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getMessage failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Get a full thread with all messages.
 */
export async function getThread(
  accountId: string,
  credentials: GmailCredentials,
  threadId: string
): Promise<GmailThread> {
  const res = await gmailFetch(accountId, credentials, `/threads/${threadId}?format=full`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getThread failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Create a draft in Gmail.
 */
export async function createDraft(
  accountId: string,
  credentials: GmailCredentials,
  raw: string, // base64url-encoded RFC 2822 message
  threadId?: string
): Promise<{ id: string; message: { id: string; threadId: string } }> {
  const message: Record<string, string> = { raw };
  if (threadId) message.threadId = threadId;
  const res = await gmailFetch(accountId, credentials, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createDraft failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Update an existing draft in Gmail.
 */
export async function updateDraft(
  accountId: string,
  credentials: GmailCredentials,
  draftId: string,
  raw: string,
  threadId?: string
): Promise<{ id: string; message: { id: string; threadId: string } }> {
  const message: Record<string, string> = { raw };
  if (threadId) message.threadId = threadId;
  const res = await gmailFetch(accountId, credentials, `/drafts/${draftId}`, {
    method: "PUT",
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`updateDraft failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Check if a draft still exists in Gmail.
 * Returns true if it exists, false if deleted (404).
 */
export async function draftExists(
  accountId: string,
  credentials: GmailCredentials,
  draftId: string
): Promise<boolean> {
  const res = await gmailFetch(accountId, credentials, `/drafts/${draftId}?format=minimal`);
  if (res.ok) return true;
  if (res.status === 404) return false;
  // Other errors — assume it still exists to avoid false positives
  return true;
}

/**
 * Delete a draft from Gmail permanently.
 */
export async function deleteDraft(
  accountId: string,
  credentials: GmailCredentials,
  draftId: string
): Promise<void> {
  const res = await gmailFetch(accountId, credentials, `/drafts/${draftId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`deleteDraft failed: ${res.status} ${text}`);
  }
}

/**
 * List messages added since a given historyId.
 */
export async function listHistory(
  accountId: string,
  credentials: GmailCredentials,
  startHistoryId: string,
  labelId?: string
): Promise<{
  history: Array<{
    id: string;
    messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  }>;
  historyId: string;
}> {
  const params = new URLSearchParams({ startHistoryId });
  if (labelId) params.set("labelId", labelId);
  const res = await gmailFetch(accountId, credentials, `/history?${params}`);
  if (!res.ok) {
    // 404 means historyId is too old, need full sync
    if (res.status === 404) {
      return { history: [], historyId: startHistoryId };
    }
    const text = await res.text();
    throw new Error(`listHistory failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { history: data.history ?? [], historyId: data.historyId };
}

/**
 * Get the current user's profile (includes latest historyId).
 */
export async function getProfile(
  accountId: string,
  credentials: GmailCredentials
): Promise<{ emailAddress: string; historyId: string }> {
  const res = await gmailFetch(accountId, credentials, "/profile");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getProfile failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ============================================================
// Message Parsing Helpers
// ============================================================

/**
 * Extract a header value from a Gmail message.
 */
export function getHeader(msg: GmailMessage, name: string): string | null {
  const header = msg.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? null;
}

/**
 * Decode base64url-encoded body data.
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Rough HTML-to-text: strip tags, decode common entities, collapse whitespace.
 */
function htmlToPlainText(html: string): string {
  return html
    // Remove style/script blocks entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    // Convert <br> and block-level tags to newlines
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|li|tr)[^>]*>/gi, "")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract plain text body from a message, recursing through MIME parts.
 * Falls back to converting HTML to plain text if no text/plain part exists.
 */
export function extractBodyText(msg: GmailMessage): string {
  function findText(parts?: GmailMessagePart[]): string | null {
    if (!parts) return null;
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        const nested = findText(part.parts);
        if (nested) return nested;
      }
    }
    return null;
  }

  // Single-part message
  if (msg.payload?.mimeType === "text/plain" && msg.payload.body?.data) {
    return decodeBase64Url(msg.payload.body.data);
  }

  // Multipart message — try text/plain first
  const plainText = findText(msg.payload?.parts);
  if (plainText) return plainText;

  // Fallback: extract text from HTML part
  const html = extractBodyHtml(msg);
  if (html) return htmlToPlainText(html);

  return "";
}

/**
 * Extract HTML body from a message, recursing through MIME parts.
 */
export function extractBodyHtml(msg: GmailMessage): string | null {
  function findHtml(parts?: GmailMessagePart[]): string | null {
    if (!parts) return null;
    for (const part of parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        const nested = findHtml(part.parts);
        if (nested) return nested;
      }
    }
    return null;
  }

  if (msg.payload?.mimeType === "text/html" && msg.payload.body?.data) {
    return decodeBase64Url(msg.payload.body.data);
  }

  return findHtml(msg.payload?.parts);
}

/**
 * Fetch the Gmail signature for a sendAs address.
 */
export async function getSignature(
  accountId: string,
  credentials: GmailCredentials,
  emailAddress: string
): Promise<string | null> {
  try {
    const res = await gmailFetch(
      accountId,
      credentials,
      `/settings/sendAs/${encodeURIComponent(emailAddress)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.signature || null;
  } catch {
    return null;
  }
}

/**
 * Build a base64url-encoded RFC 2822 message for Gmail API.
 * When signatureHtml is provided, sends as multipart/alternative (text + HTML).
 */
export function buildRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  cc?: string[];
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  signatureHtml?: string;
}): string {
  // Clean non-breaking spaces and other Unicode whitespace from subject
  const cleanSubject = opts.subject.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");

  // RFC 2047 encode the subject for non-ASCII safety
  const encodedSubject = /[^\x20-\x7E]/.test(cleanSubject)
    ? `=?UTF-8?B?${Buffer.from(cleanSubject).toString("base64")}?=`
    : cleanSubject;

  const headers: string[] = [];
  headers.push(`From: ${opts.from}`);
  headers.push(`To: ${opts.to}`);
  if (opts.cc?.length) headers.push(`Cc: ${opts.cc.join(", ")}`);
  headers.push(`Subject: ${encodedSubject}`);
  headers.push("MIME-Version: 1.0");
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  let body: string;

  if (opts.signatureHtml) {
    // Build multipart/alternative with text and HTML
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    const htmlBody = `<div dir="ltr">${opts.bodyText.replace(/\n/g, "<br>")}</div><br><div class="gmail_signature">${opts.signatureHtml}</div>`;
    const textWithSig = opts.bodyText;

    body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      textWithSig,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      htmlBody,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=utf-8");
    body = opts.bodyText;
  }

  const raw = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ============================================================
// Gmail Push Notifications (Pub/Sub)
// ============================================================

/**
 * Register a Gmail mailbox for push notifications via Google Cloud Pub/Sub.
 * Must be renewed every 7 days (Google enforces max expiration).
 * Returns the new historyId and expiration timestamp.
 */
export async function watchInbox(
  accountId: string,
  credentials: GmailCredentials,
  topicName: string
): Promise<{ historyId: string; expiration: string }> {
  const res = await gmailFetch(accountId, credentials, "/watch", {
    method: "POST",
    body: JSON.stringify({
      topicName,
      labelIds: ["INBOX", "SENT"],
      labelFilterBehavior: "include",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`watch failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    historyId: data.historyId,
    expiration: data.expiration,
  };
}

/**
 * Stop push notifications for a mailbox.
 */
export async function stopWatch(
  accountId: string,
  credentials: GmailCredentials
): Promise<void> {
  const res = await gmailFetch(accountId, credentials, "/stop", {
    method: "POST",
  });
  // 204 = success, ignore errors (watch may not be active)
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const text = await res.text();
    logger.warn("stopWatch returned error", { accountId, status: res.status, body: text });
  }
}

/**
 * Exchange an OAuth authorization code for tokens.
 */
export async function exchangeAuthCode(
  code: string,
  redirectUri: string
): Promise<GmailCredentials> {
  const { clientId, clientSecret } = getOAuthConfig();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth code exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type ?? "Bearer",
    expiry_date: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? "",
  };
}

/**
 * Build the Google OAuth consent URL.
 */
export function buildOAuthUrl(redirectUri: string, emailHint?: string): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) throw new Error("GMAIL_CLIENT_ID is required");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.modify",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
  });

  if (emailHint) params.set("login_hint", emailHint);

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
