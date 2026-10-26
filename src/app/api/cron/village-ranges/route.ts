import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { refreshVillageRanges } from "@/lib/villages/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/village-ranges (every two hours, vercel.json)
 *
 * The safety net behind the hooks at the end of the floor plan and
 * listings syncs: recomputes each village's price and square footage
 * ranges from what is for sale and writes the ones that moved. Does
 * nothing while system_settings.village_ranges_enabled is false.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await refreshVillageRanges("cron"));
  } catch (error) {
    logger.error("Village ranges cron failed", { error: errorMessage(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
