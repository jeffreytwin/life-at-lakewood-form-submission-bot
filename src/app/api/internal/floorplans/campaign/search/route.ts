import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/floorplans/campaign/search?q=lori
 *
 * Live floor plans by name, for adding one to the email drip campaign:
 * those not tracked yet, with where each one is, since builders share
 * plan names.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ plans: [] });
  try {
    const { data, error } = await supabase
      .from("fp_floor_plans")
      .select(
        "id, name, quick_move_in, starred, record, fp_sites:site_id(domain), fp_communities:community_id(name), fp_builders:builder_id(name)"
      )
      .is("removed_at", null)
      .ilike("name", `%${q.replace(/[%_]/g, "")}%`)
      .order("name")
      .limit(30);
    if (error) throw error;
    const plans = (data ?? []).map((p) => {
      const rec = (p.record ?? {}) as { priceDisplay?: string | null };
      const site = p.fp_sites as unknown as { domain: string } | null;
      const community = p.fp_communities as unknown as { name: string } | null;
      const builder = p.fp_builders as unknown as { name: string } | null;
      return {
        id: p.id,
        name: p.name,
        quickMoveIn: p.quick_move_in,
        tracked: p.starred,
        priceDisplay: rec.priceDisplay ?? null,
        site: site?.domain ?? null,
        community: community?.name ?? null,
        builder: builder?.name ?? null,
      };
    });
    return NextResponse.json({ plans });
  } catch (error) {
    logger.error("Floor plan search failed", { q, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
