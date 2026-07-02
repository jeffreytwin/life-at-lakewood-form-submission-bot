import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("fp_builders")
      .select(
        "id, name, base_url, extraction_method, audit_notes, active, fp_builder_communities(id, active, last_run_at, last_run_status, last_plan_count, consecutive_failures, fp_communities:community_id(name, fp_sites:site_id(domain)))"
      )
      .order("name");
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    logger.error("Failed to fetch floor plan builders", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
