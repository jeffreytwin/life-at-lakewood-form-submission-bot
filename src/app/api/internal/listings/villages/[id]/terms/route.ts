import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { addTerm } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/listings/villages/:id/terms
 * Body: { term, street_term?, exclude_term? }
 *
 * A term matches when the MLS subdivision contains it; a street qualifier
 * additionally requires the street text to contain it, and an exclusion
 * takes the match back when the subdivision contains that too (Wellen Park:
 * "preserve" is The Preserve, unless it is Kensington's). One term belongs
 * to one village per site; a clash says which village owns it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await addTerm(id, body), { status: 201 });
  } catch (error) {
    return engineErrorResponse(error, "Listings term add failed");
  }
}
