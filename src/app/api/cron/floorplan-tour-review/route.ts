import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { runTourReview } from "@/lib/floorplans/tour-review";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/floorplan-tour-review
 *
 * Once a week: every floor plan's virtual tour looked at, and each one that
 * looks wrong put in the review queue as a proposal to take it off the
 * site (tour-review.ts; Jeff, 2026-10-02).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runTourReview());
  } catch (error) {
    logger.error("Tour review failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
