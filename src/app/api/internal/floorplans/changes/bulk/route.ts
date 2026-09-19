import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { applyPendingChange } from "@/lib/floorplans/writeback";
import { groupChanges } from "@/lib/floorplans/group-changes";
import { approvalBlocker } from "@/lib/floorplans/approval";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/changes/bulk
 * Body: { action: "approve" | "reject", ids: string[] }
 *
 * Approves or rejects a set of pending rows together, which is how the Hub
 * acts on a plan: the sync core queues one row per changed field, so a plan
 * with a new price, new photos and a new description is three rows. The rows
 * of one plan carry the same proposed record, so approving writes the plan
 * to Wix once, through the group's lead row, and gives every row of that
 * plan the same outcome. A plan that cannot be approved yet (a base plan
 * without a score, approval.ts) stays pending and comes back as "blocked";
 * 409 when nothing could be approved at all.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const ids: unknown = body?.ids;
    if (
      (action !== "approve" && action !== "reject") ||
      !Array.isArray(ids) || !ids.length || ids.length > 200 ||
      !ids.every((id) => typeof id === "string")
    ) {
      return NextResponse.json({ error: "action (approve|reject) and ids (string[]) are required" }, { status: 400 });
    }
    const now = new Date().toISOString();

    if (action === "reject") {
      const { data, error } = await supabase
        .from("fp_pending_changes")
        .update({ status: "rejected", updated_at: now })
        .in("id", ids)
        .eq("status", "pending")
        .select("id");
      if (error) throw error;
      return NextResponse.json({ rejected: data?.length ?? 0 });
    }

    const { data: rows, error: loadError } = await supabase
      .from("fp_pending_changes")
      .select("id, site_id, community_id, builder_id, plan_key, change_type, status, created_at, updated_at, proposed_record")
      .in("id", ids)
      .eq("status", "pending");
    if (loadError) throw loadError;
    if (!rows?.length) return NextResponse.json({ results: [] });

    const results: { planKey: string; rows: number; status: string; error: string | null }[] = [];
    const approvable: ReturnType<typeof groupChanges<(typeof rows)[number]>> = [];
    for (const group of groupChanges(rows)) {
      const blocker = approvalBlocker(group.lead.change_type, group.lead.proposed_record);
      if (blocker) results.push({ planKey: group.lead.plan_key, rows: group.rows.length, status: "blocked", error: blocker });
      else approvable.push(group);
    }
    if (!approvable.length) return NextResponse.json({ results }, { status: 409 });

    const { error: approveError } = await supabase
      .from("fp_pending_changes")
      .update({ status: "approved", updated_at: now })
      .in("id", approvable.flatMap((g) => g.rows.map((r) => r.id)))
      .eq("status", "pending");
    if (approveError) throw approveError;

    for (const group of approvable) {
      const outcome = await applyPendingChange(group.lead.id);
      const rest = group.rows.filter((r) => r.id !== group.lead.id);
      if (rest.length) {
        const { data: applied } = await supabase
          .from("fp_pending_changes")
          .select("wix_record_id, floor_plan_id, error_detail")
          .eq("id", group.lead.id)
          .single();
        const { error: restError } = await supabase
          .from("fp_pending_changes")
          .update({
            status: outcome.status,
            wix_record_id: applied?.wix_record_id ?? null,
            floor_plan_id: applied?.floor_plan_id ?? null,
            error_detail: applied?.error_detail ?? null,
            updated_at: new Date().toISOString(),
          })
          .in("id", rest.map((r) => r.id));
        if (restError) throw restError;
      }
      results.push({ planKey: group.lead.plan_key, rows: group.rows.length, status: outcome.status, error: outcome.error ?? null });
    }
    const failed = results.some((r) => r.status === "failed");
    return NextResponse.json({ results }, { status: failed ? 502 : 200 });
  } catch (error) {
    logger.error("Bulk floor plan change action failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
