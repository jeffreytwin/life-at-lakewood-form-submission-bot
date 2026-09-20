// Sync core: runs one builder×community connection — extract, guard, diff
// against canonical plans, and queue pending changes. Used by the manual
// "Run scraper" button during builder onboarding and by the nightly loop.
//
// Guardrails enforced here:
// - Zero-result scrapes are failures: no diff, no removals, failure counted.
// - Removals require the plan to have been missing across runs (last_seen_at
//   older than 24h) AND a scrape covering >= 60% of the last known count.
// - Rejections stick: a change identical to a rejected row is not re-queued.
// - User-edited fields (manual overrides) are never proposed for reversion,
//   and the record an approved update writes keeps them (diff.ts).
// - Galleries are diffed too (photos and blueprints, in order), so a
//   builder's photo changes reach the site instead of freezing at the add.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { type NormalizedPlan } from "@/lib/floorplans/types";
import { extractTollBrothers } from "@/lib/floorplans/extractors/toll-brothers";
import { extractWithClaude } from "@/lib/floorplans/extractors/claude-extract";
import { extractLennar } from "@/lib/floorplans/extractors/lennar";
import { extractMeritage } from "@/lib/floorplans/extractors/meritage";
import { extractTaylorMorrison } from "@/lib/floorplans/extractors/taylor-morrison";
import { extractMattamy } from "@/lib/floorplans/extractors/mattamy";
import { extractDrb } from "@/lib/floorplans/extractors/drb";
import { extractMpcAggregator } from "@/lib/floorplans/extractors/mpc-aggregator";
import { fieldChanges, mergeForUpdate, type CanonicalRecord } from "@/lib/floorplans/diff";
import { linkQuickMoveIns } from "@/lib/floorplans/quick-move-ins";
import { describeCoverage } from "@/lib/floorplans/coverage";
import { withRememberedScore } from "@/lib/floorplans/scores";
import { standardizePlan } from "@/lib/floorplans/standardize";

type Extractor = (params: Record<string, unknown>) => Promise<NormalizedPlan[]>;

// Lee Wetherington's real site (lwhomes.com; leewetherington.com is an
// empty JS shell) server-renders all its for-sale homes on one shared
// /listings/ page — route it through the generic Claude engine with the
// community pinned in the hint so each connection only sees its own homes.
const extractLeeWetherington: Extractor = (params) => {
  const communityName = String(params.communityName ?? "");
  const shortName = communityName.split(/\s*-\s*/).pop() ?? communityName;
  return extractWithClaude({
    url: typeof params.url === "string" && params.url ? params.url : "https://lwhomes.com/listings/",
    hint: `The page lists Lee Wetherington homes across several communities. Only report homes/plans located in the "${shortName}" community; ignore every other community. If none are listed for it, report an empty list.`,
  });
};

// Builder-specific engines take precedence (bespoke json_api parsers);
// everything else falls back to its extraction_method's generic engine.
const BUILDER_EXTRACTORS: Record<string, Extractor> = {
  "Toll Brothers": extractTollBrothers,
  Lennar: extractLennar,
  "Meritage Homes": extractMeritage,
  "Taylor Morrison": extractTaylorMorrison,
  "Mattamy Homes": extractMattamy,
  "DRB Homes": extractDrb,
  "Lee Wetherington": extractLeeWetherington,
  // Builders that block their own sites — sourced from the master-planned-
  // community aggregators instead (a different origin, so the blocks don't
  // apply). Wellen Park (default) is server-rendered and covers ICI (Oakbend
  // + Palmera) and M/I (Palmera). Communities that live in Lakewood Ranch
  // (M/I Sweetwater/Nautique, Neal Signature) need extractor_params.source =
  // "lakewoodranch" once that site's client-rendered list is reachable.
  "M/I Homes": extractMpcAggregator,
  "ICI Homes": extractMpcAggregator,
  "Neal Signature Homes": extractMpcAggregator,
};

const METHOD_EXTRACTORS: Record<string, Extractor> = {
  fetch_claude: extractWithClaude,
};

// Builders whose extractor works from API ids rather than a page URL —
// URL auto-discovery is skipped (their pages block non-browser fetches,
// which would fail discovery's verification step and abort the run).
const URLLESS_BUILDERS = new Set([
  "Meritage Homes", "DRB Homes", "Lee Wetherington",
  "M/I Homes", "ICI Homes", "Neal Signature Homes",
]);

function resolveExtractor(builderName: string, method: string | null): Extractor | null {
  return BUILDER_EXTRACTORS[builderName] ?? (method ? METHOD_EXTRACTORS[method] : null) ?? null;
}

