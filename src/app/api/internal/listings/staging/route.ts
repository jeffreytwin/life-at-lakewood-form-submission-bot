import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { listStagedListings } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/** GET /api/internal/listings/staging?siteId= — a site's staging area, with what each listing waits on. */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  try {
    return NextResponse.json(await listStagedListings(siteId));
  } catch (error) {
    return engineErrorResponse(error, "Listings staging failed");
  }
}
