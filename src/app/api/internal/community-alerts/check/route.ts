import { NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { runChecks } from "@/lib/community-alerts/checks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/internal/community-alerts/check: the Check now button: every check, the new-neighborhood scan included. */
export async function POST() {
  try {
    return NextResponse.json(await runChecks({ scan: true }));
  } catch (error) {
    logger.error("Community alert check failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
