import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? "pending";
    const limit = parseInt(searchParams.get("limit") ?? "200", 10);

    let query = supabase
      .from("fp_pending_changes")
      .select(
        "*, fp_sites:site_id(domain, name), fp_communities:community_id(name), fp_builders:builder_id(name)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status !== "all") query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    logger.error("Failed to fetch floor plan changes", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
