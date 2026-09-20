import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { removeItem, WixApiError } from "@/lib/wix/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/connections/:id/reset
 *
 * Takes a connection back to before its first run, so a builder can be
 * onboarded again from scratch once its extractor has changed (Jeff,
 * 2026-09-19: "remove every floor plan we have in here and try again").
 * Every plan the pipeline holds for this builder in this community is
 * removed from the site's FloorPlansV2 collection (drafts included), then
 * from Supabase with its pending changes and follow-up tasks, and the
 * connection's run history is cleared. Imported photos stay in
 * fp_media_map and the Media Manager: the next run reuses them rather than
 * importing the same pictures twice; scores set in the Hub stay in
 * fp_plan_scores and come back on the next Run (an accidental Reset on
 * 2026-09-20 had cost the seven scores on The Isles). If any Wix removal fails, nothing is
 * deleted from Supabase, so a Wix item is never left behind untracked.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { data: conn, error } = await supabase
      .from("fp_builder_communities")
      .select(
        "id, builder_id, community_id, fp_communities:community_id(site_id, fp_sites:site_id(wix_site_id, wix_collection_id))"
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    const community = conn.fp_communities as unknown as {
      site_id: string;
      fp_sites: { wix_site_id: string | null; wix_collection_id: string | null } | null;
    } | null;
    if (!community?.site_id) return NextResponse.json({ error: "Connection has no site" }, { status: 400 });
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
        logger.warn("Reset could not remove a Wix item", {
          connectionId: id,
          wixRecordId: plan.wix_record_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (wixFailed.length) {
      return NextResponse.json(
        { error: `${wixFailed.length} Wix item(s) could not be removed; nothing was deleted from the Hub. Try again.` },
        { status: 502 }
      );
    }

    // Foreign keys: tasks reference plans and changes, changes reference plans.
    const planIds = (plans ?? []).map((p) => p.id);
    if (planIds.length) {
      const { error: tasksError } = await supabase.from("fp_follow_up_tasks").delete().in("floor_plan_id", planIds);
      if (tasksError) throw tasksError;
    }
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
    const { error: connError } = await supabase
      .from("fp_builder_communities")
      .update({
        last_run_at: null,
        last_run_status: "reset — run again to onboard",
        last_plan_count: null,
        consecutive_failures: 0,
        onboarded_at: null,
      })
      .eq("id", id);
    if (connError) throw connError;

    const result = { plans: planIds.length, wixRemoved, changes: changes?.length ?? 0 };
    logger.info("Floor plan connection reset", { connectionId: id, ...result });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Failed to reset builder connection", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
