import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { authorizeEngineRequest } from "@/lib/listings/auth";
import { selectAll } from "@/lib/listings/db";

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
    const [{ data: settings }, { data: sites }, { data: runs }, { data: events }, stateRows] = await Promise.all([
      supabase.from("system_settings").select("ls_engine_enabled, ls_engine_state").eq("id", 1).single(),
      supabase.from("ls_sites").select("*").order("domain"),
      supabase.from("ls_sync_runs").select("*").order("started_at", { ascending: false }).limit(24),
      supabase.from("ls_sync_events").select("*").neq("level", "info").order("at", { ascending: false }).limit(50),
      selectAll<{ site_id: string; state: string; gallery_ready: boolean; needs_write: boolean }>("load site listing states", (from, to) =>
        supabase.from("ls_site_listings").select("site_id, state, gallery_ready, needs_write").order("id").range(from, to)
      ),
    ]);
    const perSite = new Map<string, Record<string, number>>();
    for (const row of stateRows) {
      const c = perSite.get(row.site_id) ?? { staged: 0, live: 0, removed: 0, galleryPending: 0, needsWrite: 0 };
      c[row.state] = (c[row.state] ?? 0) + 1;
      if (row.state !== "removed" && !row.gallery_ready) c.galleryPending += 1;
      if (row.needs_write) c.needsWrite += 1;
      perSite.set(row.site_id, c);
    }
    const { count: listings } = await supabase.from("ls_listings").select("listing_id", { count: "exact", head: true }).eq("in_feed", true);
    return NextResponse.json({
      engine: settings ?? null,
      listingsInFeed: listings ?? 0,
      sites: (sites ?? []).map((s: Record<string, unknown>) => ({ ...s, counts: perSite.get(s.id as string) ?? { staged: 0, live: 0, removed: 0, galleryPending: 0, needsWrite: 0 } })),
      runs: runs ?? [],
      events: events ?? [],
    });
  } catch (error) {
    logger.error("Listings status failed", { error: errorMessage(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
