import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { deleteVillage, updateVillage } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/** PATCH /api/internal/listings/villages/:id — Body: { name?, wix_slug?, page_url?, wix_item_id?, active? } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await updateVillage(id, body));
  } catch (error) {
    return engineErrorResponse(error, "Listings village update failed");
  }
}

/** DELETE /api/internal/listings/villages/:id — only a village with no staged or live listings. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteVillage(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return engineErrorResponse(error, "Listings village delete failed");
  }
}
