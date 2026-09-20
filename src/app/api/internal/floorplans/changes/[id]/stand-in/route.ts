import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";
import { homesOfPlan, standInPlan, type StandInRule } from "@/lib/floorplans/stand-ins";
import { linkQuickMoveIns } from "@/lib/floorplans/quick-move-ins";
import { standardizePlan } from "@/lib/floorplans/standardize";
import { withRememberedScore } from "@/lib/floorplans/scores";
import { queueChange, readPlanInFull } from "@/lib/floorplans/sync";
import { neutralizeDescriptions } from "@/lib/floorplans/description";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/internal/floorplans/changes/:id/stand-in
 * Body: { planName?: string }
 *
 * Creates the floor plan a queued quick move-in is built from, when the
 * builder no longer lists it (Jeff, 2026-09-20): the decision is remembered
 * (fp_stand_in_plans) so every Run rebuilds the plan from its homes, and
 * the plan is queued now as a new plan, built from the home's own page so it
 * carries every picture. The home's queued rows are tied to it. The plan
 * needs a score before approval, like any base plan.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const { data: change, error: loadError } = await supabase
      .from("fp_pending_changes")
      .select("id, status, proposed_record, site_id, community_id, builder_id, plan_key, fp_builders:builder_id(name)")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!change) return NextResponse.json({ error: "Change not found" }, { status: 404 });
    if (change.status !== "pending") {
      return NextResponse.json({ error: "Only a pending quick move-in can stand in for a floor plan" }, { status: 409 });
    }
    const home = change.proposed_record as NormalizedPlan | null;
    if (!home?.quickMoveIn) {
      return NextResponse.json({ error: "Only a quick move-in can stand in for a floor plan" }, { status: 400 });
    }
    const typed = typeof body?.planName === "string" ? body.planName.trim() : "";
    const planName = typed || (home.relatedPlanName ?? "").trim();
    const planKey = normKey(planName);
    if (!planKey) {
      return NextResponse.json({ error: "Name the base plan first (the Base plan field)" }, { status: 400 });
    }
    const scope = { site_id: change.site_id, community_id: change.community_id, builder_id: change.builder_id };

    // A plan the builder lists, or one already queued, needs no stand-in.
    const { data: live, error: liveError } = await supabase
      .from("fp_floor_plans")
      .select("id")
      .match(scope)
      .eq("plan_key", planKey)
      .eq("quick_move_in", false)
      .is("removed_at", null)
      .maybeSingle();
    if (liveError) throw liveError;
    if (live) {
      return NextResponse.json({ error: `A floor plan named "${planName}" already exists; set it as the base plan instead` }, { status: 409 });
    }
    const { data: queuedPlan, error: queuedError } = await supabase
      .from("fp_pending_changes")
      .select("id")
      .match(scope)
      .eq("plan_key", planKey)
      .eq("status", "pending")
      .limit(1);
    if (queuedError) throw queuedError;
    if (queuedPlan?.length) {
      return NextResponse.json({ error: `"${planName}" is already in the queue; set it as the base plan instead` }, { status: 409 });
    }

    const rule: StandInRule = { planKey, planName, sourcePlanKey: change.plan_key };
    const { error: ruleError } = await supabase
      .from("fp_stand_in_plans")
      .upsert(
        { ...scope, plan_key: planKey, plan_name: planName, source_plan_key: change.plan_key },
        { onConflict: "site_id,community_id,builder_id,plan_key" }
      );
    if (ruleError) throw ruleError;

    // Every home of the plan on offer: the queue's quick move-ins and the live ones.
    const { data: pendingRows, error: pendingError } = await supabase
      .from("fp_pending_changes")
      .select("id, plan_key, proposed_record")
      .match(scope)
      .eq("status", "pending");
    if (pendingError) throw pendingError;
    const { data: liveRows, error: liveRowsError } = await supabase
      .from("fp_floor_plans")
      .select("plan_key, record")
      .match(scope)
      .eq("quick_move_in", true)
      .is("removed_at", null);
    if (liveRowsError) throw liveRowsError;
    const seen = new Set<string>();
    const candidates: NormalizedPlan[] = [];
    for (const raw of [...(pendingRows ?? []).map((r) => r.proposed_record), ...(liveRows ?? []).map((r) => r.record)]) {
      const p = raw as NormalizedPlan | null;
      if (!p?.quickMoveIn || !p.planKey || seen.has(p.planKey)) continue;
      seen.add(p.planKey);
      // The clicked home carries the name chosen for it.
      candidates.push(p.planKey === change.plan_key ? { ...p, relatedPlanName: planName } : p);
    }
    const homes = homesOfPlan(rule, candidates);
    const built = standInPlan(rule, homes);
    if (!built) return NextResponse.json({ error: "No quick move-in of this plan is on offer" }, { status: 400 });

    const builderName = (change.fp_builders as unknown as { name: string } | null)?.name ?? "";
    let plan = built;
    try {
      plan = await readPlanInFull(builderName, built);
    } catch (err) {
      logger.warn("Stand-in plan page could not be read", { planKey, error: err instanceof Error ? err.message : String(err) });
    }
    [plan] = await neutralizeDescriptions([plan], builderName);
    const { data: scoreRows } = await supabase.from("fp_plan_scores").select("plan_key, score").match(scope).eq("plan_key", planKey);
    const remembered = new Map((scoreRows ?? []).map((r) => [r.plan_key, Number(r.score)] as const));
    const [linked] = linkQuickMoveIns([standardizePlan(plan), ...homes]);
    const proposed = withRememberedScore(linked, remembered);
    const queued = await queueChange({
      siteId: scope.site_id, communityId: scope.community_id, builderId: scope.builder_id,
      planKey, changeType: "add", newValue: proposed.priceDisplay,
      proposedRecord: proposed, runId: `stand-in-${Date.now()}`,
    });

    // The homes' queued rows now name the plan and are tied to it.
    const now = new Date().toISOString();
    const homeKeys = new Set(homes.map((h) => h.planKey));
    for (const row of (pendingRows ?? []).filter((r) => homeKeys.has(r.plan_key))) {
      const rec = { ...((row.proposed_record ?? {}) as Record<string, unknown>) };
      const edited = new Set((rec.userEditedFields as string[] | undefined) ?? []);
      if (String(rec.relatedPlanName ?? "") !== planName) {
        rec.relatedPlanName = planName;
        edited.add("relatedPlanName");
      }
      rec.relatedPlanKey = planKey;
      rec.relatedPlanMatch = "plan-name";
      rec.userEditedFields = [...edited];
      const { error: relinkError } = await supabase
        .from("fp_pending_changes")
        .update({ proposed_record: rec, updated_at: now })
        .eq("id", row.id);
      if (relinkError) throw relinkError;
    }

    logger.info("Stand-in floor plan queued", { planKey, homes: homes.map((h) => h.name), queued });
    return NextResponse.json({
      planKey,
      name: planName,
      queued,
      photos: proposed.galleryImages.length,
      drawings: proposed.blueprintImages.length,
      homes: homes.map((h) => h.name),
    });
  } catch (error) {
    logger.error("Failed to create a stand-in floor plan", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
