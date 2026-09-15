import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { removeTerm } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/** DELETE /api/internal/listings/villages/:id/terms/:termId */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; termId: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id, termId } = await params;
  try {
    await removeTerm(id, termId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return engineErrorResponse(error, "Listings term remove failed");
  }
}
