import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { drainApprovals } from "@/lib/floorplans/approvals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Carries on the approvals the person has handed over (approvals.ts):
 * what the worker started by the click left, plans waiting on Wix, and
 * plans whose worker was cut off. Nothing to do costs one read.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await drainApprovals());
  } catch (error) {
    logger.error("Floor plan approval worker failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
