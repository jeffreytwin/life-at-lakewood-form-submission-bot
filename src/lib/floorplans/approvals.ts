// Approvals the server finishes on its own (Jeff, 2026-10-10: "Let the
// server finish the run itself"). Approve, Approve selected and Approve All
// mark the plans' rows "approving" and answer at once (queueApprovals); one
// worker at a time writes them to Wix, a plan after another (drainApprovals),
// started by the click and carried on by a cron every minute. The person is
// done the moment they click, and closing the page stops nothing: a plan
// Wix asks to wait for, or one whose pictures Wix is still fetching, is
// tried again by the worker, not sent again by the page.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { applyPendingChange, STILL_FETCHING_RETRY_MS } from "@/lib/floorplans/writeback";
import { groupChanges } from "@/lib/floorplans/group-changes";
import { approvalBlocker } from "@/lib/floorplans/approval";
import { isWritten } from "@/lib/floorplans/leaving-rows";
import { wixThrottleWaitMs } from "@/lib/wix/client";

/**
 * A worker writes for this long and leaves the rest to the next. Two
 * minutes short of the functions' five, so the plan it started last still
 * finishes inside the function's life.
 */
export const APPROVE_BUDGET_MS = 180_000;
/** The worker's lock lasts as long as any function lives, so one cut off frees it by then. */
const LOCK_MS = 300_000;
/**
 * A row the worker claimed ("approved") and still not written this long
 * after was claimed by a function cut off mid-write: it goes back to the
 * worker. Longer than any function lives, so no write still under way is
 * taken for one.
 */
export const INTERRUPTED_MS = 10 * 60_000;
/** A plan whose write broke on something other than Wix (the database, say) waits this long. */
const BROKEN_RETRY_MS = 60_000;

const ROW_COLUMNS =
  "id, site_id, community_id, builder_id, plan_key, change_type, field_changed, status, created_at, updated_at, proposed_record";

type QueueRow = {
  id: string;
  site_id: string;
  community_id: string;
  builder_id: string;
  plan_key: string;
  change_type: "add" | "update" | "remove";
  field_changed: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  proposed_record: unknown;
};

const iso = (ms: number) => new Date(ms).toISOString();

export interface BlockedPlan {
  planKey: string;
  rows: number;
  status: "blocked";
  error: string;
}

/**
 * Hands the pending rows among these to the worker: every row of each plan
 * that can be approved is marked "approving", locked in the queue (no Edit,
 * no Reject) until its write lands. A plan that cannot be approved yet (a
 * base plan without a score, approval.ts) stays pending and comes back as
 * blocked. Returns the rows handed over.
 */
export async function queueApprovals(ids: string[]): Promise<{ queued: string[]; blocked: BlockedPlan[] }> {
  const { data: rows, error } = await supabase
    .from("fp_pending_changes")
    .select(ROW_COLUMNS)
    .in("id", ids)
    .eq("status", "pending");
  if (error) throw error;
  const blocked: BlockedPlan[] = [];
  const approvable: string[] = [];
  for (const group of groupChanges((rows ?? []) as QueueRow[])) {
    const blocker = approvalBlocker(group.lead.change_type, group.lead.proposed_record);
    if (blocker) blocked.push({ planKey: group.lead.plan_key, rows: group.rows.length, status: "blocked", error: blocker });
    else approvable.push(...group.rows.map((r) => r.id));
  }
  if (!approvable.length) return { queued: [], blocked };
  const now = iso(Date.now());
  const { data: marked, error: markError } = await supabase
    .from("fp_pending_changes")
    .update({ status: "approving", approval_requested_at: now, approve_after: null, updated_at: now })
    .in("id", approvable)
    .eq("status", "pending")
    .select("id");
  if (markError) throw markError;
  return { queued: (marked ?? []).map((r) => r.id as string), blocked };
}

