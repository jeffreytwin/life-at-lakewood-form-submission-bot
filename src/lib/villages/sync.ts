// Keeps each village's price and square footage ranges in the site's
// villages collection true to what is for sale (Jeff, 2026-10-26). The
// numbers come from the pipeline's own mirrors of the two Wix collections
// (fp_floor_plans is Floor Plans V2 as written, ls_site_listings the live
// Homes for Sale rows), so a run costs one read of the villages collection
// and a write per village whose range moved. Runs after a floor plan sync
// cycle completes, after approved plans are written, after a listings run
// that changed rows, and on its own cron as a safety net; every run is
// idempotent and writes only what differs. Off until
// system_settings.village_ranges_enabled is true; the preview (dry run)
// works regardless.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { selectAll } from "@/lib/listings/db";
import {
  getDataCollection,
  queryAllItems,
  updateDataCollection,
  updateItem,
  type WixCollectionField,
  type WixDataItem,
} from "@/lib/wix/client";
import {
  aggregateVillageRanges,
  rangeFields,
  RANGE_FIELD_KEYS,
  RANGE_TAG_KEYS,
  sameFieldValue,
  villageKey,
  type RangeFields,
  type VillageRange,
  type VillageRow,
} from "@/lib/villages/ranges";

/** A site whose villages collection carries the range fields, and which collection that is. */
export interface VillageRangeTarget {
  domain: string;
  collectionId: string;
}

/**
 * Lakewood's villages live in AmenitiesbyVillage (Wellen Park and Parrish
 * keep theirs in HousesforSale-DynamicPages, whose fields differ; they join
 * here once their collections carry the same four fields).
 */
export const VILLAGE_RANGE_TARGETS: VillageRangeTarget[] = [{ domain: "lifeatlakewood.com", collectionId: "AmenitiesbyVillage" }];

/** The one field the collection may not have yet; added on the first run that needs it. */
export const SQFT_FIELD: WixCollectionField = { key: "squareFootageRange", displayName: "Square Footage Range", type: "TEXT" };

/** The fields an item's village name may be in, best first. */
const TITLE_KEYS = ["title", "villagesTitle"];

export interface PlannedUpdate {
  itemId: string;
  title: string;
  village: string;
  plans: number;
  listings: number;
  before: Partial<RangeFields>;
  after: Partial<RangeFields>;
  changed: Array<keyof RangeFields>;
}

export interface VillageRangePlan {
  domain: string;
  collectionId: string;
  /** Items in the collection. */
  items: number;
  /** Villages with at least one plan or listing. */
  villages: number;
  /** Items whose fields differ from the range and will be written. */
  updates: PlannedUpdate[];
  /** Items already saying what the range says. */
  unchanged: string[];
  /** Villages with homes for sale but no item of that name: nothing to write to. */
  unmatchedVillages: string[];
  /** Items with nothing for sale right now: left as they are. */
  itemsWithoutAvailability: string[];
}

