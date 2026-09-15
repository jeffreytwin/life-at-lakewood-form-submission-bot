// Per-neighborhood stats on a site's neighborhoods collection
// (HousesforSale-DynamicPages), ported from the Longboat Key pipeline's
// village-stats.jsw so cutover changes nothing the pages or the Google Ads
// automation read: activeListingCount and zeroSince drive the ads inventory
// feed (backend/sync/ads-feed.jsw), the *Active ranges show on the
// neighborhood pages, and the hand-curated all-time ranges only ever widen.
// Computed from the engine's own live rows and written only when the site is
// live; in shadow mode the Velo pipeline still maintains the fields.
//
//   priceRangeActive       e.g. "$500s - $1M"   (from the listing price)
//   squareFeetActive       e.g. "1,200 - 4,100" (from the living area)
//   bedroomRangeActive     e.g. "2 - 4"
//   garageSizeRangeActive  e.g. "1 - 3 Car"
//   activeListingCount     e.g. 12              (listings the site shows)
//   zeroSince              stamped when the count hits 0, cleared on recovery
//
// Price bands round down (never up) so a range never overstates: the nearest
// $100k below $1M ("$500s"), the nearest $1M at or above ("$2M"). Square feet
// floor to the hundred; beds are exact; garages carry one " Car" suffix and
// "0 Car" (no garage, vacant land) is excluded. A range collapses to one
// token when both ends match, and is null without usable data.

import { errorMessage } from "@/lib/shared/errors";
import { bulkUpdateItems, queryAllItems, type WixItemData } from "@/lib/wix/client";
import { chunk, loadLiveListingStats, type LiveListingStatsRow } from "@/lib/listings/db";
import type { LsSite } from "@/lib/listings/types";

const WRITE_CHUNK = 50;
/** Wix system fields a read returns that an update must not carry. */
const SYSTEM_FIELDS = new Set(["_owner", "_createdDate", "_updatedDate", "_publishStatus", "_publishDate", "_draftDate"]);

