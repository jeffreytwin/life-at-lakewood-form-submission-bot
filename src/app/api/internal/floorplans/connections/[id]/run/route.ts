import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { runConnection } from "@/lib/floorplans/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/internal/floorplans/connections/:id/run
 *
 * Runs one builder×community connection on demand: extract from the
 * builder's site, diff against canonical plans, queue pending changes.
 * This is the builder-onboarding path — validate one builder at a time
 * before the nightly loop takes it over.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await runConnection(id);
    return NextResponse.json(result, {
      status: result.status === "failed" ? 502 : 200,
    });
  } catch (error) {
    logger.error("Connection run failed", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
