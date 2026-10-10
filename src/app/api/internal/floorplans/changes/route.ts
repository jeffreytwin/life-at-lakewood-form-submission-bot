import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { forTheList } from "@/lib/floorplans/queue-list";

export const dynamic = "force-dynamic";

/** The rows one request brings back at most; Supabase answers no more than this per request. */
const PAGE = 1000;
/** The whole queue, however long, and no more than this of any other list. */
const MOST = 5000;

const COLUMNS =
  "*, fp_sites:site_id(domain, name), fp_communities:community_id(name), fp_builders:builder_id(name), fp_floor_plans:floor_plan_id(id, starred)";

type RowQuery = ReturnType<ReturnType<typeof supabase.from>["select"]>;

/** How many plans the rows this filter leaves stand for: a plan is one row per changed field. */
async function countPlans(filter: (q: RowQuery) => RowQuery): Promise<number> {
  const keys = new Set<string>();
  for (let from = 0; from < MOST; from += PAGE) {
    const { data, error } = await filter(
      supabase.from("fp_pending_changes").select("site_id, community_id, builder_id, plan_key")
    )
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as { site_id: string; community_id: string; builder_id: string; plan_key: string }[];
    for (const c of rows) keys.add(`${c.site_id}|${c.community_id}|${c.builder_id}|${c.plan_key}`);
    if (rows.length < PAGE) break;
  }
  return keys.size;
}

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

    // Just the number of plans waiting for a person, for the menu's badge:
    // one approved and still being written is theirs no longer (Jeff, 2026-10-10).
    if (searchParams.get("count") === "plans") {
      return NextResponse.json({ plans: await countPlans((q) => q.eq("status", "pending")) });
    }

    // Just the number of plans a person approved that the approval worker
    // is still writing (approvals.ts): handed over, or claimed and being
    // written. Shown under every page's title until it is none (Jeff,
    // 2026-10-10). What the sync approves on its own is not counted.
    if (searchParams.get("count") === "writing") {
      return NextResponse.json({
        plans: await countPlans((q) => q.or("status.eq.approving,and(status.eq.approved,approval_requested_at.not.is.null)")),
      });
    }

    // Just these rows, whatever their status: the page asks how an Approve
    // All write that left the pending list ended, before it plays the
    // plan's way out as approved or quietly (Jeff, 2026-09-30).
    const ids = (searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length) {
      if (ids.length > 200) return NextResponse.json({ error: "at most 200 ids" }, { status: 400 });
      const { data, error } = await supabase.from("fp_pending_changes").select("id, status").in("id", ids);
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    const rows: unknown[] = [];
    for (let from = 0; from < limit; from += PAGE) {
      // A plan approved and still being written is the person's no longer,
      // so the pending list leaves it out (Jeff, 2026-10-10: it "makes it
      // feel unfinished"); the note under the page's title counts it.
      let query = supabase
        .from("fp_pending_changes")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, Math.min(from + PAGE, limit) - 1);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []).map(forTheList));
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
