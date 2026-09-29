import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { removePlanWithHomes } from "@/lib/floorplans/remove-plan";
import { describeError } from "@/lib/shared/describe-error";

export const dynamic = "force-dynamic";
// Each item leaves Wix one at a time.
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/changes/:id/remove-plan
 *
 * Takes the plan a pending change is for off the site, with the quick
 * move-ins built from it, and withdraws their queued changes: a community
 * that sold out whose builder still lists the plan with no price (The Towns
 * at Firethorn's Marigold, Jeff 2026-09-29). See remove-plan.ts.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const outcome = await removePlanWithHomes(id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const failed = outcome.removed.some((r) => r.status === "failed");
    return NextResponse.json({ removed: outcome.removed }, { status: failed ? 502 : 200 });
  } catch (error) {
    const why = describeError(error);
    logger.error("Failed to remove a plan from the queue", { id, error: why });
    return NextResponse.json({ error: why }, { status: 500 });
  }
}
