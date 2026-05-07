import { NextRequest, NextResponse } from "next/server";
import { syncAllInboxes } from "@/lib/gmail/sync-inbox";
import { syncAllSentFolders } from "@/lib/gmail/sync-sent";
import { pushAllPendingDrafts, reconcileDeletedDrafts } from "@/lib/gmail/push-draft";
import { renewAllWatches } from "@/lib/gmail/watch";
import { supabase } from "@/lib/supabase/client";
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

    // Step 0: Check if auto-approve should be enabled by schedule
    try {
      const { data: settings } = await supabase
        .from("system_settings")
        .select("auto_approve_drafts, auto_approve_schedule_time")
        .eq("id", 1)
        .single();

      if (settings?.auto_approve_schedule_time && !settings.auto_approve_drafts) {
        const now = new Date();
        const etTime = now.toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const [nowH, nowM] = etTime.split(":").map(Number);
        const [schedH, schedM] = settings.auto_approve_schedule_time.split(":").map(Number);
        const nowMinutes = nowH * 60 + nowM;
        const schedMinutes = schedH * 60 + schedM;

        if (nowMinutes >= schedMinutes) {
          await supabase
            .from("system_settings")
            .update({ auto_approve_drafts: true, updated_at: now.toISOString() })
            .eq("id", 1);
          logger.info("Auto-approve enabled by schedule", {
            scheduleTime: settings.auto_approve_schedule_time,
            currentET: etTime,
          });
        }
      }
    } catch (schedErr) {
      logger.warn("Auto-approve schedule check failed", {
        error: schedErr instanceof Error ? schedErr.message : String(schedErr),
      });
    }

    // Step 1: Sync inboxes
    const inbox = await syncAllInboxes();

    // Step 2: Push AI-generated drafts to Gmail
    const drafts = await pushAllPendingDrafts();

    // Step 3: Sync sent folders
    const sent = await syncAllSentFolders();

    // Step 4: Reconcile deleted Gmail drafts (mark as discarded)
    const reconciled = await reconcileDeletedDrafts();

    // Step 5: Renew Pub/Sub watches (if configured)
    const watches = await renewAllWatches();

    const result = {
      inbox: {
        accounts: inbox.accounts,
        newMessages: inbox.totalNewMessages,
        draftsGenerated: inbox.totalDraftsGenerated,
        skippedNonLead: inbox.totalSkippedNonLead,
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
      draftsReconciled: reconciled.discarded > 0 || reconciled.sent > 0 ? reconciled : undefined,
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
