import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { checkAllFlags } from "@/lib/floorplans/qmi-flags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/floorplan-qmi-flags
 *
 * Four times a day: every floor plan row of every site, its "quick
 * move-ins available" flag set to what is filed under it (qmi-flags.ts).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const checks = await checkAllFlags({ reason: "scheduled check" });
    return NextResponse.json(
      checks.map((c) => ({ site: c.site, plans: c.plans, homes: c.homes, found: c.fixes.length, fixed: c.fixed, problems: c.problems.length, error: c.error }))
    );
  } catch (error) {
    logger.error("Quick move-in flag check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
