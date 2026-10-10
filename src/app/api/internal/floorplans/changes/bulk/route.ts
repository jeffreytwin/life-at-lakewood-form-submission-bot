import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { drainApprovals, queueApprovals } from "@/lib/floorplans/approvals";

export const dynamic = "force-dynamic";
// The approval worker starts here, after the answer has gone; the minute
// cron carries on whatever it leaves (approvals.ts).
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/changes/bulk
 * Body: { action: "approve" | "reject" | "restore", ids: string[] }
 *
 * Approves or rejects a set of pending rows together, which is how the Hub
 * acts on a plan: the sync core queues one row per changed field, so a plan
 * with a new price, new photos and a new description is three rows. The rows
 * of one plan carry the same proposed record, so approving writes the plan
 * to Wix once, through the group's lead row, and gives every row of that
 * plan the same outcome. A plan that cannot be approved yet (a base plan
 * without a score, approval.ts) stays pending and comes back as "blocked";
 * 409 when nothing could be approved at all.
 *
 * Approving answers at once (Jeff, 2026-10-10): every approvable row is
 * marked "approving", locked in the queue (no Edit, no Reject), and the
 * server's approval worker writes the plans to Wix whether or not the page
 * that asked is still open, waiting out Wix when it asks for a wait
 * (approvals.ts). The answer names the rows handed to the worker
 * (`queued`); the page follows how each write ends by reading those rows.
 *
 * "restore" is reject's undo, and it matters more than it sounds: a
 * rejection sticks, so the sync core will not queue the same change again
 * (sync.ts). A reject clicked by accident would otherwise bury that change
 * until the builder's own value moved (Jeff, 2026-09-22). Putting the row
 * back to pending both returns it to the queue and lifts the suppression,
 * since the suppression only looks for rejected rows.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const ids: unknown = body?.ids;
    if (
      (action !== "approve" && action !== "reject" && action !== "restore") ||
      !Array.isArray(ids) || !ids.length || ids.length > 200 ||
      !ids.every((id) => typeof id === "string")
    ) {
      return NextResponse.json(
        { error: "action (approve|reject|restore) and ids (string[]) are required" },
        { status: 400 }
      );
    }
    const now = new Date().toISOString();

    if (action === "reject" || action === "restore") {
      // Only from the one status each moves out of, so a row already
      // written or being written is never dragged back by a stale page.
      const from = action === "reject" ? "pending" : "rejected";
      const to = action === "reject" ? "rejected" : "pending";
      const { data, error } = await supabase
        .from("fp_pending_changes")
        .update({ status: to, updated_at: now })
        .in("id", ids)
        .eq("status", from)
        .select("id");
      if (error) throw error;
      return NextResponse.json({ [action === "reject" ? "rejected" : "restored"]: data?.length ?? 0 });
    }

    const { queued, blocked } = await queueApprovals(ids as string[]);
    if (!queued.length) return NextResponse.json({ results: blocked, queued }, { status: blocked.length ? 409 : 200 });
    after(async () => {
      try {
        await drainApprovals();
      } catch (error) {
        logger.error("Approval worker failed", { error: error instanceof Error ? error.message : String(error) });
      }
    });
    return NextResponse.json({ results: blocked, queued }, { status: 202 });
  } catch (error) {
    logger.error("Bulk floor plan change action failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
