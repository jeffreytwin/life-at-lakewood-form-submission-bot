import { after, NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { holdRun, runHeld } from "@/lib/floorplans/runs";

export const dynamic = "force-dynamic";
// Extractors that read one page per plan (Toll Brothers) take a minute or
// two for a community; same ceiling as the nightly tick. The run goes on
// after the answer has gone, within the same ceiling.
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/connections/:id/run
 *
 * Runs one builder×community connection on demand: extract from the
 * builder's site, diff against canonical plans, queue pending changes.
 * This is the builder-onboarding path — validate one builder at a time
 * before the nightly loop takes it over.
 *
 * It answers as soon as the run has started, and the run carries on
 * whether or not the page that asked is still open (Jeff, 2026-09-25):
 * the Builder Connections page follows it from the connection's
 * run_started_at, and reads the result from its last run status.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    if (!(await holdRun(id))) {
      return NextResponse.json({ status: "running", detail: "this connection is already running" }, { status: 409 });
    }
    after(() => runHeld(id).then(() => undefined));
    return NextResponse.json({ status: "started" }, { status: 202 });
  } catch (error) {
    logger.error("Connection run failed to start", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
