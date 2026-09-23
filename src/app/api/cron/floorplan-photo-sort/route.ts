import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { sortQueuedPhotos } from "@/lib/floorplans/sort-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sorts the photos of the changes waiting for review by what they show (sort-queue.ts). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await sortQueuedPhotos());
  } catch (error) {
    logger.error("Sorting waiting galleries failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
