import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { createVillage, listVillages } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/** GET /api/internal/listings/villages?siteId= — villages with their terms and listing counts. */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  try {
    return NextResponse.json(await listVillages(siteId));
  } catch (error) {
    return engineErrorResponse(error, "Listings villages failed");
  }
}

/**
 * POST /api/internal/listings/villages
 * Body: { siteId, name, wix_slug?, page_url?, wix_item_id?, tags? }
 *
 * `tags` is { blueTag1?, purpleTag1?, greenTag1? }: the amenity pill images
 * the neighborhood puts on every one of its listing cards.
 *
 * The village page itself lives on the Wix site; this records the name
 * the engine writes, the page it links to, and the row it references.
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await createVillage(body), { status: 201 });
  } catch (error) {
    return engineErrorResponse(error, "Listings village create failed");
  }
}
