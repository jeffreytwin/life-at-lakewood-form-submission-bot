import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, getProfile } from "@/lib/gmail/client";
import { supabase } from "@/lib/supabase/client";
import { registerWatch } from "@/lib/gmail/watch";
import { logger } from "@/lib/shared/logger";
import type { EmailAccount } from "@/lib/supabase/types";

/**
 * OAuth callback handler. Google redirects here with ?code=...&state=account_id
 * Exchanges code for tokens, stores them, and redirects to the dashboard.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state"); // account_id
    const error = searchParams.get("error");

    if (error) {
      logger.warn("OAuth denied by user", { error });
      return NextResponse.redirect(
        new URL("/dashboard/email-hub/settings?oauth=denied", request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/dashboard/email-hub/settings?oauth=error&reason=missing_params", request.url)
      );
    }

    const redirectUri = getRedirectUri(request);
    const credentials = await exchangeAuthCode(code, redirectUri);
    const profile = await getProfile(state, credentials);

    const { error: updateError } = await supabase
      .from("email_accounts")
      .update({
        credentials: credentials as unknown as Record<string, unknown>,
        sync_history_id: profile.historyId,
        sent_sync_history_id: profile.historyId,
        is_active: true,
      })
      .eq("id", state);

    if (updateError) {
      logger.error("Failed to store Gmail credentials", {
        accountId: state,
        error: updateError.message,
        code: updateError.code,
        details: updateError.details,
      });
      const detail = encodeURIComponent(updateError.message || "unknown");
      return NextResponse.redirect(
        new URL(`/dashboard/email-hub/settings?oauth=error&reason=storage_failed&detail=${detail}`, request.url)
      );
    }

    logger.info("Gmail OAuth connected via callback", {
      accountId: state,
      email: profile.emailAddress,
    });

    // Register Pub/Sub watch for real-time push notifications (non-blocking)
    try {
      const { data: acct } = await supabase
        .from("email_accounts")
        .select("*")
        .eq("id", state)
        .single();
      if (acct) {
        await registerWatch(acct as EmailAccount);
      }
    } catch (watchErr) {
      // Non-blocking — cron will retry watch registration
      logger.warn("Failed to register watch on OAuth callback", {
        accountId: state,
        error: watchErr instanceof Error ? watchErr.message : String(watchErr),
      });
    }

    return NextResponse.redirect(
      new URL(`/dashboard/email-hub/settings?oauth=success&account=${encodeURIComponent(profile.emailAddress)}`, request.url)
    );
  } catch (err) {
    logger.error("OAuth callback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(
      new URL("/dashboard/email-hub/settings?oauth=error", request.url)
    );
  }
}

function getRedirectUri(request: NextRequest): string {
  const override = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (override) return override;

  const url = new URL(request.url);
  return `${url.origin}/api/internal/email-hub/gmail/callback`;
}
