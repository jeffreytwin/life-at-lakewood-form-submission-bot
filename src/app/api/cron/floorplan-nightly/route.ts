import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { runNightlyTick } from "@/lib/floorplans/nightly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runNightlyTick();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Floor plan nightly tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
