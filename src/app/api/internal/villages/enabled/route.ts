import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { setVillageRangesEnabled } from "@/lib/villages/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/villages/enabled
 * Body: { enabled: boolean }
 *
 * The village ranges switch: with it on, each village's price and square
 * footage ranges are rewritten from what is for sale after every floor
 * plan and listings sync and on the two-hourly cron; with it off, nothing
 * is written except from the Update Now button.
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setVillageRangesEnabled(body.enabled));
  } catch (error) {
    return engineErrorResponse(error, "Village ranges switch failed");
  }
}
