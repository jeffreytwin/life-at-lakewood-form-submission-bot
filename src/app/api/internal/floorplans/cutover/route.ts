import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { generateCutoverReport } from "@/lib/floorplans/cutover";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET: latest report per site. */
export async function GET() {
  try {
    const { data: sites, error } = await supabase
      .from("fp_sites")
      .select("id, domain, name")
      .eq("active", true)
      .order("domain");
    if (error) throw error;
    const results = [];
    for (const site of sites ?? []) {
      const { data: latest } = await supabase
        .from("fp_cutover_reports")
        .select("report, created_at")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      results.push({ ...site, latest: latest ?? null });
    }
    return NextResponse.json(results);
  } catch (error) {
    logger.error("Failed to fetch cutover reports", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST body: { siteId } — generate a fresh report for one site. */
export async function POST(request: NextRequest) {
  try {
    const { siteId } = await request.json();
    if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
    const report = await generateCutoverReport(siteId);
    return NextResponse.json(report);
  } catch (error) {
    logger.error("Failed to generate cutover report", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
