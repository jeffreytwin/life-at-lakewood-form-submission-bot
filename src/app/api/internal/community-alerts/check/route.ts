import { NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { checkSoldOuts } from "@/lib/community-alerts/sold-out";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/internal/community-alerts/check: the Check now button, the same check the cron runs. */
export async function POST() {
  try {
    return NextResponse.json(await checkSoldOuts());
  } catch (error) {
    logger.error("Community alert check failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
