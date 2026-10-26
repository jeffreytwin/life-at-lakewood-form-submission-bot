import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { syncVillageRanges, VILLAGE_RANGE_TARGETS } from "@/lib/villages/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/internal/villages/ranges?domain=lifeatlakewood.com
 *
 * The preview: what a run would write to each site's villages collection
 * (every item whose range moved, before and after), what it would leave,
 * and the villages it has nothing to write to. Reads Wix, writes nothing;
 * works whether or not the switch is on.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  try {
    const domain = request.nextUrl.searchParams.get("domain") ?? undefined;
    const [{ data: settings }, results] = await Promise.all([
      supabase.from("system_settings").select("village_ranges_enabled, village_ranges_state").eq("id", 1).single(),
      syncVillageRanges({ domain, dryRun: true, trigger: "preview" }),
    ]);
    return NextResponse.json({
      enabled: settings?.village_ranges_enabled ?? false,
      state: settings?.village_ranges_state ?? {},
      targets: VILLAGE_RANGE_TARGETS,
      results,
    });
  } catch (error) {
    return engineErrorResponse(error, "Village ranges preview failed");
  }
}

/**
 * POST /api/internal/villages/ranges
 * Body: { domain?: string }
 *
 * Runs the sync now, for one site or all, whether or not the switch is on:
 * a person asking is the approval.
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { domain?: unknown };
    const domain = typeof body.domain === "string" && body.domain ? body.domain : undefined;
    const results = await syncVillageRanges({ domain, trigger: "manual" });
    return NextResponse.json({ results });
  } catch (error) {
    return engineErrorResponse(error, "Village ranges run failed");
  }
}