function titleOf(item: WixDataItem): string {
  for (const key of TITLE_KEYS) {
    const value = item.data?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return item.id;
}

/** Items by every name they carry; a published item wins over a draft of the same name. */
function indexItems(items: WixDataItem[]): Map<string, WixDataItem> {
  const index = new Map<string, WixDataItem>();
  for (const item of items) {
    for (const key of TITLE_KEYS) {
      const value = item.data?.[key];
      if (typeof value !== "string" || !value.trim()) continue;
      const k = villageKey(value);
      const held = index.get(k);
      if (!held || (held.data?._publishStatus === "DRAFT" && item.data?._publishStatus !== "DRAFT")) index.set(k, item);
    }
  }
  return index;
}

function currentFields(item: WixDataItem): Partial<RangeFields> {
  const out: Record<string, string | string[]> = {};
  for (const key of RANGE_FIELD_KEYS) {
    const value = item.data?.[key];
    if (value === undefined || value === null) continue;
    if (RANGE_TAG_KEYS.has(key)) out[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    else out[key] = String(value);
  }
  return out as Partial<RangeFields>;
}

/**
 * What a run would write: each item matched to its village by name, the
 * fields the range says against the fields the item has. Pure; exported
 * for tests and the preview.
 */
export function planVillageUpdates(target: VillageRangeTarget, items: WixDataItem[], ranges: VillageRange[]): VillageRangePlan {
  const index = indexItems(items);
  const plan: VillageRangePlan = {
    domain: target.domain,
    collectionId: target.collectionId,
    items: items.length,
    villages: ranges.length,
    updates: [],
    unchanged: [],
    unmatchedVillages: [],
    itemsWithoutAvailability: [],
  };
  const matched = new Set<string>();
  for (const range of ranges) {
    const item = index.get(range.key);
    if (!item) {
      plan.unmatchedVillages.push(range.village);
      continue;
    }
    matched.add(item.id);
    const after = rangeFields(range);
    const before = currentFields(item);
    const changed = RANGE_FIELD_KEYS.filter((key) => after[key] !== undefined && !sameFieldValue(before[key], after[key]));
    if (changed.length === 0) {
      plan.unchanged.push(titleOf(item));
      continue;
    }
    plan.updates.push({
      itemId: item.id,
      title: titleOf(item),
      village: range.village,
      plans: range.plans,
      listings: range.listings,
      before: Object.fromEntries(changed.map((key) => [key, before[key]])) as Partial<RangeFields>,
      after: Object.fromEntries(changed.map((key) => [key, after[key]])) as Partial<RangeFields>,
      changed,
    });
  }
  for (const item of items) if (!matched.has(item.id)) plan.itemsWithoutAvailability.push(titleOf(item));
  plan.updates.sort((a, b) => a.title.localeCompare(b.title));
  plan.unchanged.sort();
  plan.itemsWithoutAvailability.sort();
  return plan;
}

interface FpSiteRow {
  id: string;
  wix_site_id: string | null;
}

/**
 * The rows a site's ranges are read from: its Floor Plans V2 rows that are
 * in Wix and not removed, and its live Homes for Sale rows. Also the Wix
 * site id, from whichever sites table has it.
 */
export async function loadVillageRows(domain: string): Promise<{ rows: VillageRow[]; wixSiteId: string | null }> {
  const rows: VillageRow[] = [];
  let wixSiteId: string | null = null;

  const { data: fpSite, error: fpSiteError } = await supabase
    .from("fp_sites")
    .select("id, wix_site_id")
    .eq("domain", domain)
    .maybeSingle();
  if (fpSiteError) throw new Error(`load floor plan site: ${errorMessage(fpSiteError)}`);
  if (fpSite) {
    const site = fpSite as FpSiteRow;
    wixSiteId = site.wix_site_id ?? wixSiteId;
    const [plans, communities] = await Promise.all([
      selectAll<FpPlanRow>("load floor plans", (from, to) =>
        supabase
          .from("fp_floor_plans")
          .select("community_id, price, sqft, beds, baths, home_type:record->>homeType, garages:record->>garages")
          .eq("site_id", site.id)
          .is("removed_at", null)
          .not("wix_record_id", "is", null)
          .order("id")
          .range(from, to)
      ),
      selectAll<{ id: string; name: string }>("load communities", (from, to) =>
        supabase.from("fp_communities").select("id, name").eq("site_id", site.id).order("id").range(from, to)
      ),
    ]);
    const nameOf = new Map(communities.map((c) => [c.id, c.name]));
    for (const plan of plans) {
      const village = nameOf.get(plan.community_id);
      if (!village) continue;
      rows.push({
        village,
        source: "plan",
        price: numberOrNull(plan.price),
        sqft: numberOrNull(plan.sqft),
        beds: numberOrNull(plan.beds),
        baths: numberOrNull(plan.baths),
        garages: garageCount(plan.garages),
        homeType: plan.home_type,
      });
    }
  }

  const { data: lsSite, error: lsSiteError } = await supabase
    .from("ls_sites")
    .select("id, wix_site_id")
    .eq("domain", domain)
    .maybeSingle();
  if (lsSiteError) throw new Error(`load listings site: ${errorMessage(lsSiteError)}`);
  if (lsSite) {
    const site = lsSite as FpSiteRow;
    wixSiteId = wixSiteId ?? site.wix_site_id ?? null;
    const [siteListings, villages] = await Promise.all([
      selectAll<{ listing_id: string; village_id: string | null }>("load live listings", (from, to) =>
        supabase
          .from("ls_site_listings")
          .select("listing_id, village_id")
          .eq("site_id", site.id)
          .eq("state", "live")
          .is("removed_at", null)
          .order("id")
          .range(from, to)
      ),
      selectAll<{ id: string; name: string }>("load villages", (from, to) =>
        supabase.from("ls_villages").select("id, name").eq("site_id", site.id).order("id").range(from, to)
      ),
    ]);
    const villageOf = new Map(villages.map((v) => [v.id, v.name]));
    const ids = [...new Set(siteListings.map((l) => l.listing_id))];
    const listingOf = new Map<string, LsListingRow>();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from("ls_listings")
        .select(
          "listing_id, list_price, living_area, bedrooms, bathrooms, property_sub_type, garage_spaces:raw->>GarageSpaces, garage_yn:raw->>GarageYN, baths_full:raw->>BathroomsFull, baths_half:raw->>BathroomsHalf"
        )
        .in("listing_id", chunk);
      if (error) throw new Error(`load listings: ${errorMessage(error)}`);
      for (const l of (data ?? []) as LsListingRow[]) listingOf.set(l.listing_id, l);
    }
    for (const sl of siteListings) {
      const village = sl.village_id ? villageOf.get(sl.village_id) : undefined;
      const listing = listingOf.get(sl.listing_id);
      if (!village || !listing) continue;
      rows.push({
        village,
        source: "listing",
        price: numberOrNull(listing.list_price),
        sqft: numberOrNull(listing.living_area),
        beds: numberOrNull(listing.bedrooms),
        baths: listingBaths(listing),
        garages: listingGarages(listing),
        homeType: listing.property_sub_type,
      });
    }
  }

  return { rows, wixSiteId };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

interface FpPlanRow {
  community_id: string;
  price: number | string | null;
  sqft: number | null;
  beds: number | string | null;
  baths: number | string | null;
  /** record.homeType: the builder's words ("Attached Villa"). */
  home_type: string | null;
  /** record.garages: "2 car", "3-car", "2". */
  garages: string | null;
}

interface LsListingRow {
  listing_id: string;
  list_price: number | string | null;
  living_area: number | string | null;
  bedrooms: number | string | null;
  /** BathroomsTotalInteger: full and half baths counted alike, so the raw full/half pair is preferred. */
  bathrooms: number | string | null;
  property_sub_type: string | null;
  garage_spaces: string | null;
  garage_yn: string | null;
  baths_full: string | null;
  baths_half: string | null;
}

/** The first number in a garage text ("2 car", "3-Car Garage"); null when there is none. Exported for tests. */
export function garageCount(text: string | null | undefined): number | null {
  const m = (text ?? "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Bathrooms as a buyer counts them: full baths plus a half for each half
 * bath (2 full + 1 half is 2.5). The MLS total integer counts a half as a
 * whole, so it is the fallback only.
 */
export function listingBaths(l: Pick<LsListingRow, "bathrooms" | "baths_full" | "baths_half">): number | null {
  const full = numberOrNull(l.baths_full);
  if (full !== null) return full + 0.5 * (numberOrNull(l.baths_half) ?? 0);
  return numberOrNull(l.bathrooms);
}

/** GarageSpaces when the listing gives it; 0 when it says there is no garage; otherwise unknown. */
export function listingGarages(l: Pick<LsListingRow, "garage_spaces" | "garage_yn">): number | null {
  const spaces = numberOrNull(l.garage_spaces);
  if (spaces !== null) return spaces;
  if (String(l.garage_yn ?? "").toLowerCase() === "false") return 0;
  return null;
}

export interface VillageRangeSyncResult {
  domain: string;
  collectionId: string;
  dryRun: boolean;
  /** The collection's field list gained squareFootageRange (or would, on a dry run). */
  fieldAdded: boolean;
  plan: VillageRangePlan;
  /** Items written; on a dry run, none. */
  written: string[];
  /** Items whose write Wix refused, with the reason. */
  failed: Array<{ title: string; error: string }>;
  skipped?: string;
}

export interface SyncVillageRangesOptions {
  /** One site; every target when omitted. */
  domain?: string;
  /** Compute and compare, write nothing. */
  dryRun?: boolean;
  trigger: string;
}

/** Whether the collection has the field; adds it when it does not (unless dryRun). */
async function ensureSqftField(wixSiteId: string, collectionId: string, dryRun: boolean): Promise<boolean> {
  const collection = await getDataCollection(wixSiteId, collectionId);
  if (!collection) throw new Error(`${collectionId} not found on the site`);
  if (collection.fields.some((f) => f.key === SQFT_FIELD.key)) return false;
  if (!dryRun) {
    await updateDataCollection(wixSiteId, { ...collection, fields: [...collection.fields, { ...SQFT_FIELD }] });
    logger.info("Village ranges: square footage field added", { collectionId, field: SQFT_FIELD.key });
  }
  return true;
}

async function syncOne(target: VillageRangeTarget, dryRun: boolean): Promise<VillageRangeSyncResult> {
  const { rows, wixSiteId } = await loadVillageRows(target.domain);
  const ranges = aggregateVillageRanges(rows);
  const base = { domain: target.domain, collectionId: target.collectionId, dryRun, fieldAdded: false, written: [], failed: [] };
  const emptyPlan: VillageRangePlan = {
    domain: target.domain,
    collectionId: target.collectionId,
    items: 0,
    villages: ranges.length,
    updates: [],
    unchanged: [],
    unmatchedVillages: [],
    itemsWithoutAvailability: [],
  };
  if (!wixSiteId) return { ...base, plan: emptyPlan, skipped: "site has no wix_site_id" };
  // An empty mirror is a broken read, not a market with nothing for sale:
  // writing from it would blank every village.
  if (ranges.length === 0) return { ...base, plan: emptyPlan, skipped: "no plans or listings loaded; nothing written" };

  const fieldAdded = await ensureSqftField(wixSiteId, target.collectionId, dryRun);
  const items = await queryAllItems(wixSiteId, target.collectionId, { includeDrafts: true });
  const plan = planVillageUpdates(target, items, ranges);
  const result: VillageRangeSyncResult = { ...base, fieldAdded, plan };
  if (dryRun) return result;

  for (const update of plan.updates) {
    const item = items.find((i) => i.id === update.itemId);
    if (!item) continue;
    // The row as read, minus Wix's own fields, plus the four: a full-item
    // update (PUT) keeps everything else the row carries.
    const kept = Object.fromEntries(Object.entries(item.data ?? {}).filter(([k]) => !k.startsWith("_")));
    try {
      await updateItem(wixSiteId, target.collectionId, update.itemId, { ...kept, ...update.after });
      result.written.push(update.title);
    } catch (error) {
      result.failed.push({ title: update.title, error: errorMessage(error) });
    }
  }
  logger.info("Village ranges written", {
    domain: target.domain,
    collectionId: target.collectionId,
    written: result.written.length,
    failed: result.failed.length,
    unchanged: plan.unchanged.length,
    unmatchedVillages: plan.unmatchedVillages,
  });
  return result;
}

/** Runs the sync for one site or all of them. Does not consult the enabled flag: the caller decides. */
export async function syncVillageRanges(opts: SyncVillageRangesOptions): Promise<VillageRangeSyncResult[]> {
  const targets = opts.domain ? VILLAGE_RANGE_TARGETS.filter((t) => t.domain === opts.domain) : VILLAGE_RANGE_TARGETS;
  if (opts.domain && targets.length === 0) throw new Error(`no village ranges target for ${opts.domain}`);
  const results: VillageRangeSyncResult[] = [];
  for (const target of targets) results.push(await syncOne(target, opts.dryRun === true));
  if (!opts.dryRun) await recordRun(opts.trigger, results);
  return results;
}

/** What the last run did, kept in system_settings for the status endpoint. */
export interface VillageRangesState {
  lastRunAt?: string;
  lastTrigger?: string;
  lastResults?: Array<{
    domain: string;
    written: number;
    failed: number;
    unchanged: number;
    unmatchedVillages: string[];
    skipped?: string;
  }>;
}

async function recordRun(trigger: string, results: VillageRangeSyncResult[]): Promise<void> {
  const state: VillageRangesState = {
    lastRunAt: new Date().toISOString(),
    lastTrigger: trigger,
    lastResults: results.map((r) => ({
      domain: r.domain,
      written: r.written.length,
      failed: r.failed.length,
      unchanged: r.plan.unchanged.length,
      unmatchedVillages: r.plan.unmatchedVillages,
      ...(r.skipped ? { skipped: r.skipped } : {}),
    })),
  };
  const { error } = await supabase.from("system_settings").update({ village_ranges_state: state }).eq("id", 1);
  if (error) logger.warn("Village ranges: state not recorded", { error: errorMessage(error) });
}

/**
 * The hook the syncs call when they finish: runs when the switch is on,
 * never throws (a range that did not update must not fail the sync that
 * called it). Returns what happened, for the caller's own summary.
 */
export async function refreshVillageRanges(trigger: string): Promise<{ skipped?: string; written?: number; failed?: number }> {
  try {
    const { data: settings, error } = await supabase.from("system_settings").select("village_ranges_enabled").eq("id", 1).single();
    if (error || !settings) return { skipped: "no settings row" };
    if (!settings.village_ranges_enabled) return { skipped: "village ranges disabled" };
    const results = await syncVillageRanges({ trigger });
    return {
      written: results.reduce((n, r) => n + r.written.length, 0),
      failed: results.reduce((n, r) => n + r.failed.length, 0),
    };
  } catch (error) {
    logger.error("Village ranges refresh failed", { trigger, error: errorMessage(error) });
    return { skipped: `failed: ${errorMessage(error)}` };
  }
}
