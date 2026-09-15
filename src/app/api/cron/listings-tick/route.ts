import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { runEngineTick } from "@/lib/listings/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/listings-tick (every 15 minutes, vercel.json)
 *
 * Runs the listings engine when a run is due: an incremental pull every
 * hour, a full verify-by-id once a day after 03:00 UTC. Does nothing while
 * system_settings.ls_engine_enabled is false.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runEngineTick({ trigger: "cron" });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Listings engine tick failed", { error: errorMessage(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
