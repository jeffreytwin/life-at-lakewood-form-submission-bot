// Per-village price and square footage ranges for the villages collection
// (Jeff, 2026-10-26): what a buyer can get in each neighborhood right now,
// from the site's Floor Plans V2 rows (the plans a builder is selling) and
// its Homes for Sale rows (the live listings), nothing historical. Pure;
// sync.ts loads the rows and writes the fields.
//
// The formats are the ones the Lakewood AmenitiesbyVillage rows already
// carry, because the site's page code filters on them:
//   priceRange          "$300s - $2M+"   (one bucket alone: "$1M+")
//   priceRangeDropdown  "Show All Price Ranges, $300s, $400s, ..., $1M+, $2M+"
//   priceRangeNew       ["$300s", "$400s", ..., "1M+", "2M+"]  (tags; millions drop the $)
//   squareFootageRange  "2,300 - 4,700 square feet"  (nearest 100)
// A bucket is a hundred-thousand up to $999,999 ("$300s" is $300,000 to
// $399,999) and a whole million from there ("$2M+" is $2,000,000 to
// $2,999,999), consecutive from the lowest to the highest price.

export type VillageRowSource = "plan" | "listing";

/** One plan or listing, as loaded for a village. */
export interface VillageRow {
  village: string;
  source: VillageRowSource;
  price: number | null;
  sqft: number | null;
}

/** What is for sale in one village: counts and the raw extremes. */
export interface VillageRange {
  /** The village name as its rows carry it (the first spelling seen). */
  village: string;
  /** villageKey(village): what the rows and the collection's titles are matched on. */
  key: string;
  plans: number;
  listings: number;
  minPrice: number | null;
  maxPrice: number | null;
  minSqft: number | null;
  maxSqft: number | null;
}

/** The four fields written; one is left out when the village has no data for it. */
export interface RangeFields {
  priceRange: string;
  priceRangeDropdown: string;
  priceRangeNew: string[];
  squareFootageRange: string;
}

export const RANGE_FIELD_KEYS: Array<keyof RangeFields> = ["priceRange", "priceRangeDropdown", "priceRangeNew", "squareFootageRange"];

/**
 * Below these a value is a data error (a lot price, a blank read as 0), not
 * a home, and is left out of the range rather than dragging it down.
 */
export const MIN_PLAUSIBLE_PRICE = 100_000;
export const MIN_PLAUSIBLE_SQFT = 300;

/**
 * Village names as matched between the pipeline's rows and the collection's
 * titles: case, stray spaces, dash style and "&" vs "and" do not count.
 * "Azario – Esplanade" and "Azario - Esplanade" are the same village.
 */
export function villageKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/&/g, " and ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function plausiblePrice(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_PLAUSIBLE_PRICE;
}

function plausibleSqft(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_PLAUSIBLE_SQFT;
}

/** The ranges per village, in name order. A village with no plausible price or size still appears, with its counts. */
export function aggregateVillageRanges(rows: VillageRow[]): VillageRange[] {
  const byKey = new Map<string, VillageRange>();
  for (const row of rows) {
    const name = row.village?.trim();
    if (!name) continue;
    const key = villageKey(name);
    let range = byKey.get(key);
    if (!range) {
      range = { village: name, key, plans: 0, listings: 0, minPrice: null, maxPrice: null, minSqft: null, maxSqft: null };
      byKey.set(key, range);
    }
    if (row.source === "plan") range.plans += 1;
    else range.listings += 1;
    if (plausiblePrice(row.price)) {
      range.minPrice = range.minPrice === null ? row.price : Math.min(range.minPrice, row.price);
      range.maxPrice = range.maxPrice === null ? row.price : Math.max(range.maxPrice, row.price);
    }
    if (plausibleSqft(row.sqft)) {
      range.minSqft = range.minSqft === null ? row.sqft : Math.min(range.minSqft, row.sqft);
      range.maxSqft = range.maxSqft === null ? row.sqft : Math.max(range.maxSqft, row.sqft);
    }
  }
  return [...byKey.values()].sort((a, b) => a.village.localeCompare(b.village));
}

/** 1..9 for the hundreds ($100s..$900s), 10 and up for the millions ($1M+ is 10). */
function bucketIndex(price: number): number {
  if (price < 1_000_000) return Math.max(1, Math.floor(price / 100_000));
  return 9 + Math.floor(price / 1_000_000);
}

function bucketLabel(index: number): string {
  return index <= 9 ? `$${index}00s` : `$${index - 9}M+`;
}

/** The bucket a price falls in: "$300s" for $379,900, "$2M+" for $2,349,000. */
export function priceBucket(price: number): string {
  return bucketLabel(bucketIndex(price));
}

/** Every bucket from the lowest price's to the highest's, in order. */
export function priceBuckets(minPrice: number, maxPrice: number): string[] {
  const lo = bucketIndex(Math.min(minPrice, maxPrice));
  const hi = bucketIndex(Math.max(minPrice, maxPrice));
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(bucketLabel(i));
  return out;
}

/** "$300s - $2M+", or the one bucket when both ends share it. */
export function priceRangeText(minPrice: number, maxPrice: number): string {
  const lo = priceBucket(Math.min(minPrice, maxPrice));
  const hi = priceBucket(Math.max(minPrice, maxPrice));
  return lo === hi ? lo : `${lo} - ${hi}`;
}

export function priceRangeDropdown(buckets: string[]): string {
  return ["Show All Price Ranges", ...buckets].join(", ");
}

/** The tag form of the buckets: the hundreds as they are, the millions without the dollar sign ("1M+"). */
export function priceRangeTags(buckets: string[]): string[] {
  return buckets.map((b) => (b.endsWith("M+") ? b.replace(/^\$/, "") : b));
}

/** To the nearest hundred. */
export function roundSqft(sqft: number): number {
  return Math.round(sqft / 100) * 100;
}

function withCommas(n: number): string {
  return n.toLocaleString("en-US");
}

/** "2,300 - 4,700 square feet", or "2,300 square feet" when both ends round the same. */
export function sqftRangeText(minSqft: number, maxSqft: number): string {
  const lo = roundSqft(Math.min(minSqft, maxSqft));
  const hi = roundSqft(Math.max(minSqft, maxSqft));
  return lo === hi ? `${withCommas(lo)} square feet` : `${withCommas(lo)} - ${withCommas(hi)} square feet`;
}

/**
 * The fields a village's range writes. Price fields need a price, the
 * square footage field a size; a village with neither gets nothing (its
 * row is left as it is).
 */
export function rangeFields(range: VillageRange): Partial<RangeFields> {
  const out: Partial<RangeFields> = {};
  if (range.minPrice !== null && range.maxPrice !== null) {
    const buckets = priceBuckets(range.minPrice, range.maxPrice);
    out.priceRange = priceRangeText(range.minPrice, range.maxPrice);
    out.priceRangeDropdown = priceRangeDropdown(buckets);
    out.priceRangeNew = priceRangeTags(buckets);
  }
  if (range.minSqft !== null && range.maxSqft !== null) {
    out.squareFootageRange = sqftRangeText(range.minSqft, range.maxSqft);
  }
  return out;
}

/** Whether two values of a range field say the same thing (tags compare as sets in order). */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => String(v) === String(b[i]));
  }
  return String(a ?? "").trim() === String(b ?? "").trim();
}
