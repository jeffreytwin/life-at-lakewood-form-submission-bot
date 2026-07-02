import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { promoteSyncedDrafts } from "@/lib/floorplans/publish-detect";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await promoteSyncedDrafts();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Floor plan publish check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
