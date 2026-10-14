import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { queueAdjustment } from "@/lib/floorplans/adjust-queue";
import { ADJUSTMENT_LABEL } from "@/lib/floorplans/adjustment";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/floorplans/adjustments?q=siesta
 *
 * Live floor plans and quick move-ins by name (a home's name is its
 * address), for the Adjust tab: where each one is, since builders share
 * plan names, what it shows now, and the adjustment already waiting for
 * it, if one is.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ plans: [] });
  try {
    const { data, error } = await supabase
      .from("fp_floor_plans")
      .select(
        "id, site_id, community_id, builder_id, plan_key, name, quick_move_in, record, fp_sites:site_id(name), fp_communities:community_id(name), fp_builders:builder_id(name)"
      )
      .is("removed_at", null)
      .not("wix_record_id", "is", null)
      .ilike("name", `%${q.replace(/[%_]/g, "")}%`)
      .order("name")
      .limit(50);
    if (error) throw error;
    const rows = data ?? [];
    const keys = [...new Set(rows.map((p) => p.plan_key))];
    const { data: waiting } = keys.length
      ? await supabase
          .from("fp_pending_changes")
          .select("id, site_id, community_id, builder_id, plan_key")
          .eq("field_changed", ADJUSTMENT_LABEL)
          .eq("status", "pending")
          .in("plan_key", keys)
      : { data: [] };
    const scopeKey = (r: { site_id: string; community_id: string; builder_id: string; plan_key: string }) =>
      `${r.site_id}|${r.community_id}|${r.builder_id}|${r.plan_key}`;
    const waitingFor = new Map((waiting ?? []).map((w) => [scopeKey(w), w.id as string]));
    const plans = rows.map((p) => {
      const rec = (p.record ?? {}) as { priceDisplay?: string | null; homeType?: string | null; beds?: string; baths?: string; sqft?: number | null };
      const site = p.fp_sites as unknown as { name: string } | null;
      const community = p.fp_communities as unknown as { name: string } | null;
      const builder = p.fp_builders as unknown as { name: string } | null;
      return {
        id: p.id,
        name: p.name,
        quickMoveIn: p.quick_move_in,
        site: site?.name ?? null,
        community: community?.name ?? null,
        builder: builder?.name ?? null,
        priceDisplay: rec.priceDisplay ?? null,
        homeType: rec.homeType ?? null,
        beds: rec.beds ?? null,
        baths: rec.baths ?? null,
        sqft: rec.sqft ?? null,
        waitingId: waitingFor.get(scopeKey(p)) ?? null,
      };
    });
    return NextResponse.json({ plans });
  } catch (error) {
    logger.error("Floor plan search for an adjustment failed", { q, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/internal/floorplans/adjustments
 * Body: { planId }
 *
 * Queues the live plan for adjustment (adjust-queue.ts) and answers with
 * the queued change's id, to edit with PATCH /changes/:id and approve as
 * any change. A plan with one waiting already gets that one.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const planId = typeof body?.planId === "string" ? body.planId.trim() : "";
    if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });
    const outcome = await queueAdjustment(planId);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ id: outcome.id, created: outcome.created }, { status: outcome.created ? 201 : 200 });
  } catch (error) {
    logger.error("Failed to queue a floor plan adjustment", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
