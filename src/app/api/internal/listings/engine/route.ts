import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { setEngineEnabled } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/listings/engine
 * Body: { enabled: boolean }
 *
 * The engine switch: with it off the cron tick does nothing; with it on
 * the tick runs an incremental every hour and a full verify once a day.
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setEngineEnabled(body.enabled));
  } catch (error) {
    return engineErrorResponse(error, "Listings engine switch failed");
  }
}
