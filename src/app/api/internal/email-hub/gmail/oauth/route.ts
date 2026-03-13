import { NextRequest, NextResponse } from "next/server";
import { buildOAuthUrl, exchangeAuthCode, getProfile } from "@/lib/gmail/client";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

/**
 * GET: Generate an OAuth consent URL for a given email account.
 * Query params: account_id
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id");

    if (!accountId) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }

    const { data: account, error } = await supabase
      .from("email_accounts")
      .select("email_address")
      .eq("id", accountId)
      .single();

    if (error || !account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const redirectUri = getRedirectUri(request);
    const url = buildOAuthUrl(redirectUri, account.email_address);

    return NextResponse.json({ url, account_id: accountId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST: Exchange an OAuth code for tokens and store them.
 * Body: { account_id, code }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account_id, code } = body;

    if (!account_id || !code) {
      return NextResponse.json(
        { error: "account_id and code are required" },
        { status: 400 }
      );
    }

    const { data: account, error: fetchError } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", account_id)
      .single();

    if (fetchError || !account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const redirectUri = getRedirectUri(request);
    const credentials = await exchangeAuthCode(code, redirectUri);

    // Verify the token works and get initial history ID
    const profile = await getProfile(account_id, credentials);

    // Store credentials and initial sync cursor
    const { error: updateError } = await supabase
      .from("email_accounts")
      .update({
        credentials: credentials as unknown as Record<string, unknown>,
        sync_history_id: profile.historyId,
        sent_sync_history_id: profile.historyId,
        is_active: true,
      })
      .eq("id", account_id);

    if (updateError) throw updateError;

    logger.info("Gmail OAuth connected", {
      accountId: account_id,
      email: account.email_address,
    });

    return NextResponse.json({
      success: true,
      email: profile.emailAddress,
    });
  } catch (error) {
    logger.error("Gmail OAuth exchange failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function getRedirectUri(request: NextRequest): string {
  const override = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (override) return override;

  const url = new URL(request.url);
  return `${url.origin}/api/internal/email-hub/gmail/callback`;
}
