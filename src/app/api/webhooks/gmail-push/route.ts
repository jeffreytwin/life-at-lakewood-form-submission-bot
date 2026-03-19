import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { syncInbox } from "@/lib/gmail/sync-inbox";
import { syncSentFolder } from "@/lib/gmail/sync-sent";
import { pushAllPendingDrafts, reconcileDeletedDrafts } from "@/lib/gmail/push-draft";
import { logger } from "@/lib/shared/logger";
import type { EmailAccount } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/gmail-push
 *
 * Receives Google Cloud Pub/Sub push notifications when a Gmail mailbox changes.
 * The Pub/Sub message contains a base64-encoded JSON payload with:
 *   { emailAddress: string, historyId: number }
 *
 * On receipt, we immediately sync the inbox and sent folder for the matching
 * email account, then push any pending drafts.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Pub/Sub wraps the payload in: { message: { data: "<base64>", ... }, subscription: "..." }
    const messageData = body?.message?.data;
    if (!messageData) {
      logger.warn("Gmail push: no message.data in payload");
      // Return 200 to acknowledge so Pub/Sub doesn't retry
      return NextResponse.json({ ok: true });
    }

    // Decode the base64 payload
    const decoded = Buffer.from(messageData, "base64").toString("utf-8");
    let notification: { emailAddress?: string; historyId?: number };
    try {
      notification = JSON.parse(decoded);
    } catch {
      logger.warn("Gmail push: failed to parse decoded payload", { decoded });
      return NextResponse.json({ ok: true });
    }

    const { emailAddress, historyId } = notification;
    if (!emailAddress) {
      logger.warn("Gmail push: missing emailAddress in notification");
      return NextResponse.json({ ok: true });
    }

    logger.info("Gmail push notification received", { emailAddress, historyId });

    // Find the matching email account
    const { data: account, error: accountError } = await supabase
      .from("email_accounts")
      .select("*")
      .ilike("email_address", emailAddress)
      .eq("provider", "gmail")
      .eq("is_active", true)
      .not("credentials", "is", null)
      .limit(1)
      .single();

    if (accountError || !account) {
      logger.warn("Gmail push: no matching active account found", { emailAddress });
      return NextResponse.json({ ok: true });
    }

    const typedAccount = account as EmailAccount;

    // Sync inbox (will use History API for incremental sync)
    const inboxResult = await syncInbox(typedAccount);

    // Push any new AI drafts to Gmail
    await pushAllPendingDrafts();

    // Sync sent folder (detects if drafts were sent)
    const sentResult = await syncSentFolder(typedAccount);

    // Reconcile deleted Gmail drafts (mark as discarded)
    await reconcileDeletedDrafts();

    logger.info("Gmail push sync complete", {
      emailAddress,
      newMessages: inboxResult.newMessages,
      draftsGenerated: inboxResult.draftsGenerated,
      sentMatched: sentResult.sentMatched,
    });

    // Must return 200 to acknowledge the Pub/Sub message
    return NextResponse.json({
      ok: true,
      inbox: inboxResult,
      sent: sentResult,
    });
  } catch (error) {
    logger.error("Gmail push webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Still return 200 to prevent infinite Pub/Sub retries on permanent errors
    return NextResponse.json({ ok: true, error: "internal" });
  }
}
