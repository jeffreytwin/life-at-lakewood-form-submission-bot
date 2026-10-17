import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { runChecks } from "@/lib/community-alerts/checks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/community-scan
 *
 * Once a day: reads each site's home finder (or, for Parrish, the MLS's
 * new-construction listings) and raises an alert for each neighborhood
 * with homes for sale that neither engine has; then every other check
 * (new-neighborhoods.ts, checks.ts).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runChecks({ scan: true }));
  } catch (error) {
    logger.error("Community alert scan failed", { error: describeError(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
