import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { syncInbox } from "@/lib/gmail/sync-inbox";
import { logger } from "@/lib/shared/logger";
import type { EmailAccount } from "@/lib/supabase/types";

/**
 * Gmail Push Notification Webhook
 *
 * Receives Pub/Sub push messages from Google Cloud when a Gmail mailbox changes.
 * The Pub/Sub subscription pushes a JSON envelope containing a base64-encoded
 * notification with the emailAddress and historyId.
 *
 * Flow:
 * 1. Gmail detects mailbox change → publishes to Pub/Sub topic
 * 2. Pub/Sub pushes to this endpoint
 * 3. We decode the notification, find the matching email account, and sync it
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Pub/Sub push messages have this shape:
    // { message: { data: "<base64>", messageId: "...", publishTime: "..." }, subscription: "..." }
    const pubsubMessage = body?.message;
    if (!pubsubMessage?.data) {
      logger.warn("Gmail push webhook: missing message data");
      // Return 200 to avoid Pub/Sub retries for malformed messages
      return NextResponse.json({ status: "ignored", reason: "no data" });
    }

    // Decode the base64 notification
    const decoded = Buffer.from(pubsubMessage.data, "base64").toString("utf-8");
    let notification: { emailAddress?: string; historyId?: number };
    try {
      notification = JSON.parse(decoded);
    } catch {
      logger.warn("Gmail push webhook: invalid JSON in message data", { decoded });
      return NextResponse.json({ status: "ignored", reason: "invalid json" });
    }

    const { emailAddress, historyId } = notification;
    if (!emailAddress) {
      logger.warn("Gmail push webhook: no emailAddress in notification");
      return NextResponse.json({ status: "ignored", reason: "no email" });
    }

    logger.info("Gmail push notification received", { emailAddress, historyId });

    // Find the matching email account
    const { data: account, error } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("email_address", emailAddress.toLowerCase())
      .eq("provider", "gmail")
      .eq("is_active", true)
      .single();

    if (error || !account) {
      logger.warn("Gmail push webhook: no matching account", { emailAddress });
      // Return 200 so Pub/Sub doesn't retry
      return NextResponse.json({ status: "ignored", reason: "unknown account" });
    }

    // Sync the inbox for this account
    const result = await syncInbox(account as EmailAccount);

    logger.info("Gmail push sync complete", {
      emailAddress,
      newMessages: result.newMessages,
      draftsGenerated: result.draftsGenerated,
    });

    return NextResponse.json({
      status: "ok",
      newMessages: result.newMessages,
      draftsGenerated: result.draftsGenerated,
    });
  } catch (error) {
    logger.error("Gmail push webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Return 200 to prevent infinite Pub/Sub retries on app errors
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 200 }
    );
  }
}
