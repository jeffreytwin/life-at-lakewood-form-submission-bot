import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { clearConnection } from "@/lib/floorplans/connection-clear";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/connections/:id/reset
 *
 * Takes a connection back to before its first run, so a builder can be
 * onboarded again from scratch once its extractor has changed (Jeff,
 * 2026-09-19: "remove every floor plan we have in here and try again").
 * Everything the connection put on the site and in the Hub goes
 * (connection-clear.ts), and its run history is cleared, so the next Run
 * tests the whole path from the builder's site: fetch, render, import,
 * verify.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const outcome = await clearConnection(id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const { error: connError } = await supabase
      .from("fp_builder_communities")
      .update({
        last_run_at: null,
        last_run_status: "reset — run again to onboard",
        last_plan_count: null,
        consecutive_failures: 0,
        onboarded_at: null,
        attention_dismissed_at: null,
      })
      .eq("id", id);
    if (connError) throw connError;
    logger.info("Floor plan connection reset", { connectionId: id, ...outcome.result });
    return NextResponse.json(outcome.result);
  } catch (error) {
    logger.error("Failed to reset builder connection", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
