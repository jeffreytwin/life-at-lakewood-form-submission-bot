import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { releaseStaleApproving } from "@/lib/floorplans/approving";

export const dynamic = "force-dynamic";

/** The rows one request brings back at most; Supabase answers no more than this per request. */
const PAGE = 1000;
/** The whole queue, however long, and no more than this of any other list. */
const MOST = 5000;

const COLUMNS =
  "*, fp_sites:site_id(domain, name), fp_communities:community_id(name), fp_builders:builder_id(name), fp_floor_plans:floor_plan_id(id, starred)";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? "pending";
    // The pending queue comes back whole: shown two hundred rows at a time,
    // the newest first, D.R. Horton's twenty Star Farms plans were queued a
    // minute before their forty-five homes and never shown, while the homes
    // said which plans they were filed under (Jeff, 2026-09-26). Other
    // lists keep a limit.
    const asked = parseInt(searchParams.get("limit") ?? "", 10);
    const limit = status === "pending" ? MOST : Math.min(Number.isFinite(asked) && asked > 0 ? asked : 200, MOST);
    if (status === "pending") await releaseStaleApproving();

    // Just the number of plans waiting, for the menu's badge.
    if (searchParams.get("count") === "plans") {
      const keys = new Set<string>();
      for (let from = 0; from < MOST; from += PAGE) {
        const { data, error } = await supabase
          .from("fp_pending_changes")
          .select("site_id, community_id, builder_id, plan_key")
          .in("status", ["pending", "approving"])
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const c of data ?? []) keys.add(`${c.site_id}|${c.community_id}|${c.builder_id}|${c.plan_key}`);
        if ((data ?? []).length < PAGE) break;
      }
      return NextResponse.json({ plans: keys.size });
    }

    const rows: unknown[] = [];
    for (let from = 0; from < limit; from += PAGE) {
      // A row being approved is still the queue's: shown locked until the write
      // lands, or released above when the request writing it died (approving.ts).
      let query = supabase
        .from("fp_pending_changes")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, Math.min(from + PAGE, limit) - 1);
      if (status === "pending") query = query.in("status", ["pending", "approving"]);
      else if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < Math.min(PAGE, limit - from)) break;
    }
    return NextResponse.json(rows);
  } catch (error) {
    logger.error("Failed to fetch floor plan changes", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
