import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { troubledConnections, type BuilderHealthInput } from "@/lib/floorplans/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/floorplans/connections/troubled
 *
 * The builder connections whose last run failed and nobody has dismissed
 * — the same set the Floor Plans banner shows, without the whole builders
 * list behind it. The sidebar badge and the alert monitor poll this
 * (Jeff, 2026-09-22: a failing connection should be a number on the menu
 * and the character should say so, like the other alerts).
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("fp_builders")
      .select(
        "name, active, fp_builder_communities(id, active, last_run_at, last_run_status, consecutive_failures, attention_dismissed_at, fp_communities:community_id(name, fp_sites:site_id(domain)))"
      )
      .order("name");
    if (error) throw error;
    const connections = troubledConnections((data ?? []) as unknown as BuilderHealthInput[]);
    return NextResponse.json({ count: connections.length, connections });
  } catch (error) {
    logger.error("Failed to fetch troubled builder connections", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