interface RunResult {
  /** partial: plans came back, but far fewer than last time (coverage.ts); counted as a failure, removals held. */
  status: "ok" | "partial" | "failed" | "skipped";
  detail: string;
  plans?: number;
  queued?: number;
}

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
  const extractor = resolveExtractor(builder.name, builder.extraction_method);
  if (!extractor) {
    await setRunStatus(conn.id, "no extractor available for this builder yet", null, true);
    return { status: "failed", detail: `no extractor available for ${builder.name} (${builder.extraction_method ?? "unclassified"})` };
  }

  // Auto-discover the community page URL on first run if not configured.
  let params = (conn.extractor_params ?? {}) as Record<string, unknown>;
  if (!params.url && !URLLESS_BUILDERS.has(builder.name)) {
    const { data: builderRow } = await supabase
      .from("fp_builders")
      .select("base_url, engine_config")
      .eq("id", builder.id)
      .single();
    const { discoverCommunityUrl } = await import("@/lib/floorplans/discover-url");
    const url = builderRow
      ? await discoverCommunityUrl(builderRow, community.name)
      : null;
    if (!url) {
      await setRunStatus(conn.id, "could not auto-discover page URL — set it via Edit URL", null, true);
      return { status: "failed", detail: `could not auto-discover a ${builder.name} page for ${community.name}; set the URL manually` };
    }
    params = { ...params, url };
    await supabase
      .from("fp_builder_communities")
      .update({ extractor_params: params })
      .eq("id", conn.id);
  }

  const runId = `manual-${Date.now()}`;
  let plans: NormalizedPlan[];
  try {
    plans = await extractor({ ...params, communityName: community.name, builderName: builder.name });
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
  // Every plan reads the way the site files it (one of five home types,
  // the larger end of a bed or bath range; standardize.ts), then each
  // quick move-in learns its base plan and each base plan learns whether
  // it has any (the Wellen Park / Parrish way, quick-move-ins.ts).
  plans = linkQuickMoveIns(plans.map(standardizePlan));

  const { data: canonical } = await supabase
    .from("fp_floor_plans")
    .select("id, plan_key, wix_record_id, record, last_seen_at")
    .eq("site_id", site.id)
    .eq("community_id", community.id)
    .eq("builder_id", builder.id)
    .is("removed_at", null);
  const canonicalByKey = new Map((canonical ?? []).map((c) => [c.plan_key, c]));
  const scrapedKeys = new Set(plans.map((p) => p.planKey));
  // Scores set in the Hub outlive the plans (a Reset removes those): a
  // plan queued again comes back with the score it had.
  const { data: rememberedRows } = await supabase
    .from("fp_plan_scores")
    .select("plan_key, score")
    .match({ site_id: site.id, community_id: community.id, builder_id: builder.id });
  const remembered = new Map((rememberedRows ?? []).map((r) => [r.plan_key, Number(r.score)] as const));

  let queued = 0;

  for (const plan of plans) {
    const existing = canonicalByKey.get(plan.planKey);
    if (!existing) {
      if (
        await queueChange({
          siteId: site.id, communityId: community.id, builderId: builder.id,
          planKey: plan.planKey, changeType: "add", newValue: plan.priceDisplay,
          proposedRecord: withRememberedScore(plan, remembered), runId,
        })
      ) queued += 1;
      continue;
    }

    // Known plan: mark seen, then diff field-by-field (scalars and both
    // galleries). The rules live in diff.ts: a field a person edited is
    // never proposed for reversion, and the merged record an approval
    // writes keeps every such field.
    await supabase
      .from("fp_floor_plans")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    const current = (existing.record ?? {}) as CanonicalRecord;
    const merged = withRememberedScore(mergeForUpdate(current, plan), remembered);
    for (const change of fieldChanges(current, plan)) {
      if (
        await queueChange({
          siteId: site.id, communityId: community.id, builderId: builder.id,
          planKey: plan.planKey, changeType: "update", fieldChanged: change.label,
          oldValue: change.oldValue, newValue: change.newValue,
          proposedRecord: merged, wixRecordId: existing.wix_record_id,
          floorPlanId: existing.id, runId,
        })
      ) queued += 1;
    }
  }

  // Removal guard: plan must have been missing since before this run
  // (last_seen_at > 24h old) and the scrape must cover >= 60% of the last
  // known plan count.
  const coverage = describeCoverage(plans.length, conn.last_plan_count);
  if (coverage.ok) {
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

  // A shortfall is the usual sign of a builder page that changed shape, so
  // it is recorded as a failure and shows up wherever failures do (the
  // Floor Plans banner, Builder Connections, the digest).
  const detail = coverage.ok
    ? `ok: ${plans.length} plans, ${queued} changes queued`
    : `${coverage.detail}; ${queued} changes queued`;
  await setRunStatus(conn.id, detail, plans.length, !coverage.ok);
  // First successful run marks the connection nightly-eligible.
  await supabase
    .from("fp_builder_communities")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", conn.id)
    .is("onboarded_at", null);
  logger.info("Floor plan connection run complete", {
    connectionId, builder: builder.name, community: community.name, plans: plans.length, queued,
  });
  return { status: coverage.ok ? "ok" : "partial", detail, plans: plans.length, queued };
}
