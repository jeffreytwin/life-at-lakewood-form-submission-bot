import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { setSiteWriteMode } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/internal/listings/sites/:id
 * Body: { write_mode: "paused" | "shadow" }
 *
 * Pausing a site is inert: runs still pull and classify for it, but write
 * nothing to its collection until it is resumed. Cutover to live is not
 * done here.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setSiteWriteMode(id, body.write_mode));
  } catch (error) {
    return engineErrorResponse(error, "Listings site update failed");
  }
}