export interface VillageAggregate {
  published: number;
  priceMin?: number;
  priceMax?: number;
  sqftMin?: number;
  sqftMax?: number;
  bedMin?: number;
  bedMax?: number;
  garageMin?: number;
  garageMax?: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function commafy(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A price as a band token: "$500s" below $1M, "$2M" at or above; floor rounds down for the low end of a range. */
export function priceToken(value: number | null | undefined, mode: "round" | "floor" = "round"): string | null {
  if (!finite(value) || value <= 0) return null;
  const snap = mode === "floor" ? Math.floor : Math.round;
  const band = value < 1_000_000 ? snap(value / 100_000) * 100_000 : snap(value / 1_000_000) * 1_000_000;
  if (band >= 1_000_000) return `$${band / 1_000_000}M`;
  return `$${band / 1000}s`;
}

export function formatPriceRange(min: number | undefined, max: number | undefined): string | null {
  const lo = priceToken(min, "floor");
  const hi = priceToken(max, "floor");
  if (!lo || !hi) return null;
  return lo === hi ? lo : `${lo} - ${hi}`;
}

export function formatSqftRange(min: number | undefined, max: number | undefined): string | null {
  if (!finite(min) || !finite(max)) return null;
  const lo = Math.floor(min / 100) * 100;
  const hi = Math.floor(max / 100) * 100;
  return lo === hi ? commafy(lo) : `${commafy(lo)} - ${commafy(hi)}`;
}

export function formatBedroomRange(min: number | undefined, max: number | undefined): string | null {
  if (!finite(min) || !finite(max)) return null;
  return min === max ? String(min) : `${min} - ${max}`;
}

export function formatGarageRange(min: number | undefined, max: number | undefined): string | null {
  if (!finite(min) || !finite(max)) return null;
  return min === max ? `${min} Car` : `${min} - ${max} Car`;
}

/** "$500s" / "$500k" / "$1M" / "$1.5M" / "$1,500,000" / "750000" -> number. */
export function parsePriceToken(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const s = t.trim().replace(/^\$/, "").replace(/,/g, "");
  let m = /^([0-9]+(?:\.[0-9]+)?)\s*[mM]$/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 1_000_000);
  m = /^([0-9]+(?:\.[0-9]+)?)\s*[ksKS]$/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  m = /^([0-9]+)$/.exec(s);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** "1,200" / "1200" / "3" -> number, for square feet and bedroom tokens. */
export function parseIntToken(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = /^([0-9]+)$/.exec(t.trim().replace(/,/g, ""));
  return m ? parseInt(m[1], 10) : null;
}

/** "2 Car" / "2" / "1.5 Car" -> number of garage spaces. */
export function parseGarageToken(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*(?:[Cc]ars?)?$/.exec(t.trim());
  return m ? parseFloat(m[1]) : null;
}

const sqftToken = (value: number): string => commafy(Math.floor(value / 100) * 100);

/** undefined / null / "" alike, so a neighborhood without data is not rewritten every run. */
const norm = (v: unknown): unknown => (v == null || v === "" ? null : v);

/** "X - Y" (hyphen, en dash or the word "to") into its ends; one token is a collapsed range. */
function splitRange(text: string): { loText: string; hiText: string } | null {
  const parts = text.split(/\s*(?:-|–|\bto\b)\s*/).filter(Boolean);
  if (parts.length === 1) return { loText: parts[0], hiText: parts[0] };
  if (parts.length === 2) return { loText: parts[0], hiText: parts[1] };
  return null;
}

/**
 * Ratchets a hand-curated all-time range outward when the active range's
 * band escapes it, keeping the untouched end's text verbatim; seeds a blank
 * one from the active range. Returns the new text, or null for no change
 * (including an unparseable hand-written value, which is left alone).
 */
export function widenHistoricalRange(
  existingText: unknown,
  activeMin: number | undefined,
  activeMax: number | undefined,
  parseToken: (t: unknown) => number | null,
  formatToken: (v: number) => string | null
): string | null {
  if (activeMin == null || activeMax == null) return null;
  // Compare at band level: format the active ends, then parse them back, so a value inside the same band never churns.
  const activeLoText = formatToken(activeMin);
  const activeHiText = formatToken(activeMax);
  const activeLo = parseToken(activeLoText);
  const activeHi = parseToken(activeHiText);
  if (activeLo == null || activeHi == null || activeLoText == null || activeHiText == null) return null;

  const current = norm(existingText);
  if (current == null) return activeLoText === activeHiText ? activeLoText : `${activeLoText} - ${activeHiText}`;

  const ends = splitRange(String(current));
  if (!ends) return null;
  const lo = parseToken(ends.loText);
  const hi = parseToken(ends.hiText);
  if (lo == null || hi == null) return null;

  const loText = activeLo < lo ? activeLoText : ends.loText;
  const hiText = activeHi > hi ? activeHiText : ends.hiText;
  if (loText === ends.loText && hiText === ends.hiText) return null;
  return loText === hiText ? loText : `${loText} - ${hiText}`;
}

/** The garage range carries one trailing "Car": strip it, ratchet the numbers, put it back on a change. */
export function widenGarageRange(existingText: unknown, activeMin: number | undefined, activeMax: number | undefined): string | null {
  const current = norm(existingText);
  const stripped = current == null ? null : String(current).replace(/\s*[Cc]ars?$/, "");
  const widened = widenHistoricalRange(stripped, activeMin, activeMax, parseGarageToken, (v) => String(v));
  return widened == null ? null : `${widened} Car`;
}

function extend(agg: VillageAggregate, key: "price" | "sqft" | "bed" | "garage", value: number): void {
  const lo = `${key}Min` as const;
  const hi = `${key}Max` as const;
  agg[lo] = agg[lo] == null ? value : Math.min(agg[lo], value);
  agg[hi] = agg[hi] == null ? value : Math.max(agg[hi], value);
}

/** The site's live listings bucketed by their neighborhood's Wix item id. */
export function aggregateLiveListings(rows: LiveListingStatsRow[]): Map<string, VillageAggregate> {
  const map = new Map<string, VillageAggregate>();
  for (const row of rows) {
    if (!row.wix_item_id) continue;
    let agg = map.get(row.wix_item_id);
    if (!agg) {
      agg = { published: 0 };
      map.set(row.wix_item_id, agg);
    }
    agg.published += 1;
    if (finite(row.list_price) && row.list_price > 0) extend(agg, "price", row.list_price);
    if (finite(row.living_area) && Math.round(row.living_area) > 0) extend(agg, "sqft", Math.round(row.living_area));
    if (finite(row.bedrooms) && row.bedrooms > 0) extend(agg, "bed", row.bedrooms);
    if (finite(row.garage_spaces) && row.garage_spaces > 0) extend(agg, "garage", row.garage_spaces);
  }
  return map;
}

/** A Wix DATETIME as the REST API returns it ({ $date } or an ISO string), or null. */
export function readWixDate(value: unknown): Date | null {
  const iso = value && typeof value === "object" && typeof (value as { $date?: unknown }).$date === "string" ? (value as { $date: string }).$date : typeof value === "string" ? value : null;
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

const writeWixDate = (d: Date | null): { $date: string } | null => (d ? { $date: d.toISOString() } : null);

/**
 * The neighborhood rows whose stats changed, ready for a bulk update
 * (every field of the row, so the update replaces nothing else). Pure.
 */
export function planVillageStatsUpdates(rows: WixItemData[], aggregates: Map<string, VillageAggregate>, now: Date): { updates: Array<WixItemData & { _id: string }>; zeroInventory: number } {
  const updates: Array<WixItemData & { _id: string }> = [];
  let zeroInventory = 0;
  for (const row of rows) {
    const id = typeof row._id === "string" ? row._id : null;
    if (!id) continue;
    const agg = aggregates.get(id) ?? { published: 0 };
    const priceRangeActive = formatPriceRange(agg.priceMin, agg.priceMax);
    const squareFeetActive = formatSqftRange(agg.sqftMin, agg.sqftMax);
    const bedroomRangeActive = formatBedroomRange(agg.bedMin, agg.bedMax);
    const garageSizeRangeActive = formatGarageRange(agg.garageMin, agg.garageMax);

    const widenedPrice = widenHistoricalRange(row.priceRange, agg.priceMin, agg.priceMax, parsePriceToken, (v) => priceToken(v, "floor"));
    const widenedSqft = widenHistoricalRange(row.squareFeet, agg.sqftMin, agg.sqftMax, parseIntToken, sqftToken);
    const widenedBeds = widenHistoricalRange(row.bedroomRange, agg.bedMin, agg.bedMax, parseIntToken, (v) => String(v));
    const widenedGarage = widenGarageRange(row.garageSizeRange, agg.garageMin, agg.garageMax);

    // The count drives the ads feed: zeroSince marks the >0 -> 0 transition, is kept
    // verbatim while the count stays 0 (the feed's grace window), and clears on recovery.
    const activeListingCount = agg.published;
    if (activeListingCount === 0) zeroInventory += 1;
    const prevCount = typeof row.activeListingCount === "number" ? row.activeListingCount : null;
    const prevZero = readWixDate(row.zeroSince);
    const zeroSince = activeListingCount > 0 ? null : (prevZero ?? now);

    const changed =
      norm(row.priceRangeActive) !== priceRangeActive ||
      norm(row.squareFeetActive) !== squareFeetActive ||
      norm(row.bedroomRangeActive) !== bedroomRangeActive ||
      norm(row.garageSizeRangeActive) !== garageSizeRangeActive ||
      prevCount !== activeListingCount ||
      (prevZero?.getTime() ?? null) !== (zeroSince?.getTime() ?? null) ||
      widenedPrice != null ||
      widenedSqft != null ||
      widenedBeds != null ||
      widenedGarage != null;
    if (!changed) continue;

    const data: WixItemData & { _id: string } = { ...row, _id: id, priceRangeActive, squareFeetActive, bedroomRangeActive, garageSizeRangeActive, activeListingCount, zeroSince: writeWixDate(zeroSince) };
    for (const key of SYSTEM_FIELDS) delete data[key];
    if (widenedPrice != null) data.priceRange = widenedPrice;
    if (widenedSqft != null) data.squareFeet = widenedSqft;
    if (widenedBeds != null) data.bedroomRange = widenedBeds;
    if (widenedGarage != null) data.garageSizeRange = widenedGarage;
    updates.push(data);
  }
  return { updates, zeroInventory };
}

export interface VillageStatsResult {
  villages: number;
  changed: number;
  written: number;
  failed: number;
  zeroInventory: number;
  /** True when the deadline stopped the writes before every changed row was written. */
  remaining: boolean;
  requests: number;
}

/** Recomputes every neighborhood row's stats from the engine's live rows and writes the ones that changed. */
export async function refreshVillageStatsOnWix(site: LsSite, opts: { deadline: number; now?: Date }): Promise<VillageStatsResult> {
  if (!site.wix_site_id) throw new Error(`site ${site.domain} has no wix_site_id`);
  const now = opts.now ?? new Date();
  const [stats, items] = await Promise.all([loadLiveListingStats(site.id), queryAllItems(site.wix_site_id, site.villages_collection_id)]);
  const rows = items.map((item) => ({ ...item.data, _id: typeof item.data._id === "string" ? item.data._id : item.id }));
  const { updates, zeroInventory } = planVillageStatsUpdates(rows, aggregateLiveListings(stats), now);
  const result: VillageStatsResult = { villages: rows.length, changed: updates.length, written: 0, failed: 0, zeroInventory, remaining: false, requests: 0 };
  for (const part of chunk(updates, WRITE_CHUNK)) {
    if (Date.now() > opts.deadline) {
      result.remaining = true;
      break;
    }
    try {
      const outcome = await bulkUpdateItems(site.wix_site_id, site.villages_collection_id, part);
      result.requests += outcome.requests;
      for (const r of outcome.results) {
        if (r.success) result.written += 1;
        else result.failed += 1;
      }
    } catch (error) {
      result.failed += part.length;
      throw new Error(`neighborhood stats bulk update: ${errorMessage(error)}`);
    }
  }
  return result;
}
