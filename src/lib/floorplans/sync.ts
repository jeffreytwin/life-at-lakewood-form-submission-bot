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

import { withoutCommunityPictures } from "@/lib/floorplans/community-pictures";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { type NormalizedPlan } from "@/lib/floorplans/types";
import { extractTollBrothers, readTollPlanPage } from "@/lib/floorplans/extractors/toll-brothers";
import { extractWithClaude, extractWithRender } from "@/lib/floorplans/extractors/claude-extract";
import { extractLennar } from "@/lib/floorplans/extractors/lennar";
import { extractMeritage } from "@/lib/floorplans/extractors/meritage";
import { extractTaylorMorrison, readTaylorPlanPage } from "@/lib/floorplans/extractors/taylor-morrison";
import { extractMattamy } from "@/lib/floorplans/extractors/mattamy";
import { extractDrb } from "@/lib/floorplans/extractors/drb";
import { extractDrHorton } from "@/lib/floorplans/extractors/drhorton";
import { extractPulteGroup } from "@/lib/floorplans/extractors/pulte";
import { extractMpcAggregator } from "@/lib/floorplans/extractors/mpc-aggregator";
import { extractWestBay } from "@/lib/floorplans/extractors/westbay";
import { extractKb } from "@/lib/floorplans/extractors/kb";
import { extractHighland } from "@/lib/floorplans/extractors/highland";
import { comparedFields, fieldChanges, mergeForUpdate, withDescriptionFrom, type CanonicalRecord } from "@/lib/floorplans/diff";
import { withKnownTours } from "@/lib/floorplans/tours";
import { linkQuickMoveIns, withQuickMoveInPictures, withQuickMoveInPrices } from "@/lib/floorplans/quick-move-ins";
import { describeCoverage } from "@/lib/floorplans/coverage";
import { withRememberedScore } from "@/lib/floorplans/scores";
import { builderDefaults, standardizePlan } from "@/lib/floorplans/standardize";
import { withStandIns, type StandInRule } from "@/lib/floorplans/stand-ins";
import { rejectionStillApplies } from "@/lib/floorplans/approval";
import { neutralizeDescriptions, withDescriptions } from "@/lib/floorplans/description";
import { withKnownSpellings, withScrapedPictures } from "@/lib/floorplans/pictures";
import { AUTO_RUN } from "@/lib/floorplans/run-state";
import { rememberedRooms, withLookedAtRooms } from "@/lib/floorplans/photo-rooms";

type Extractor = (params: Record<string, unknown>) => Promise<NormalizedPlan[]>;

