import { NextRequest, NextResponse } from "next/server";
import { fetchPlanViewer, floorSvg } from "@/lib/floorplans/extractors/planviewer";
import { logger } from "@/lib/shared/logger";

/**
 * One floor of a plan in CPS's plan viewer, as an SVG drawing: the address
 * a record keeps for a floor plan the builder shows only inside the viewer
 * (Neal Signature, 2026-09-24; extractors/planviewer.ts). Public, like the
 * viewer's own data, and cached a day: the drawing changes when the
 * builder redraws the plan, not from one visit to the next.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ company: string; plan: string; floor: string }> }
) {
  const { company, plan, floor } = await params;
  const floorId = floor.replace(/\.svg$/i, "");
  if (!/^[a-z0-9_-]{1,40}$/i.test(company) || !/^\d{1,12}$/.test(plan) || !/^[A-Za-z0-9_-]{1,60}$/.test(floorId)) {
    return NextResponse.json({ error: "not a plan viewer floor" }, { status: 400 });
  }
  try {
    const svg = floorSvg(await fetchPlanViewer({ company: company.toLowerCase(), plan }), floorId);
    if (!svg) return NextResponse.json({ error: "no such floor" }, { status: 404 });
    return new NextResponse(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        // A drawing, never a document: nothing in it runs.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (error) {
    logger.warn("Plan viewer floor could not be served", {
      company,
      plan,
      floor: floorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "the plan viewer did not answer" }, { status: 502 });
  }
}
