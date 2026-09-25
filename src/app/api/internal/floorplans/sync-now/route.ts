import { after, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { runNightlyTick, startSync } from "@/lib/floorplans/nightly";

export const dynamic = "force-dynamic";
// The first tick works here, after the answer has gone; the minute cron
// carries the cycle on from there (nightly.ts).
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/sync-now
 *
 * Starts the sync cycle now — every onboarded connection, as the nightly
 * sync does — whatever the hour and whether or not the nightly sync is
 * on (Jeff, 2026-09-25). Answers at once; the cycle goes on without the
 * page, and the Builder Connections page follows it from the settings.
 */
export async function POST() {
  try {
    const state = await startSync();
    if (!state) return NextResponse.json({ error: "A sync is already running" }, { status: 409 });
    after(async () => {
      try {
        await runNightlyTick();
      } catch (error) {
        logger.error("Floor plan sync tick failed", { error: error instanceof Error ? error.message : String(error) });
      }
    });
    return NextResponse.json(state, { status: 202 });
  } catch (error) {
    logger.error("Floor plan sync could not start", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