// Lee Wetherington's real site (lwhomes.com; leewetherington.com is an
// empty JS shell) lists all its for-sale homes on one shared /listings/
// page — routed through the generic Claude engine with the community
// pinned in the hint so each connection only sees its own homes. That page
// now draws its homes after it loads ("carries no prices or sizes without
// its scripts", 2026-09-23), so it is read through the browser.
const extractLeeWetherington: Extractor = (params) => {
  const communityName = String(params.communityName ?? "");
  const shortName = communityName.split(/\s*-\s*/).pop() ?? communityName;
  return extractWithRender({
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
  "D.R. Horton": extractDrHorton,
  // PulteGroup's brands share one site and its feeds (pulte.ts); Del Webb's
  // communities are filed under Pulte Homes.
  "Pulte Homes": extractPulteGroup,
  "Centex Homes": extractPulteGroup,
  "Lee Wetherington": extractLeeWetherington,
  // WestBay's pages draw their plans from its own feeds (westbay.ts).
  "Homes by WestBay": extractWestBay,
  // KB writes every plan card's record into its page (kb.ts).
  "KB Home": extractKb,
  // Highland's pages post to a feed for their plans and homes (highland.ts).
  "Highland Homes": extractHighland,
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
  // Builders whose pages carry nothing without their scripts (Richmond
  // American's Blazor site): the same engine, read through a browser.
  render_claude: extractWithRender,
  // A master-planned community's own listings (mpc-aggregator.ts), for a
  // connection whose builder's site will not be read: Neal Signature's
  // Everly is behind a bot challenge, and Wellen Park lists its homes
  // (2026-09-23). extractor_params.url is then the listing page, and
  // builderSlug the builder as the listing names it.
  mpc_aggregator: extractMpcAggregator,
};

// Builders whose extractor works from API ids rather than a page URL —
// URL auto-discovery is skipped (their pages block non-browser fetches,
// which would fail discovery's verification step and abort the run).
export const URLLESS_BUILDERS = new Set([
  "Meritage Homes", "DRB Homes", "Lee Wetherington",
  "M/I Homes", "ICI Homes", "Neal Signature Homes",
]);

/**
 * How a run's 300 seconds are spent. The builder's pages are read for the
 * first 210; a page not started by then is left for the next run (the
 * plan says its page went unread, and the diff keeps what an earlier run
 * found — diff.ts). Descriptions are reworded until 250; the rest is the
 * comparing and queueing. Before this a big community simply ran out of
 * time and the whole run was lost: Perry's Star Farms read for 306
 * seconds, and a first run would then have reworded thirty-odd
 * descriptions one after another on top (2026-09-23).
 */
export const RUN_READ_MS = 210_000;
export const RUN_PREPARE_MS = 250_000;

/** Builders read through a browser though their method says otherwise: their own engine renders. */
const BROWSER_BUILDERS = new Set(["Lee Wetherington"]);

/**
 * Whether a builder's run renders pages in a browser. Such runs share one
 * browser per process and take minutes, so the nightly loop starts one only
 * with most of a tick left, and never two at once.
 */
export function readsThroughBrowser(builderName: string, method: string | null, params?: Record<string, unknown> | null): boolean {
  const engine = connectionEngine(params);
  if (engine) return engine === "render_claude";
  return method === "render_claude" || BROWSER_BUILDERS.has(builderName);
}

export function resolveExtractor(builderName: string, method: string | null): Extractor | null {
  return BUILDER_EXTRACTORS[builderName] ?? (method ? METHOD_EXTRACTORS[method] : null) ?? null;
}

/**
 * The engine one connection is read with, where it differs from its
 * builder's: extractor_params.engine. M/I's Wellen Park homes come from
 * Wellen Park's own listings, but its Lakewood Ranch communities are on no
 * such list and are read off M/I's pages in a browser (Sweetwater,
 * Nautique at Waterside; 2026-09-23).
 */
function connectionEngine(params?: Record<string, unknown> | null): string | null {
  const engine = params?.engine;
  return typeof engine === "string" && METHOD_EXTRACTORS[engine] ? engine : null;
}

/** The extractor for one connection: its own engine if it names one, else its builder's. */
export function extractorFor(builderName: string, method: string | null, params?: Record<string, unknown> | null): Extractor | null {
  const engine = connectionEngine(params);
  return engine ? METHOD_EXTRACTORS[engine] : resolveExtractor(builderName, method);
}

/** Whether a connection is read from ids rather than a page: its builder's engine needs none, and it names no engine of its own. */
export function readsWithoutPage(builderName: string, params?: Record<string, unknown> | null): boolean {
  return URLLESS_BUILDERS.has(builderName) && !connectionEngine(params);
}

export interface RunResult {
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

/** Whether an identical change was rejected and the rejection still holds: rejections stick. */
export async function stillRejected(args: {
  siteId: string;
  communityId: string;
  builderId: string;
  planKey: string;
  changeType: "add" | "update" | "remove";
  fieldChanged?: string;
  newValue?: string | null;
  proposedRecord?: NormalizedPlan | null;
}): Promise<boolean> {
  const fieldKey = args.fieldChanged ?? null;
  // Identical = same plan + change type + field + proposed new value. A
  // rejected new plan comes back once the builder fills in something it
  // lacked (approval.ts, rejectionStillApplies): a plan rejected for
  // having no bedrooms is queued again when it has them.
  let rejectedQuery = supabase
    .from("fp_pending_changes")
    .select("id, proposed_record")
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
  const holds = (rejected ?? []).some(
    (r) => args.changeType !== "add" || rejectionStillApplies(r.proposed_record, args.proposedRecord)
  );
  return holds;
}

/**
 * A pending change the run no longer finds is out of date: the builder put
 * the price back, or the run reads the page the way the record already has
 * it (a description read without its closing sentence, 2026-09-25). One
 * that nobody has touched is taken off the queue; one a person edited
 * stays for them to decide.
 */
async function withdrawOutdated(
  ids: { siteId: string; communityId: string; builderId: string; planKey: string },
  compared: string[],
  changes: { label: string }[],
  current: NormalizedPlan
): Promise<void> {
  const found = new Set(changes.map((c) => c.label));
  const outdated = compared.filter((label) => !found.has(label));
  if (!outdated.length) return;
  const { data: rows } = await supabase
    .from("fp_pending_changes")
    .select("id, proposed_record")
    .match({ site_id: ids.siteId, community_id: ids.communityId, builder_id: ids.builderId, plan_key: ids.planKey, change_type: "update", status: "pending" })
    .in("field_changed", outdated);
  const already = new Set(current.userEditedFields ?? []);
  const untouched = (rows ?? []).filter((r) => {
    const edited = (r.proposed_record as NormalizedPlan | null)?.userEditedFields ?? [];
    return edited.every((f) => already.has(f));
  });
  if (!untouched.length) return;
  const { error } = await supabase.from("fp_pending_changes").delete().in("id", untouched.map((r) => r.id));
  if (error) logger.warn("Outdated pending changes could not be withdrawn", { planKey: ids.planKey, error: error.message });
}

/**
 * A change approved without a review: recorded as approved, for the sync
 * tick to write to Wix (applyAutoApproved). One waiting per plan and field.
 */
async function approveOnItsOwn(args: {
  siteId: string;
  communityId: string;
  builderId: string;
  planKey: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  proposedRecord: NormalizedPlan;
  wixRecordId: string;
  floorPlanId: string;
  runId: string;
}): Promise<void> {
  const row = {
    site_id: args.siteId,
    community_id: args.communityId,
    builder_id: args.builderId,
    floor_plan_id: args.floorPlanId,
    plan_key: args.planKey,
    change_type: "update",
    field_changed: args.fieldChanged,
    old_value: args.oldValue,
    new_value: args.newValue,
    proposed_record: args.proposedRecord,
    wix_record_id: args.wixRecordId,
    run_id: `${AUTO_RUN}${args.runId}`,
    status: "approved",
    updated_at: new Date().toISOString(),
  };
  const { data: waiting } = await supabase
    .from("fp_pending_changes")
    .select("id")
    .match({ site_id: args.siteId, community_id: args.communityId, builder_id: args.builderId, plan_key: args.planKey, field_changed: args.fieldChanged, status: "approved" })
    .like("run_id", `${AUTO_RUN}%`)
    .maybeSingle();
  const { error } = waiting
    ? await supabase.from("fp_pending_changes").update(row).eq("id", waiting.id)
    : await supabase.from("fp_pending_changes").insert(row);
  if (error) logger.warn("Change approved without review could not be recorded", { planKey: args.planKey, error: error.message });
}

/** Queue one change unless an identical one was rejected or already pending. */
export async function queueChange(args: {
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
  if (await stillRejected(args)) return false;

  // Dedupe against an existing pending row for the same logical change.
  let pendingQuery = supabase
    .from("fp_pending_changes")
    .select("id")
    .eq("site_id", args.siteId)
    .eq("community_id", args.communityId)
    .eq("builder_id", args.builderId)
    .eq("plan_key", args.planKey)
    .in("status", ["pending", "approving"]);
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

/** Engines that can read one plan's own page in full: what a stand-in plan built from a home gets (stand-ins.ts). */
const PAGE_READERS: Record<string, (plan: NormalizedPlan) => Promise<NormalizedPlan>> = {
  "Toll Brothers": readTollPlanPage,
  "Taylor Morrison": readTaylorPlanPage,
};

/** The plan with everything its own page adds, when the builder's engine can read one; unchanged otherwise. */
export async function readPlanInFull(builderName: string, plan: NormalizedPlan): Promise<NormalizedPlan> {
  const reader = PAGE_READERS[builderName];
  return reader ? reader(plan) : plan;
}

interface PlanScopeIds {
  site_id: string;
  community_id: string;
  builder_id: string;
}

/**
 * The stand-in rules for a connection (fp_stand_in_plans): the plans a
 * person asked to build from their quick move-ins. A table that cannot be
 * read costs the rules, never the run.
 */
export async function loadStandInRules(scope: PlanScopeIds): Promise<StandInRule[]> {
  const { data, error } = await supabase
    .from("fp_stand_in_plans")
    .select("plan_key, plan_name, source_plan_key")
    .match(scope);
  if (error) {
    logger.warn("Stand-in rules could not be read", { scope, error: error.message });
    return [];
  }
  return (data ?? []).map((r) => ({ planKey: r.plan_key, planName: r.plan_name, sourcePlanKey: r.source_plan_key }));
}

/**
 * What a run makes of the plans its extractor read, before anything is
 * compared or queued: the site's standard fields, quick move-ins tied to
 * their plans, stand-ins, descriptions. Reads settings and stand-in rules
 * but writes nothing, so the connection check (scripts/floorplan-
 * connection-check.ts) sees exactly what a run would queue.
 */
export async function preparePlans(
  scraped: NormalizedPlan[],
  scope: { site: { id: string }; community: { id: string; name: string }; builder: { id: string; name: string } },
  opts: {
    rewordDescriptions?: boolean;
    deadline?: number;
    /** The records the connection already has, by plan key: their pictures' addresses are kept (withKnownSpellings). */
    known?: Map<string, Partial<NormalizedPlan> | null>;
  } = {}
): Promise<NormalizedPlan[]> {
  const { site, community, builder } = scope;
  let plans = scraped;
  // Every plan reads the way the site files it (one of five home types,
  // the larger end of a bed or bath range; standardize.ts), then each
  // quick move-in learns its base plan and each base plan learns whether
  // it has any (the Wellen Park / Parrish way, quick-move-ins.ts).
  // A base plan the builder gave no price takes its cheapest quick
  // move-in's until the builder prices it (Jeff, 2026-09-20).
  const link = (list: NormalizedPlan[]) => withQuickMoveInPictures(withQuickMoveInPrices(linkQuickMoveIns(list)));
  // What is true of every plan this builder offers, whatever its pages say
  // (Settings → Builders; Jeff, 2026-09-22: Stock builds single-family homes
  // and its pages name no type at all).
  const { data: settings } = await supabase
    .from("fp_builders")
    .select("engine_config")
    .eq("id", builder.id)
    .maybeSingle();
  const defaults = builderDefaults(settings?.engine_config as Record<string, unknown> | null);
  plans = link(plans.map((plan) => standardizePlan(plan, defaults)));
  // The community's own pictures, filed in every plan's gallery, are taken
  // back out (community-pictures.ts).
  plans = withoutCommunityPictures(plans);
  // A plan the builder no longer lists but a person asked to keep, built
  // from its homes on offer (stand-ins.ts): each is read from the home's own
  // page so it carries every picture, then linked like the rest.
  const rules = await loadStandInRules({ site_id: site.id, community_id: community.id, builder_id: builder.id });
  const standIns = withStandIns(plans, rules);
  if (standIns.standIns.length) {
    const filled = await Promise.all(
      standIns.standIns.map(async (p) => {
        try {
          return await readPlanInFull(builder.name, p);
        } catch (err) {
          logger.warn("Stand-in plan page could not be read", { planKey: p.planKey, error: err instanceof Error ? err.message : String(err) });
          return p;
        }
      })
    );
    const standInKeys = new Set(filled.map((p) => p.planKey));
    plans = link([...standIns.plans.filter((p) => !standInKeys.has(p.planKey)), ...filled]);
  }

  // A photo the record already has keeps the address it has there, and so
  // what was learned about it (pictures.ts).
  if (opts.known) plans = plans.map((p) => withKnownSpellings(p, opts.known!.get(p.planKey)));

  // Photos someone has already looked at are put in the site's order by
  // what they show (photo-rooms.ts); the builder's file names say nothing
  // for most of them. Only remembered answers are used here, so the order
  // is the same every run and no reordering is proposed night after night;
  // the looking itself happens in the background (sort-queue.ts). A table
  // that cannot be read costs the order, never the run.
  try {
    const looked = await rememberedRooms(plans.flatMap((p) => p.galleryImages));
    if (looked.size) plans = plans.map((p) => withLookedAtRooms(p, looked));
  } catch (err) {
    logger.warn("Remembered photo rooms could not be applied", { error: err instanceof Error ? err.message : String(err) });
  }

  // A base plan whose builder writes no description gets one from its own
  // fields (Jeff, 2026-09-21: Stock Luxury Homes writes none at all), and
  // a description that speaks as the builder ("we", "our") is reworded in
  // the third person, once per text (description.ts).
  plans = withDescriptions(plans, community.name);
  if (opts.rewordDescriptions !== false) plans = await neutralizeDescriptions(plans, builder.name, opts.deadline);
  return plans;
}

export async function runConnection(connectionId: string): Promise<RunResult> {
  const startedAt = Date.now();
  const { data: conn, error } = await supabase
    .from("fp_builder_communities")
    .select(
      "id, active, extractor_params, last_plan_count, fp_builders:builder_id(id, name, active, extraction_method), fp_communities:community_id(id, name, site_id, fp_sites:site_id(id, name, domain))"
    )
    .eq("id", connectionId)
    .single();
  if (error || !conn) return { status: "failed", detail: error?.message ?? "connection not found" };

  const builder = conn.fp_builders as unknown as {
    id: string; name: string; active: boolean; extraction_method: string | null;
  };
  const community = conn.fp_communities as unknown as {
    id: string; name: string; fp_sites: { id: string; name: string | null; domain: string };
  };
  const site = community.fp_sites;

  if (!conn.active || !builder.active) {
    return { status: "skipped", detail: "connection or builder is paused" };
  }
  let params = (conn.extractor_params ?? {}) as Record<string, unknown>;
  const extractor = extractorFor(builder.name, builder.extraction_method, params);
  if (!extractor) {
    await setRunStatus(conn.id, "no extractor available for this builder yet", null, true);
    return { status: "failed", detail: `no extractor available for ${builder.name} (${builder.extraction_method ?? "unclassified"})` };
  }

  // Auto-discover the community page URL on first run if not configured.
  if (!params.url && !readsWithoutPage(builder.name, params)) {
    const { data: builderRow } = await supabase
      .from("fp_builders")
      .select("base_url, engine_config")
      .eq("id", builder.id)
      .single();
    const { discoverCommunityUrl } = await import("@/lib/floorplans/discover-url");
    // The site's market ("Lakewood Ranch") keeps a same-named community
    // elsewhere from being picked (Toll's Monterey in California, 2026-09-20).
    const url = builderRow
      ? await discoverCommunityUrl(builderRow, community.name, site.name ? [site.name] : [])
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
    plans = await extractor({ ...params, communityName: community.name, builderName: builder.name, runDeadline: startedAt + RUN_READ_MS });
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
  plans = await preparePlans(plans, { site, community, builder }, {
    deadline: startedAt + RUN_PREPARE_MS,
    known: new Map((canonical ?? []).map((c) => [c.plan_key, c.record as Partial<NormalizedPlan> | null])),
  });
  // A tour link dropped as one that does not work (Lennar's own, since
  // 2026-09-25) gives way to the working tour with its number, where a
  // record of the community already shows it (tours.ts).
  plans = withKnownTours(plans, (canonical ?? []).map((c) => (c.record as NormalizedPlan | null)?.virtualTourUrl));
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
          proposedRecord: withScrapedPictures(withRememberedScore(plan, remembered), plan), runId,
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
    // A field whose change was rejected keeps its value in the record any
    // other approved change writes (mergeForUpdate).
    const ids = { siteId: site.id, communityId: community.id, builderId: builder.id, planKey: plan.planKey, changeType: "update" as const };
    const changes = fieldChanges(current, plan);
    const rejected = new Set<keyof NormalizedPlan>();
    for (const change of changes) {
      if (await stillRejected({ ...ids, fieldChanged: change.label, newValue: change.newValue })) rejected.add(change.field);
    }
    const merged = withScrapedPictures(withRememberedScore(mergeForUpdate(current, plan, rejected), remembered), plan);
    // A quick move-in's description is not shown on the site; it only
    // helps a person tell which floor plan an unknown home is. Its change is
    // approved without a review and written on its own (Jeff, 2026-09-25).
    const described =
      plan.quickMoveIn === true && existing.wix_record_id
        ? changes.find((c) => c.field === "description" && !rejected.has(c.field))
        : undefined;
    const reviewed = changes.filter((c) => !rejected.has(c.field) && c !== described);
    await withdrawOutdated(ids, comparedFields(current, plan), reviewed, current);
    if (described) {
      await approveOnItsOwn({
        siteId: site.id, communityId: community.id, builderId: builder.id,
        planKey: plan.planKey, fieldChanged: described.label,
        oldValue: described.oldValue, newValue: described.newValue,
        proposedRecord: withDescriptionFrom(current, plan), wixRecordId: existing.wix_record_id,
        floorPlanId: existing.id, runId,
      });
    }
    for (const change of reviewed) {
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
