// Clearing a builder×community connection: every plan the pipeline holds
// for it leaves the site's Floor Plans V2 collection (drafts included),
// its imported pictures leave the Media Manager, and the Hub forgets the
// plans: queued changes, follow-up tasks, plan links, scores, stand-in
// rules, photo records. Reset (Settings → Builder Connections) keeps the
// connection for another run from scratch; Remove deletes the connection
// as well, the way a sold-out neighborhood leaves (Jeff, 2026-09-21).
//
// If any Wix item removal fails, nothing is deleted from Supabase, so a Wix
// item is never left behind untracked; a Media Manager file Wix would not
// delete is reported and the clearing goes on. A picture another plan on
// the site still uses is kept.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { removeItem, WixApiError } from "@/lib/wix/client";
import { releaseConnectionMedia } from "@/lib/floorplans/media-cleanup";
import { describeError } from "@/lib/shared/describe-error";

export interface ClearedConnection {
  plans: number;
  wixRemoved: number;
  changes: number;
  photos: number;
  photosFailed: number;
  photoRows: number;
  rasters: number;
}

/**
 * Which step of the clearing failed, and what the database said. Three
 * Resets in a row said "Internal server error" and logged "[object
 * Object]" (Jeff, 2026-09-22); a person deserves to know it was the
 * queue, or the pictures, or the plans themselves.
 */
const failed = (step: string, error: unknown) => new Error(`${step}: ${describeError(error)}`);

/** How many ids go into one request; a URL has a length and a queue can be long. */
const CHUNK = 100;
/** How many rows one read brings back before another is needed. */
const PAGE = 1000;

export type ClearOutcome =
  | { ok: true; result: ClearedConnection }
  | { ok: false; status: 400 | 404 | 502; error: string };

/** Removes a connection's plans from the site and the Hub; the connection row itself is left to the caller. */
export async function clearConnection(id: string): Promise<ClearOutcome> {
  const { data: conn, error } = await supabase
    .from("fp_builder_communities")
    .select(
      "id, builder_id, community_id, fp_communities:community_id(site_id, fp_sites:site_id(wix_site_id, wix_collection_id))"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw failed("reading the connection", error);
  if (!conn) return { ok: false, status: 404, error: "Connection not found" };
  const community = conn.fp_communities as unknown as {
    site_id: string;
    fp_sites: { wix_site_id: string | null; wix_collection_id: string | null } | null;
  } | null;
  if (!community?.site_id) return { ok: false, status: 400, error: "Connection has no site" };
  const scope = { site_id: community.site_id, community_id: conn.community_id, builder_id: conn.builder_id };

  const { data: plans, error: plansError } = await supabase
    .from("fp_floor_plans")
    .select("id, wix_record_id")
    .match(scope);
  if (plansError) throw failed("reading the connection's plans", plansError);

  let wixRemoved = 0;
  const wixFailed: string[] = [];
  const wix = community.fp_sites;
  for (const plan of plans ?? []) {
    if (!plan.wix_record_id) continue;
    if (!wix?.wix_site_id || !wix.wix_collection_id) {
      wixFailed.push(plan.wix_record_id);
      continue;
    }
    try {
      await removeItem(wix.wix_site_id, wix.wix_collection_id, plan.wix_record_id);
      wixRemoved += 1;
    } catch (err) {
      // Already gone in Wix is the outcome wanted; anything else is not.
      if (err instanceof WixApiError && err.status === 404) continue;
      wixFailed.push(plan.wix_record_id);
      logger.warn("Clearing a connection could not remove a Wix item", {
        connectionId: id,
        wixRecordId: plan.wix_record_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (wixFailed.length) {
    return {
      ok: false,
      status: 502,
      error: `${wixFailed.length} Wix item(s) could not be removed; nothing was deleted from the Hub. Try again.`,
    };
  }

  // The pictures, while the plans and changes still say which ones are in scope.
  const media = await releaseConnectionMedia(wix?.wix_site_id ?? null, scope).catch((error) => {
    throw failed("releasing its pictures", error);
  });

  // Foreign keys: everything pointing at what is about to go, first.
  // Tasks and links name a plan; a task also names the change it came
  // from, and that one is not always a change of a plan still here — a
  // Reset held up by a single follow-up task is a Reset that fails with
  // nothing to show for it (Jeff, 2026-09-22).
  const planIds = (plans ?? []).map((p) => p.id);
  if (planIds.length) {
    const { error: tasksError } = await supabase.from("fp_follow_up_tasks").delete().in("floor_plan_id", planIds);
    if (tasksError) throw failed("clearing the follow-up tasks of its plans", tasksError);
    const { error: linksError } = await supabase.from("fp_plan_links").delete().in("floor_plan_id", planIds);
    if (linksError) throw failed("clearing its plan links", linksError);
  }
  const { error: scoresError } = await supabase.from("fp_plan_scores").delete().match(scope);
  if (scoresError) throw failed("clearing its scores", scoresError);
  const { error: standInsError } = await supabase.from("fp_stand_in_plans").delete().match(scope);
  if (standInsError) throw failed("clearing its stand-in rules", standInsError);

  // Every queued change, not just the first page of them: what is left
  // behind would hold up the plans it names.
  const changeIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: queued, error: queuedError } = await supabase
      .from("fp_pending_changes")
      .select("id")
      .match(scope)
      .range(from, from + PAGE - 1);
    if (queuedError) throw failed("reading its queued changes", queuedError);
    changeIds.push(...(queued ?? []).map((c) => c.id));
    if (!queued || queued.length < PAGE) break;
  }
  for (let i = 0; i < changeIds.length; i += CHUNK) {
    const batch = changeIds.slice(i, i + CHUNK);
    const { error: tasksError } = await supabase.from("fp_follow_up_tasks").delete().in("pending_change_id", batch);
    if (tasksError) throw failed("clearing the follow-up tasks of its changes", tasksError);
    const { error: changesError } = await supabase.from("fp_pending_changes").delete().in("id", batch);
    if (changesError) throw failed("clearing its queued changes", changesError);
  }

  if (planIds.length) {
    const { error: plansDeleteError } = await supabase.from("fp_floor_plans").delete().in("id", planIds);
    if (plansDeleteError) throw failed("clearing its plans", plansDeleteError);
  }

  return {
    ok: true,
    result: {
      plans: planIds.length,
      wixRemoved,
      changes: changeIds.length,
      photos: media.filesDeleted,
      photosFailed: media.filesFailed.length,
      photoRows: media.rows,
      rasters: media.rasters,
    },
  };
}
