import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { listEvents } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/listings/events?siteId=&level=&kind=&listingId=&runKey=&limit=
 *
 * Newest first. listingId matches as a substring, so a lookup by MLS id
 * works with or without the MFR prefix.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const q = request.nextUrl.searchParams;
  const limit = Number.parseInt(q.get("limit") ?? "", 10);
  try {
    const events = await listEvents({
      siteId: q.get("siteId") ?? undefined,
      level: q.get("level") ?? undefined,
      kind: q.get("kind") ?? undefined,
      listingId: q.get("listingId") ?? undefined,
      runKey: q.get("runKey") ?? undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json(events);
  } catch (error) {
    return engineErrorResponse(error, "Listings events failed");
  }
}
