// Queues a live floor plan for a person's adjustment (adjustment.ts): the
// plan as it stands on the site, as an update for the edit overlay and the
// approval that writes every queued change. One waiting per plan.

import { supabase } from "@/lib/supabase/client";
import { ADJUSTMENT_LABEL, ADJUSTMENT_RUN } from "@/lib/floorplans/adjustment";

export type AdjustOutcome =
  | { ok: true; id: string; created: boolean }
  | { ok: false; status: 404 | 409; error: string };

export async function queueAdjustment(planId: string): Promise<AdjustOutcome> {
  const { data: plan, error } = await supabase
    .from("fp_floor_plans")
    .select("id, site_id, community_id, builder_id, plan_key, wix_record_id, record, removed_at")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  if (!plan || plan.removed_at) return { ok: false, status: 404, error: "No floor plan on the site by that id" };
  if (!plan.wix_record_id) return { ok: false, status: 409, error: "This plan has not been written to the site yet" };

  const scope = { site_id: plan.site_id, community_id: plan.community_id, builder_id: plan.builder_id, plan_key: plan.plan_key };
  const { data: waiting, error: waitingError } = await supabase
    .from("fp_pending_changes")
    .select("id")
    .match({ ...scope, field_changed: ADJUSTMENT_LABEL, status: "pending" })
    .limit(1)
    .maybeSingle();
  if (waitingError) throw waitingError;
  if (waiting) return { ok: true, id: waiting.id, created: false };

  const record: Record<string, unknown> = { ...((plan.record ?? {}) as Record<string, unknown>), planKey: plan.plan_key };
  // The score lives beside the plan too (fp_plan_scores); a record written
  // before scores were kept on it takes it from there, so approving an
  // adjustment is not held back for one.
  if (typeof record.score !== "number") {
    const { data: kept } = await supabase.from("fp_plan_scores").select("score").match(scope).maybeSingle();
    if (typeof kept?.score === "number") record.score = kept.score;
  }

  const now = new Date().toISOString();
  const { data: row, error: insertError } = await supabase
    .from("fp_pending_changes")
    .insert({
      ...scope,
      floor_plan_id: plan.id,
      change_type: "update",
      field_changed: ADJUSTMENT_LABEL,
      old_value: null,
      new_value: null,
      proposed_record: record,
      wix_record_id: plan.wix_record_id,
      run_id: `${ADJUSTMENT_RUN}${now}`,
      status: "pending",
      updated_at: now,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return { ok: true, id: row.id, created: true };
}
