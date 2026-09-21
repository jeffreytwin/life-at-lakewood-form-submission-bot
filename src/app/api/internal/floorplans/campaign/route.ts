import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

interface PlanRecord {
  priceDisplay?: string | null;
  beds?: string;
  baths?: string;
  sqft?: number | null;
  garages?: string | null;
  homeType?: string | null;
  galleryImages?: string[];
  primaryImage?: string | null;
  hasQuickMoveIns?: boolean;
  relatedPlanKey?: string | null;
  relatedPlanName?: string | null;
  urlSlug?: string | null;
  virtualTourUrl?: string | null;
  score?: number | null;
}

interface PlanRow {
  id: string;
  site_id: string;
  community_id: string;
  builder_id: string;
  plan_key: string;
  name: string;
  price: number | null;
  quick_move_in: boolean;
  record: PlanRecord | null;
  wix_record_id: string | null;
  source_url: string | null;
  updated_at: string;
  fp_sites: { domain: string; name: string } | null;
  fp_communities: { name: string } | null;
  fp_builders: { name: string } | null;
}

/**
 * GET /api/internal/floorplans/campaign
 *
 * The floor plans in the email drip campaign (the tracked, starred plans),
 * each with what the site shows for it, the quick move-ins on offer under
 * it, and its open alerts (Jeff, 2026-09-21).
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("fp_floor_plans")
      .select(
        "id, site_id, community_id, builder_id, plan_key, name, price, quick_move_in, record, wix_record_id, source_url, updated_at, fp_sites:site_id(domain, name), fp_communities:community_id(name), fp_builders:builder_id(name)"
      )
      .eq("starred", true)
      .is("removed_at", null)
      .order("name");
    if (error) throw error;
    const plans = (data ?? []) as unknown as PlanRow[];
    if (!plans.length) return NextResponse.json({ plans: [] });

    const siteIds = [...new Set(plans.map((p) => p.site_id))];
    const [{ data: homes, error: homesError }, { data: alerts, error: alertsError }] = await Promise.all([
      supabase
        .from("fp_floor_plans")
        .select("id, site_id, community_id, builder_id, name, price, record")
        .in("site_id", siteIds)
        .eq("quick_move_in", true)
        .is("removed_at", null),
      supabase
        .from("fp_follow_up_tasks")
        .select("id, floor_plan_id, task_type, detail, created_at")
        .eq("status", "open")
        .in("floor_plan_id", plans.map((p) => p.id))
        .order("created_at", { ascending: false }),
    ]);
    if (homesError) throw homesError;
    if (alertsError) throw alertsError;

    const out = plans.map((p) => {
      const rec = p.record ?? {};
      const own = (homes ?? []).filter(
        (h) =>
          h.site_id === p.site_id &&
          h.community_id === p.community_id &&
          h.builder_id === p.builder_id &&
          ((h.record as PlanRecord | null)?.relatedPlanKey ?? null) === p.plan_key
      );
      return {
        id: p.id,
        name: p.name,
        quickMoveIn: p.quick_move_in,
        site: p.fp_sites?.domain ?? null,
        community: p.fp_communities?.name ?? null,
        builder: p.fp_builders?.name ?? null,
        priceDisplay: rec.priceDisplay ?? null,
        beds: rec.beds ?? "",
        baths: rec.baths ?? "",
        sqft: rec.sqft ?? null,
        garages: rec.garages ?? null,
        homeType: rec.homeType ?? null,
        score: rec.score ?? null,
        image: rec.galleryImages?.[0] ?? rec.primaryImage ?? null,
        urlSlug: rec.urlSlug ?? null,
        sourceUrl: p.source_url,
        virtualTourUrl: rec.virtualTourUrl ?? null,
        relatedPlanName: rec.relatedPlanName ?? null,
        hasQuickMoveIns: p.quick_move_in ? null : own.length > 0 || rec.hasQuickMoveIns === true,
        homes: own.map((h) => ({ id: h.id, name: h.name, priceDisplay: (h.record as PlanRecord | null)?.priceDisplay ?? null })),
        alerts: (alerts ?? []).filter((a) => a.floor_plan_id === p.id),
        updatedAt: p.updated_at,
      };
    });
    return NextResponse.json({ plans: out });
  } catch (error) {
    logger.error("Failed to load the email campaign's floor plans", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
