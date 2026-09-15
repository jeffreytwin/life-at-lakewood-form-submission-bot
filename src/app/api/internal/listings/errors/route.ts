import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { dismissErrors, listOpenErrors } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/listings/errors?limit=
 *
 * Error events nobody has dismissed, newest first, with their total; the
 * sidebar badge asks with limit=0 for the count alone.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  try {
    return NextResponse.json(await listOpenErrors(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    return engineErrorResponse(error, "Listings errors failed");
  }
}

/**
 * POST /api/internal/listings/errors
 * Body: { ids: string[] } or { all: true }
 *
 * Dismisses errors from the overview's Errors panel. They stay in the
 * Change Log, marked dismissed.
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await dismissErrors(body));
  } catch (error) {
    return engineErrorResponse(error, "Listings error dismissal failed");
  }
}
