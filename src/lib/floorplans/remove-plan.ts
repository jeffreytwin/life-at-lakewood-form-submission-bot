// A plan taken off the site from the queue, with its quick move-ins (Jeff,
// 2026-09-29): The Towns at Firethorn sold out, and its one plan, Marigold,
// came through as a price going from $284,999 to nothing. The builder still
// lists the plan, so no run would ever propose its removal; the approver
// removes it instead, and every home built from it with it.
//
// Each goes the way an approved removal goes (writeback.ts): out of Wix,
// marked removed in the Hub. Their pending changes are withdrawn, and a
// rejected addition is left for each, the way a person rejecting it would
// leave one: the next run, still finding the plan listed with no price,
// does not offer it back as a new plan. Once the builder prices it again
// the addition is not the rejected one, and the plan is offered as new.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { applyPendingChange } from "@/lib/floorplans/writeback";
import { runIsGoing } from "@/lib/floorplans/runs";
import type { NormalizedPlan } from "@/lib/floorplans/types";
import { REMOVE_RUN_PREFIX } from "@/lib/floorplans/removal-guards";

export interface RemovedPlan {
  planKey: string;
  name: string;
  quickMoveIn: boolean;
  status: "synced" | "failed" | "deferred";
  error: string | null;
}

export type RemovePlanOutcome =
  | { ok: true; removed: RemovedPlan[] }
  | { ok: false; status: 404 | 409; error: string };

interface FiledRow {
  id: string;
  plan_key: string;
  wix_record_id: string | null;
  record: Partial<NormalizedPlan> | null;
}

/**
 * The homes built from a plan, of those on the site: each names the plan
 * by its key (quick-move-ins.ts). Pure; exported for tests.
 */
export function homesOf(planKey: string, filed: FiledRow[]): FiledRow[] {
  return filed.filter((row) => row.plan_key !== planKey && row.record?.quickMoveIn === true && row.record?.relatedPlanKey === planKey);
}

/**
 * Takes the plan a pending change is for off the site, with the homes
 * built from it. The change must be pending and the plan on the site: a
 * plan never approved is rejected, not removed.
 */
export async function removePlanWithHomes(changeId: string): Promise<RemovePlanOutcome> {
  const { data: change, error } = await supabase
    .from("fp_pending_changes")
    .select("id, status, site_id, community_id, builder_id, plan_key, proposed_record")
    .eq("id", changeId)
    .maybeSingle();
  if (error) throw error;
  if (!change || change.status !== "pending") return { ok: false, status: 409, error: "Change not found or not pending" };
  const scope = { site_id: change.site_id, community_id: change.community_id, builder_id: change.builder_id };

  const { data: connection } = await supabase
    .from("fp_builder_communities")
    .select("id")
    .match({ community_id: scope.community_id, builder_id: scope.builder_id })
    .maybeSingle();
  // A run going on would queue the plan's changes again behind the removal.
  if (connection && (await runIsGoing(connection.id))) {
    return { ok: false, status: 409, error: "This connection is running; remove the plan once the run has finished." };
  }

  const { data: filedRows, error: filedError } = await supabase
    .from("fp_floor_plans")
    .select("id, plan_key, wix_record_id, record")
    .match(scope)
    .is("removed_at", null);
  if (filedError) throw filedError;
  const filed = (filedRows ?? []) as FiledRow[];
  const plan = filed.find((row) => row.plan_key === change.plan_key);
  if (!plan) return { ok: false, status: 409, error: "This plan is not on the site; reject it instead." };
  const targets = [plan, ...(plan.record?.quickMoveIn ? [] : homesOf(plan.plan_key, filed))];
  const keys = targets.map((t) => t.plan_key);

  const { data: writing } = await supabase
    .from("fp_pending_changes")
    .select("id")
    .match(scope)
    .in("plan_key", keys)
    .eq("status", "approving")
    .limit(1);
  if (writing?.length) return { ok: false, status: 409, error: "A change to this plan is being written; try again once it is done." };

  // What the queue proposed for these plans is moot once they are gone.
  const { error: withdrawError } = await supabase
    .from("fp_pending_changes")
    .delete()
    .match(scope)
    .in("plan_key", keys)
    .in("status", ["pending", "failed"]);
  if (withdrawError) throw withdrawError;

  const runId = `${REMOVE_RUN_PREFIX}${Date.now()}`;
  const now = () => new Date().toISOString();
  const removed: RemovedPlan[] = [];
  for (const target of targets) {
    const record = (target.plan_key === change.plan_key && change.proposed_record ? change.proposed_record : target.record) as Partial<NormalizedPlan> | null;
    const name = target.record?.name ?? target.plan_key;
    const quickMoveIn = target.record?.quickMoveIn === true;
    const row = {
      ...scope,
      floor_plan_id: target.id,
      plan_key: target.plan_key,
      change_type: "remove",
      field_changed: null,
      old_value: target.record?.priceDisplay ?? null,
      new_value: null,
      proposed_record: null,
      wix_record_id: target.wix_record_id,
      run_id: runId,
      updated_at: now(),
    };
    let status: RemovedPlan["status"] = "synced";
    let failure: string | null = null;
    if (target.wix_record_id) {
      const { data: inserted, error: insertError } = await supabase
        .from("fp_pending_changes")
        .insert({ ...row, status: "approved" })
        .select("id")
        .single();
      if (insertError) throw insertError;
      const result = await applyPendingChange(inserted.id);
      if (result.throttled) {
        // Wix is refusing everyone: the removal waits in the queue to be approved again.
        await supabase.from("fp_pending_changes").update({ status: "pending", updated_at: now() }).eq("id", inserted.id);
        status = "deferred";
        failure = result.error ?? "Wix is busy";
      } else if (result.status !== "synced") {
        status = "failed";
        failure = result.error ?? result.status;
      }
    } else {
      // In the Hub but never written to Wix: nothing to take down there.
      await supabase.from("fp_floor_plans").update({ removed_at: now(), updated_at: now() }).eq("id", target.id);
      const { error: insertError } = await supabase.from("fp_pending_changes").insert({ ...row, status: "synced" });
      if (insertError) throw insertError;
    }
    if (status === "synced") {
      // Rejected as a person would reject it, so the next run does not offer it back as it stands.
      const { error: guardError } = await supabase.from("fp_pending_changes").insert({
        ...scope,
        plan_key: target.plan_key,
        change_type: "add",
        field_changed: null,
        old_value: null,
        new_value: record?.priceDisplay || null,
        proposed_record: record,
        run_id: runId,
        status: "rejected",
        updated_at: now(),
      });
      if (guardError) logger.warn("A removed plan's rejection could not be recorded", { planKey: target.plan_key, error: guardError.message });
    }
    removed.push({ planKey: target.plan_key, name, quickMoveIn, status, error: failure });
  }
  logger.info("Plan removed from the queue with its homes", {
    changeId,
    removed: removed.map((r) => `${r.planKey}: ${r.status}`),
  });
  return { ok: true, removed };
}
