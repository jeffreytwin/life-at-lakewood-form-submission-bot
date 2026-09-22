import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { applyPendingChange } from "@/lib/floorplans/writeback";
import { groupChanges } from "@/lib/floorplans/group-changes";
import { approvalBlocker } from "@/lib/floorplans/approval";
import { releaseStaleApproving } from "@/lib/floorplans/approving";
import { wixThrottleWaitMs } from "@/lib/wix/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Plans are written for this long in one request; the rest go back to
 * pending and come back as `remaining`. Two minutes short of maxDuration,
 * so the plan started last still finishes inside the function's life.
 */
const BUDGET_MS = 180_000;

/**
 * POST /api/internal/floorplans/changes/bulk
 * Body: { action: "approve" | "reject", ids: string[] }
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
 * Every approvable row is marked "approving" first, so the queue shows it
 * locked (no Edit, no Reject) while the writes run, and the writes run
 * here on the server whether or not the page that asked is still open
 * (Jeff, 2026-09-21). Plans are written one after another within a time
 * budget; what did not fit goes back to pending and is returned as
 * `remaining` for the page to send again.
 */
export async function POST(request: NextRequest) {
  // Rows this request locked; released if it dies before writing them.
  let locked: string[] = [];
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const ids: unknown = body?.ids;
    if (
      (action !== "approve" && action !== "reject") ||
      !Array.isArray(ids) || !ids.length || ids.length > 200 ||
      !ids.every((id) => typeof id === "string")
    ) {
      return NextResponse.json({ error: "action (approve|reject) and ids (string[]) are required" }, { status: 400 });
    }
    const now = new Date().toISOString();

    if (action === "reject") {
      const { data, error } = await supabase
        .from("fp_pending_changes")
        .update({ status: "rejected", updated_at: now })
        .in("id", ids)
        .eq("status", "pending")
        .select("id");
      if (error) throw error;
      return NextResponse.json({ rejected: data?.length ?? 0 });
    }

    // A row a dead request left locked goes back to the queue (approving.ts).
    await releaseStaleApproving();

    const { data: rows, error: loadError } = await supabase
      .from("fp_pending_changes")
      .select("id, site_id, community_id, builder_id, plan_key, change_type, status, created_at, updated_at, proposed_record")
      .in("id", ids)
      .eq("status", "pending");
    if (loadError) throw loadError;
    if (!rows?.length) return NextResponse.json({ results: [], remaining: [] });

    const results: { planKey: string; rows: number; status: string; error: string | null }[] = [];
    const approvable: ReturnType<typeof groupChanges<(typeof rows)[number]>> = [];
    for (const group of groupChanges(rows)) {
      const blocker = approvalBlocker(group.lead.change_type, group.lead.proposed_record);
      if (blocker) results.push({ planKey: group.lead.plan_key, rows: group.rows.length, status: "blocked", error: blocker });
      else approvable.push(group);
    }
    if (!approvable.length) return NextResponse.json({ results, remaining: [] }, { status: 409 });

    // Locked first, all of them, so nothing is edited or rejected under a write.
    locked = approvable.flatMap((g) => g.rows.map((r) => r.id));
    const { error: lockError } = await supabase
      .from("fp_pending_changes")
      .update({ status: "approving", updated_at: now })
      .in("id", locked)
      .eq("status", "pending");
    if (lockError) throw lockError;

    const started = Date.now();
    const remaining: string[] = [];
    // Set once Wix starts refusing: the rest of the run goes back to the
    // queue and the page is told how long to leave it.
    let throttledFor = 0;
    for (const group of approvable) {
      const groupIds = group.rows.map((r) => r.id);
      if (throttledFor || Date.now() - started > BUDGET_MS) {
        remaining.push(...groupIds);
        continue;
      }
      const { error: approveError } = await supabase
        .from("fp_pending_changes")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .in("id", groupIds)
        .eq("status", "approving");
      if (approveError) throw approveError;
      const outcome = await applyPendingChange(group.lead.id);
      if (outcome.throttled) {
        // Nothing is wrong with this plan; Wix is refusing everyone. It
        // goes back with the ones not started yet (Jeff, 2026-09-22).
        throttledFor = Math.max(wixThrottleWaitMs(), 1000);
        remaining.push(...groupIds);
        continue;
      }
      const rest = group.rows.filter((r) => r.id !== group.lead.id);
      if (rest.length) {
        const { data: applied } = await supabase
          .from("fp_pending_changes")
          .select("wix_record_id, floor_plan_id, error_detail")
          .eq("id", group.lead.id)
          .single();
        const { error: restError } = await supabase
          .from("fp_pending_changes")
          .update({
            status: outcome.status,
            wix_record_id: applied?.wix_record_id ?? null,
            floor_plan_id: applied?.floor_plan_id ?? null,
            error_detail: applied?.error_detail ?? null,
            updated_at: new Date().toISOString(),
          })
          .in("id", rest.map((r) => r.id));
        if (restError) throw restError;
      }
      results.push({ planKey: group.lead.plan_key, rows: group.rows.length, status: outcome.status, error: outcome.error ?? null });
    }
    if (remaining.length) {
      for (const status of ["approving", "approved"]) {
        await supabase
          .from("fp_pending_changes")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .in("id", remaining)
          .eq("status", status);
      }
    }
    const failed = results.some((r) => r.status === "failed");
    return NextResponse.json(
      { results, remaining, ...(throttledFor ? { retryAfterMs: throttledFor } : {}) },
      { status: failed ? 502 : 200 }
    );
  } catch (error) {
    logger.error("Bulk floor plan change action failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (locked.length) {
      // Whatever was locked and never written goes back to the queue now, not in ten minutes.
      await supabase
        .from("fp_pending_changes")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .in("id", locked)
        .eq("status", "approving")
        .then(() => undefined, () => undefined);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
