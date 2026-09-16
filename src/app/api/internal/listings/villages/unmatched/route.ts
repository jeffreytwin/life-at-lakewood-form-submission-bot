import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { listUnmatchedListings } from "@/lib/listings/unmatched";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/listings/villages/unmatched?siteId=
 * The Active, for-sale listings in the site's market that match no
 * neighborhood term, grouped by subdivision: what the site is ruling out,
 * so a missing term can be spotted and added.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  try {
    return NextResponse.json(await listUnmatchedListings(siteId));
  } catch (error) {
    return engineErrorResponse(error, "Listings unmatched failed");
  }
}
