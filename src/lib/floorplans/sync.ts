// Sync core: runs one builder×community connection — extract, guard, diff
// against canonical plans, and queue pending changes. Used by the manual
// "Run scraper" button during builder onboarding and by the nightly loop.
//
// Guardrails enforced here:
// - Zero-result scrapes are failures: no diff, no removals, failure counted.
// - Removals require the plan to have been missing across runs (last_seen_at
//   older than 24h) AND a scrape covering >= 60% of the last known count.
// - Rejections stick: a change identical to a rejected row is not re-queued.
// - User-edited fields (manual overrides) are never proposed for reversion.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { type NormalizedPlan } from "@/lib/floorplans/types";
import { extractTollBrothers } from "@/lib/floorplans/extractors/toll-brothers";

type Extractor = (params: Record<string, unknown>) => Promise<NormalizedPlan[]>;

// Engine registry: builder name -> extractor. Grows as builders onboard.
const EXTRACTORS: Record<string, Extractor> = {
  "Toll Brothers": extractTollBrothers,
};

interface RunResult {
  status: "ok" | "failed" | "skipped";
  detail: string;
  plans?: number;
  queued?: number;
}

// Fields diffed for updates: canonical record key -> display label.
const DIFF_FIELDS: [keyof NormalizedPlan, string][] = [
  ["priceDisplay", "price"],
  ["name", "name"],
  ["beds", "beds"],
  ["baths", "baths"],
  ["sqft", "sqft"],
  ["garages", "garages"],
  ["quickMoveIn", "quick move-in"],
];

async function setRunStatus(
  connectionId: string,
  status: string,
  planCount: number | null,
  failed: boolean
) {
  const updates: Record<string, unknown> = {
    last_run_at: new Date().toISOString(),
    last_run_status: status.slice(0, 300),
  };
  if (planCount != null) updates.last_plan_count = planCount;
  if (failed) {
    const { data } = await supabase
      .from("fp_builder_communities")
      .select("consecutive_failures")
      .eq("id", connectionId)
      .single();
    updates.consecutive_failures = (data?.consecutive_failures ?? 0) + 1;
  } else {
    updates.consecutive_failures = 0;
  }
  await supabase.from("fp_builder_communities").update(updates).eq("id", connectionId);
}

/** Queue one change unless an identical one was rejected or already pending. */
async function queueChange(args: {
  siteId: string;
  communityId: string;
  builderId: string;
  planKey: string;
  changeType: "add" | "update" | "remove";
  fieldChanged?: string;
  oldValue?: string | null;
  newValue?: string | null;
  proposedRecord?: NormalizedPlan | null;
  wixRecordId?: string | null;
  floorPlanId?: string | null;
  runId: string;
}): Promise<boolean> {
  const fieldKey = args.fieldChanged ?? null;

  // Rejections stick: an identical rejected change suppresses re-queueing.
  // Identical = same plan + change type + field + proposed new value.
  let rejectedQuery = supabase
    .from("fp_pending_changes")
    .select("id")
    .eq("site_id", args.siteId)
    .eq("community_id", args.communityId)
    .eq("builder_id", args.builderId)
    .eq("plan_key", args.planKey)
    .eq("change_type", args.changeType)
    .eq("status", "rejected")
    .limit(1);
  rejectedQuery = fieldKey === null
    ? rejectedQuery.is("field_changed", null)
    : rejectedQuery.eq("field_changed", fieldKey);
  rejectedQuery = args.newValue == null
    ? rejectedQuery.is("new_value", null)
    : rejectedQuery.eq("new_value", args.newValue);
  const { data: rejected } = await rejectedQuery;
  if ((rejected ?? []).length > 0) return false;

  // Dedupe against an existing pending row for the same logical change.
  let pendingQuery = supabase
    .from("fp_pending_changes")
    .select("id")
    .eq("site_id", args.siteId)
    .eq("community_id", args.communityId)
    .eq("builder_id", args.builderId)
    .eq("plan_key", args.planKey)
    .eq("status", "pending");
  pendingQuery = fieldKey === null
    ? pendingQuery.is("field_changed", null)
    : pendingQuery.eq("field_changed", fieldKey);
  const { data: existing } = await pendingQuery.maybeSingle();

  const row = {
    site_id: args.siteId,
    community_id: args.communityId,
    builder_id: args.builderId,
    floor_plan_id: args.floorPlanId ?? null,
    plan_key: args.planKey,
    change_type: args.changeType,
    field_changed: fieldKey,
    old_value: args.oldValue ?? null,
    new_value: args.newValue ?? null,
    proposed_record: args.proposedRecord ?? null,
    wix_record_id: args.wixRecordId ?? null,
    run_id: args.runId,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await supabase.from("fp_pending_changes").update(row).eq("id", existing.id);
  } else {
    const { error } = await supabase.from("fp_pending_changes").insert(row);
    if (error) throw new Error(`queue insert: ${error.message}`);
  }
  return true;
}