/** Takes the worker's lock; false while another worker holds it, or while Wix asked for a wait. */
async function holdLock(): Promise<boolean> {
  const now = Date.now();
  const { data, error } = await supabase
    .from("system_settings")
    .update({ fp_approve_lock_until: iso(now + LOCK_MS) })
    .eq("id", 1)
    .or(`fp_approve_lock_until.is.null,fp_approve_lock_until.lt.${iso(now)}`)
    .select("id");
  if (error) throw new Error(`approval lock: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Lets the lock go, or keeps it until Wix's wait is over so no worker asks before then. */
async function letGo(until: number | null): Promise<void> {
  await supabase
    .from("system_settings")
    .update({ fp_approve_lock_until: until ? iso(until) : null })
    .eq("id", 1);
}

/** Rows a cut-off worker had claimed and never wrote go back to the worker. */
async function resumeInterrupted(): Promise<void> {
  const now = Date.now();
  const { error } = await supabase
    .from("fp_pending_changes")
    .update({ status: "approving", approve_after: null, updated_at: iso(now) })
    .eq("status", "approved")
    .not("approval_requested_at", "is", null)
    .lt("updated_at", iso(now - INTERRUPTED_MS));
  if (error) logger.warn("Interrupted approvals could not be resumed", { error: error.message });
}

/** The rows waiting for the worker whose time has come. */
const dueRows = () =>
  supabase
    .from("fp_pending_changes")
    .select(ROW_COLUMNS)
    .eq("status", "approving")
    .or(`approve_after.is.null,approve_after.lte.${iso(Date.now())}`);

async function anythingDue(): Promise<boolean> {
  const { data, error } = await dueRows().limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** The plan the person asked for first, of those whose time has come; null when none is waiting. */
async function nextDue() {
  const { data: first, error } = await dueRows()
    .order("approval_requested_at", { ascending: true, nullsFirst: true })
    .order("created_at")
    .order("id")
    .limit(1);
  if (error) throw error;
  const row = (first ?? [])[0] as QueueRow | undefined;
  if (!row) return null;
  const { data: rows, error: planError } = await dueRows().match({
    site_id: row.site_id,
    community_id: row.community_id,
    builder_id: row.builder_id,
    plan_key: row.plan_key,
  });
  if (planError) throw planError;
  return groupChanges((rows ?? []) as QueueRow[]).find((g) => g.rows.some((r) => r.id === row.id)) ?? null;
}

type Group = NonNullable<Awaited<ReturnType<typeof nextDue>>>;

/** Puts a plan's rows back to wait for the worker, from whichever of the two states it stands in. */
async function backToWorker(ids: string[], after: number | null): Promise<void> {
  await supabase
    .from("fp_pending_changes")
    .update({ status: "approving", approve_after: after ? iso(after) : null, updated_at: iso(Date.now()) })
    .in("id", ids)
    .in("status", ["approved", "approving"]);
}

/**
 * Writes one plan: claims its rows ("approved"), writes the plan to Wix
 * through its lead row, and gives every row the lead's outcome. A plan
 * Wix is refusing or still fetching the pictures of goes back to wait.
 * Null when its rows were no longer the worker's to claim.
 */
async function writePlan(group: Group) {
  const ids = group.rows.map((r) => r.id);
  const { data: claimed, error: claimError } = await supabase
    .from("fp_pending_changes")
    .update({ status: "approved", updated_at: iso(Date.now()) })
    .in("id", ids)
    .eq("status", "approving")
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return null;
  try {
    const outcome = await applyPendingChange(group.lead.id);
    if (outcome.throttled || outcome.fetching) {
      // Nothing is wrong with the plan (Jeff, 2026-09-22): a throttled one
      // stays first in line for when Wix lets the worker back in.
      await backToWorker(ids, outcome.fetching ? Date.now() + STILL_FETCHING_RETRY_MS : null);
      return outcome;
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
          updated_at: iso(Date.now()),
        })
        .in("id", rest.map((r) => r.id));
      if (restError) throw restError;
    }
    return outcome;
  } catch (error) {
    // The write broke on something other than Wix: the plan waits a minute
    // and is tried again, rather than sitting claimed until it is resumed.
    await backToWorker(ids, Date.now() + BROKEN_RETRY_MS).catch(() => undefined);
    throw error;
  }
}

export interface DrainResult {
  written: number;
  failed: number;
  /** Plans put back to wait: Wix refusing, or still fetching their pictures. */
  waiting: number;
  skipped?: string;
}

/**
 * Writes the plans waiting for the worker, the first asked for first, for
 * up to `budgetMs`; whatever is left is the next worker's (the minute
 * cron). One worker at a time. When Wix asks for a wait, the worker stops
 * and keeps the lock until it is over.
 */
export async function drainApprovals(budgetMs = APPROVE_BUDGET_MS): Promise<DrainResult> {
  const result: DrainResult = { written: 0, failed: 0, waiting: 0 };
  const started = Date.now();
  await resumeInterrupted();
  // Nothing waiting, nothing locked: the cron asks every minute.
  if (!(await anythingDue())) return result;
  if (!(await holdLock())) return { ...result, skipped: "another worker is writing, or Wix asked for a wait" };
  let holdUntil: number | null = null;
  let emptied = false;
  try {
    const seen = new Set<string>();
    while (Date.now() - started < budgetMs) {
      const group = await nextDue();
      if (!group) {
        emptied = true;
        break;
      }
      // A plan offered twice in one run was not taken off the line by its
      // write; the next worker tries it, rather than this one going round.
      if (seen.has(group.key)) break;
      seen.add(group.key);
      const outcome = await writePlan(group);
      if (!outcome) continue;
      if (outcome.throttled) {
        result.waiting += 1;
        holdUntil = Date.now() + Math.max(wixThrottleWaitMs(), 1000);
        break;
      }
      if (outcome.fetching) result.waiting += 1;
      else if (isWritten(outcome.status)) result.written += 1;
      else if (outcome.status === "failed") result.failed += 1;
    }
  } catch (error) {
    logger.error("Approval worker stopped", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    await letGo(holdUntil).catch(() => undefined);
  }
  if (result.written || result.failed || result.waiting) logger.info("Approval worker ran", { ...result });
  // Plans approved while this worker was letting go found the lock held and
  // left their writes to it; they are written now, not at the next minute.
  const left = budgetMs - (Date.now() - started);
  if (emptied && left > 0 && (await anythingDue().catch(() => false))) {
    const more = await drainApprovals(left);
    return { written: result.written + more.written, failed: result.failed + more.failed, waiting: result.waiting + more.waiting };
  }
  return result;
}
