import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { auditSite, deleteStaleRows } from "@/lib/listings/audit";

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
 * Body: { deleteStale: true, collectionId }
 * Deletes the rows the engine does not own from the site's target collection
 * (recomputed server-side; any other collection is refused).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.deleteStale !== true || typeof body?.collectionId !== "string") {
      return NextResponse.json({ error: "Body must be { deleteStale: true, collectionId }" }, { status: 400 });
    }
    return NextResponse.json(await deleteStaleRows(id, body.collectionId));
  } catch (error) {
    return engineErrorResponse(error, "Listings stale row deletion failed");
  }
}
