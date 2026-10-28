import { after, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { drainApplyAll, queueApplyAll } from "@/lib/school-zones/scan";

export const dynamic = "force-dynamic";
// The writes go on after the answer: two Wix calls a village, spaced to Wix's rate.
export const maxDuration = 800;

/**
 * POST /api/internal/community-alerts/school-zones/apply-all
 *
 * Apply all (Jeff, 2026-10-28): every open school zones alert Apply can
 * write is queued, the answer goes at once (202, how many), and the
 * server writes them whether or not the page that asked stays open. The
 * page follows them by the alerts themselves: each closes as it lands,
 * or keeps its card with why it could not be written. Life At Lakewood's
 * are edited by hand and are not touched.
 */
export async function POST() {
  try {
    const queued = await queueApplyAll();
    if (!queued.ok) return NextResponse.json({ error: queued.error }, { status: queued.status });
    if (!queued.ids.length) return NextResponse.json({ queued: 0 });
    after(async () => {
      try {
        await drainApplyAll(queued.ids);
      } catch (error) {
        logger.error("Apply all school zones failed", { error: describeError(error) });
      }
    });
    return NextResponse.json({ queued: queued.ids.length }, { status: 202 });
  } catch (error) {
    logger.error("Apply all school zones failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
