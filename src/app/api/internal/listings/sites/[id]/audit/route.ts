import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { auditSite, deleteStaleRows, reimportBrokenPhotos, REIMPORT_FOLDER_BUDGET_MS } from "@/lib/listings/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/internal/listings/sites/:id/audit
 * Read-only: are the engine's photos for the site all in its Media Manager
 * folder, do the collection galleries point anywhere else, and does the
 * collection hold rows the engine does not own?
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    return NextResponse.json(await auditSite(id));
  } catch (error) {
    return engineErrorResponse(error, "Listings site audit failed");
  }
}

/**
 * POST /api/internal/listings/sites/:id/audit
 * Body: { deleteStale: true, collectionId } deletes the rows the engine does
 * not own from the site's target collection (recomputed server-side; any
 * other collection is refused).
 * Body: { reimportBroken: true } clears the engine's record of photos Wix
 * holds no picture for, so the next photo pass imports them again.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    // Bounded, or a folder the size of Parrish's walks past the route's
    // maxDuration and the whole repair comes back a 504.
    if (body?.reimportBroken === true) {
      return NextResponse.json(await reimportBrokenPhotos(id, { deadline: Date.now() + REIMPORT_FOLDER_BUDGET_MS }));
    }
    if (body?.deleteStale !== true || typeof body?.collectionId !== "string") {
      return NextResponse.json({ error: "Body must be { deleteStale: true, collectionId } or { reimportBroken: true }" }, { status: 400 });
    }
    return NextResponse.json(await deleteStaleRows(id, body.collectionId));
  } catch (error) {
    return engineErrorResponse(error, "Listings stale row deletion failed");
  }
}