export async function runConnection(connectionId: string): Promise<RunResult> {
  const { data: conn, error } = await supabase
    .from("fp_builder_communities")
    .select(
      "id, active, extractor_params, last_plan_count, fp_builders:builder_id(id, name, active, extraction_method), fp_communities:community_id(id, name, site_id, fp_sites:site_id(id, domain))"
    )
    .eq("id", connectionId)
    .single();
  if (error || !conn) return { status: "failed", detail: error?.message ?? "connection not found" };

  const builder = conn.fp_builders as unknown as {
    id: string; name: string; active: boolean; extraction_method: string | null;
  };
  const community = conn.fp_communities as unknown as {
    id: string; name: string; fp_sites: { id: string; domain: string };
  };
  const site = community.fp_sites;

  if (!conn.active || !builder.active) {
    return { status: "skipped", detail: "connection or builder is paused" };
  }
  const extractor = EXTRACTORS[builder.name];
  if (!extractor) {
    await setRunStatus(conn.id, "no extractor implemented yet", null, true);
    return { status: "failed", detail: `no extractor implemented for ${builder.name}` };
  }

  const runId = `manual-${Date.now()}`;
  let plans: NormalizedPlan[];
  try {
    plans = await extractor((conn.extractor_params ?? {}) as Record<string, unknown>);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await setRunStatus(conn.id, `error: ${detail}`, null, true);
    return { status: "failed", detail };
  }

  // Zero-result guard: treat as scrape failure, never as "everything removed".
  if (plans.length === 0) {
    await setRunStatus(conn.id, "zero results (treated as failure)", null, true);
    return { status: "failed", detail: "extractor returned zero plans; skipping diff" };
  }

  const { data: canonical } = await supabase
    .from("fp_floor_plans")
    .select("id, plan_key, wix_record_id, record, last_seen_at")
    .eq("site_id", site.id)
    .eq("community_id", community.id)
    .eq("builder_id", builder.id)
    .is("removed_at", null);
  const canonicalByKey = new Map((canonical ?? []).map((c) => [c.plan_key, c]));
  const scrapedKeys = new Set(plans.map((p) => p.planKey));

  let queued = 0;

  for (const plan of plans) {
    const existing = canonicalByKey.get(plan.planKey);
    if (!existing) {
      if (
        await queueChange({
          siteId: site.id, communityId: community.id, builderId: builder.id,
          planKey: plan.planKey, changeType: "add", newValue: plan.priceDisplay,
          proposedRecord: plan, runId,
        })
      ) queued += 1;
      continue;
    }

    // Known plan: mark seen, then diff field-by-field.
    await supabase
      .from("fp_floor_plans")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    const current = (existing.record ?? {}) as NormalizedPlan;
    const overrides = new Set(current.userEditedFields ?? []);
    for (const [field, label] of DIFF_FIELDS) {
      if (overrides.has(field)) continue; // user's word beats the scraper's
      const oldVal = current[field];
      const newVal = plan[field];
      if (String(oldVal ?? "") === String(newVal ?? "")) continue;
      const merged: NormalizedPlan = { ...current, ...plan, userEditedFields: current.userEditedFields };
      if (
        await queueChange({
          siteId: site.id, communityId: community.id, builderId: builder.id,
          planKey: plan.planKey, changeType: "update", fieldChanged: label,
          oldValue: String(oldVal ?? ""), newValue: String(newVal ?? ""),
          proposedRecord: merged, wixRecordId: existing.wix_record_id,
          floorPlanId: existing.id, runId,
        })
      ) queued += 1;
    }
  }

  // Removal guard: plan must have been missing since before this run
  // (last_seen_at > 24h old) and the scrape must cover >= 60% of the last
  // known plan count.
  const coverageOk =
    !conn.last_plan_count || plans.length >= 0.6 * conn.last_plan_count;
  if (coverageOk) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const c of canonical ?? []) {
      if (scrapedKeys.has(c.plan_key)) continue;
      if (!c.last_seen_at || new Date(c.last_seen_at).getTime() > cutoff) continue;
      if (
        await queueChange({
          siteId: site.id, communityId: community.id, builderId: builder.id,
          planKey: c.plan_key, changeType: "remove",
          oldValue: (c.record as NormalizedPlan | null)?.priceDisplay ?? null,
          wixRecordId: c.wix_record_id, floorPlanId: c.id, runId,
        })
      ) queued += 1;
    }
  }

  const detail = `ok: ${plans.length} plans, ${queued} changes queued`;
  await setRunStatus(conn.id, detail, plans.length, false);
  logger.info("Floor plan connection run complete", {
    connectionId, builder: builder.name, community: community.name, plans: plans.length, queued,
  });
  return { status: "ok", detail, plans: plans.length, queued };
}
