import { NextRequest, NextResponse } from "next/server";
import { syncAllInboxes } from "@/lib/gmail/sync-inbox";
import { syncAllSentFolders } from "@/lib/gmail/sync-sent";
import { pushAllPendingDrafts } from "@/lib/gmail/push-draft";
import { renewAllWatches } from "@/lib/gmail/watch";
import { logger } from "@/lib/shared/logger";

/**
 * Cron job to sync Gmail inboxes and sent folders.
 * Runs on a schedule (e.g., every 3 minutes via Vercel Cron or external scheduler).
 *
 * Steps:
 * 1. Sync inboxes → fetch new inbound messages, generate AI drafts
 * 2. Push pending drafts to Gmail
 * 3. Sync sent folders → detect sent messages, compare to AI drafts
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logger.info("Email sync cron started");

    // Step 1: Sync inboxes
    const inbox = await syncAllInboxes();

    // Step 2: Push AI-generated drafts to Gmail
    const drafts = await pushAllPendingDrafts();

    // Step 3: Sync sent folders
    const sent = await syncAllSentFolders();

    // Step 4: Renew Pub/Sub watches (if configured)
    const watches = await renewAllWatches();

    const result = {
      inbox: {
        accounts: inbox.accounts,
        newMessages: inbox.totalNewMessages,
        draftsGenerated: inbox.totalDraftsGenerated,
      },
      draftsPushed: {
        pushed: drafts.pushed,
        failed: drafts.failed,
      },
      sent: {
        accounts: sent.accounts,
        matched: sent.totalMatched,
        changedFromDraft: sent.totalChanged,
      },
      watches: watches.renewed > 0 || watches.failed > 0 ? watches : undefined,
    };

    logger.info("Email sync cron complete", result);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Email sync cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
