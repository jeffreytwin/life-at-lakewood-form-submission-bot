import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { checkSoldOuts } from "@/lib/community-alerts/sold-out";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/community-alerts
 *
 * Twice an hour: raises a sold-out alert for each new-build community that
 * has just run out of inventory, and re-checks the open alerts' items the
 * Hub can verify for itself (sold-out.ts).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await checkSoldOuts());
  } catch (error) {
    logger.error("Community alert check failed", { error: describeError(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
