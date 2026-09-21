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

export interface ClearedConnection {
  plans: number;
  wixRemoved: number;
  changes: number;
  photos: number;
  photosFailed: number;
  photoRows: number;
  rasters: number;
}

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
  if (error) throw error;
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
  if (plansError) throw plansError;

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
  const media = await releaseConnectionMedia(wix?.wix_site_id ?? null, scope);

  // Foreign keys: tasks and links reference plans, changes reference plans.
  const planIds = (plans ?? []).map((p) => p.id);
  if (planIds.length) {
    const { error: tasksError } = await supabase.from("fp_follow_up_tasks").delete().in("floor_plan_id", planIds);
    if (tasksError) throw tasksError;
    const { error: linksError } = await supabase.from("fp_plan_links").delete().in("floor_plan_id", planIds);
    if (linksError) throw linksError;
  }
  const { error: scoresError } = await supabase.from("fp_plan_scores").delete().match(scope);
  if (scoresError) throw scoresError;
  const { error: standInsError } = await supabase.from("fp_stand_in_plans").delete().match(scope);
  if (standInsError) throw standInsError;
  const { data: changes, error: changesError } = await supabase
    .from("fp_pending_changes")
    .delete()
    .match(scope)
    .select("id");
  if (changesError) throw changesError;
  if (planIds.length) {
    const { error: plansDeleteError } = await supabase.from("fp_floor_plans").delete().in("id", planIds);
    if (plansDeleteError) throw plansDeleteError;
  }

  return {
    ok: true,
    result: {
      plans: planIds.length,
      wixRemoved,
      changes: changes?.length ?? 0,
      photos: media.filesDeleted,
      photosFailed: media.filesFailed.length,
      photoRows: media.rows,
      rasters: media.rasters,
    },
  };
}
