import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { authorizeEngineRequest } from "@/lib/listings/auth";
import { selectAll } from "@/lib/listings/db";
import { emptySiteCounts, siteCounts } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/listings/status
 *
 * What the Hub's Listings section will show: the engine switch and state,
 * each site with its listing counts by state, the newest runs, and the
 * newest warn/error events.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  try {
    const [{ data: settings }, { data: sites }, { data: runs }, { data: events }, perSite, villages] = await Promise.all([
      supabase.from("system_settings").select("ls_engine_enabled, ls_engine_state").eq("id", 1).single(),
      supabase.from("ls_sites").select("*").order("domain"),
      supabase.from("ls_sync_runs").select("*").order("started_at", { ascending: false }).limit(24),
      supabase.from("ls_sync_events").select("*").neq("level", "info").order("at", { ascending: false }).limit(50),
      siteCounts(),
      selectAll<{ site_id: string; active: boolean }>("load villages", (from, to) =>
        supabase.from("ls_villages").select("site_id, active").order("id").range(from, to)
      ),
    ]);
    const villagesPerSite = new Map<string, { villages: number; activeVillages: number }>();
    for (const v of villages) {
      const c = villagesPerSite.get(v.site_id) ?? { villages: 0, activeVillages: 0 };
      c.villages += 1;
      if (v.active) c.activeVillages += 1;
      villagesPerSite.set(v.site_id, c);
    }
    const { count: listings } = await supabase.from("ls_listings").select("listing_id", { count: "exact", head: true }).eq("in_feed", true);
    return NextResponse.json({
      engine: settings ?? null,
      listingsInFeed: listings ?? 0,
      sites: (sites ?? []).map((s: Record<string, unknown>) => ({
        ...s,
        counts: perSite.get(s.id as string) ?? emptySiteCounts(),
        ...(villagesPerSite.get(s.id as string) ?? { villages: 0, activeVillages: 0 }),
      })),
      runs: runs ?? [],
      events: events ?? [],
    });
  } catch (error) {
    logger.error("Listings status failed", { error: errorMessage(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
