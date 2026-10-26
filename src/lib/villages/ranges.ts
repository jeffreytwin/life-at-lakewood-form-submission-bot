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
//   bedrooms            "2 - 6" (one value alone: "3")
//   bedroomsNew         ["2", "3", "4", "5", "6"]   (tags, every whole number low to high)
//   bedroomsDropdown    "2, 3, 4, 5, 6, Show All"
//   bathrooms           "2 - 4.5"  (halves kept)
//   bathroomsNew        ["2", "3", "4"]   (whole numbers only: floor of each end)
//   bathroomsDropdown   "2, 3, 4, Show All"
//   garages             "2 - 3 Car" (one value alone: "3 Car")
//   garagesNew          ["2", "3"]   (tags; a 0-car low end is not a tag)
//   garagesDropdown     "2, 3, Show All"
//   homeTypeNew         ["Single Family Home", "Villa", "Townhome", "Condominium"]  (the page's filter values)
//   homeTypesDropdown   "Single Family Home, Attached Villas, Townhomes, Condominiums, Show All"
//   homeTypes           "Single Family\nVillas\nTownhomes\nCondominiums"  (the display text, one type a line)
//   hasListingsOrNewConstruction  true while the village has a plan or a listing for sale, false otherwise
//                       (Jeff, 2026-10-26: the villages page hides a village that reads false)
//   buildYourHomeColor  "#2C9E37" (green) while the village has a floor plan for sale, "#A0A09F" (grey) otherwise
//                       (Jeff, 2026-10-26: the Build Your Home button's colour, in the collection's own two values)
// A price bucket is a hundred-thousand up to $999,999 ("$300s" is $300,000
// to $399,999) and a whole million from there ("$2M+" is $2,000,000 to
// $2,999,999), consecutive from the lowest to the highest price. (Jeff,
// 2026-10-26: the extra fields let a buyer narrow villages by bedrooms,
// bathrooms, garages and home type.)

export type VillageRowSource = "plan" | "listing";

/** One plan or listing, as loaded for a village. Null where the source does not say. */
export interface VillageRow {
  village: string;
  source: VillageRowSource;
  price: number | null;
  sqft: number | null;
  beds?: number | null;
  baths?: number | null;
  /** Garage bays; 0 when the home is known to have none. */
  garages?: number | null;
  /** The source's own words ("Attached Villa", "Townhouse"); homeTypeTag maps them. */
  homeType?: string | null;
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
  minBeds: number | null;
  maxBeds: number | null;
  minBaths: number | null;
  maxBaths: number | null;
  minGarages: number | null;
  maxGarages: number | null;
  /** The page's filter values, in HOME_TYPE_ORDER. */
  homeTypes: HomeTypeTag[];
}

/** The fields written; a group is left out when the village has no data for it. */
export interface RangeFields {
  priceRange: string;
  priceRangeDropdown: string;
  priceRangeNew: string[];
  squareFootageRange: string;
  bedrooms: string;
  bedroomsNew: string[];
  bedroomsDropdown: string;
  bathrooms: string;
  bathroomsNew: string[];
  bathroomsDropdown: string;
  garages: string;
  garagesNew: string[];
  garagesDropdown: string;
  homeTypeNew: string[];
  homeTypesDropdown: string;
  homeTypes: string;
  hasListingsOrNewConstruction: boolean;
  buildYourHomeColor: string;
}

export const RANGE_FIELD_KEYS: Array<keyof RangeFields> = [
  "priceRange",
  "priceRangeDropdown",
  "priceRangeNew",
  "squareFootageRange",
  "bedrooms",
  "bedroomsNew",
  "bedroomsDropdown",
  "bathrooms",
  "bathroomsNew",
  "bathroomsDropdown",
  "garages",
  "garagesNew",
  "garagesDropdown",
  "homeTypeNew",
  "homeTypesDropdown",
  "homeTypes",
  "hasListingsOrNewConstruction",
  "buildYourHomeColor",
];

/** The one field a village with nothing for sale is written: false, so the villages page can hide it. */
export const AVAILABILITY_FLAG: keyof RangeFields = "hasListingsOrNewConstruction";

/** The Build Your Home button's colour: green with a floor plan for sale, grey without (the collection's own two values). */
export const BUILD_COLOR_FIELD: keyof RangeFields = "buildYourHomeColor";
export const BUILD_COLOR_GREEN = "#2C9E37";
export const BUILD_COLOR_GREY = "#A0A09F";

/** What a village with nothing for sale is written: hidden, and no plans to build. */
export const NO_AVAILABILITY_FIELDS: Partial<RangeFields> = { hasListingsOrNewConstruction: false, buildYourHomeColor: BUILD_COLOR_GREY };

/** The tag fields: arrays of strings in Wix. */
export const RANGE_TAG_KEYS: ReadonlySet<string> = new Set(["priceRangeNew", "bedroomsNew", "bathroomsNew", "garagesNew", "homeTypeNew"]);

/** The page's home type filter values, in the order the dropdown lists them. */
export const HOME_TYPE_ORDER = ["Single Family Home", "Villa", "Townhome", "Condominium"] as const;
export type HomeTypeTag = (typeof HOME_TYPE_ORDER)[number];

/** How each home type reads in homeTypesDropdown. */
export const HOME_TYPE_DROPDOWN_LABEL: Record<HomeTypeTag, string> = {
  "Single Family Home": "Single Family Home",
  Villa: "Attached Villas",
  Townhome: "Townhomes",
  Condominium: "Condominiums",
};

/** How each home type reads in the homeTypes display text, one a line. */
export const HOME_TYPE_DISPLAY_LABEL: Record<HomeTypeTag, string> = {
  "Single Family Home": "Single Family",
  Villa: "Villas",
  Townhome: "Townhomes",
  Condominium: "Condominiums",
};

/**
 * The filter value a source's home type maps to: the builders' "Attached
 * Villa" and the MLS's "Villa" are the one tag, "Townhouse" is "Townhome",
 * a coach home is a condominium. Null for a type the page has no filter
 * for, which is then left out rather than guessed.
 */
export function homeTypeTag(raw: string | null | undefined): HomeTypeTag | null {
  const t = (raw ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!t) return null;
  if (/\bsingle family\b/.test(t) || t === "sfr" || t === "sfh" || t === "detached") return "Single Family Home";
  if (/\bvilla/.test(t)) return "Villa";
  if (/\btown ?(home|house)/.test(t)) return "Townhome";
  if (/\bcondo/.test(t) || /\bcoach home/.test(t) || /\bcarriage home/.test(t)) return "Condominium";
  return null;
}

/**
 * Below these a value is a data error (a lot price, a blank read as 0), not
 * a home, and is left out of the range rather than dragging it down.
 */
export const MIN_PLAUSIBLE_PRICE = 100_000;
export const MIN_PLAUSIBLE_SQFT = 300;
/** Beyond these a count is a typo or a parse of the wrong number, not a home. */
export const MAX_PLAUSIBLE_BEDS = 12;
export const MAX_PLAUSIBLE_BATHS = 12;
export const MAX_PLAUSIBLE_GARAGES = 8;

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

function plausibleCount(value: number | null | undefined, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function widen(range: VillageRange, lo: "minBeds" | "minBaths" | "minGarages", hi: "maxBeds" | "maxBaths" | "maxGarages", value: number) {
  range[lo] = range[lo] === null ? value : Math.min(range[lo] as number, value);
  range[hi] = range[hi] === null ? value : Math.max(range[hi] as number, value);
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
      range = {
        village: name,
        key,
        plans: 0,
        listings: 0,
        minPrice: null,
        maxPrice: null,
        minSqft: null,
        maxSqft: null,
        minBeds: null,
        maxBeds: null,
        minBaths: null,
        maxBaths: null,
        minGarages: null,
        maxGarages: null,
        homeTypes: [],
      };
      byKey.set(key, range);
    }
    if (row.source === "plan") range.plans += 1;
    else range.listings += 1;
    const priced = plausiblePrice(row.price);
    const sized = plausibleSqft(row.sqft);
    if (plausiblePrice(row.price)) {
      range.minPrice = range.minPrice === null ? row.price : Math.min(range.minPrice, row.price);
      range.maxPrice = range.maxPrice === null ? row.price : Math.max(range.maxPrice, row.price);
    }
    if (plausibleSqft(row.sqft)) {
      range.minSqft = range.minSqft === null ? row.sqft : Math.min(range.minSqft, row.sqft);
      range.maxSqft = range.maxSqft === null ? row.sqft : Math.max(range.maxSqft, row.sqft);
    }
    // Counts and the home type come from homes alone: a row with neither a
    // plausible price nor a plausible size (a lot, a blank read) says
    // nothing about bedrooms or garages either.
    if (!priced && !sized) continue;
    if (plausibleCount(row.beds, 1, MAX_PLAUSIBLE_BEDS)) widen(range, "minBeds", "maxBeds", row.beds);
    if (plausibleCount(row.baths, 1, MAX_PLAUSIBLE_BATHS)) widen(range, "minBaths", "maxBaths", row.baths);
    if (plausibleCount(row.garages, 0, MAX_PLAUSIBLE_GARAGES)) widen(range, "minGarages", "maxGarages", row.garages);
    const tag = homeTypeTag(row.homeType);
    if (tag && !range.homeTypes.includes(tag)) range.homeTypes.push(tag);
  }
  for (const range of byKey.values()) {
    range.homeTypes.sort((a, b) => HOME_TYPE_ORDER.indexOf(a) - HOME_TYPE_ORDER.indexOf(b));
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

/** A number as the site writes it: "2", "2.5", never "2.50". */
function plain(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** "2 - 6", or "3" when both ends agree; with a suffix, "2 - 3 Car". */
export function countRangeText(min: number, max: number, suffix = ""): string {
  const lo = plain(Math.min(min, max));
  const hi = plain(Math.max(min, max));
  return (lo === hi ? lo : `${lo} - ${hi}`) + suffix;
}

/** Every whole number from the floor of the low end to the floor of the high end, from `floor` up. */
export function wholeNumberTags(min: number, max: number, floor = 1): string[] {
  const lo = Math.max(floor, Math.floor(Math.min(min, max)));
  const hi = Math.floor(Math.max(min, max));
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(String(i));
  return out;
}

/** "2, 3, 4, Show All": the tags, then the reset option the page's older dropdowns end with. */
export function optionsDropdown(values: string[]): string {
  return [...values, "Show All"].join(", ");
}

/**
 * The fields a village's range writes. Each group needs its own data:
 * price fields a price, the square footage field a size, bedroom fields a
 * bedroom count, and so on; a group with no data is left out, and a
 * village with no data at all gets nothing (its row is left as it is). A
 * tag list is never written empty.
 */
export function rangeFields(range: VillageRange): Partial<RangeFields> {
  const out: Partial<RangeFields> = {};
  // A range exists only for a village with at least one plan or listing.
  if (range.plans + range.listings > 0) out.hasListingsOrNewConstruction = true;
  out.buildYourHomeColor = range.plans > 0 ? BUILD_COLOR_GREEN : BUILD_COLOR_GREY;
  if (range.minPrice !== null && range.maxPrice !== null) {
    const buckets = priceBuckets(range.minPrice, range.maxPrice);
    out.priceRange = priceRangeText(range.minPrice, range.maxPrice);
    out.priceRangeDropdown = priceRangeDropdown(buckets);
    out.priceRangeNew = priceRangeTags(buckets);
  }
  if (range.minSqft !== null && range.maxSqft !== null) {
    out.squareFootageRange = sqftRangeText(range.minSqft, range.maxSqft);
  }
  if (range.minBeds !== null && range.maxBeds !== null) {
    const tags = wholeNumberTags(range.minBeds, range.maxBeds);
    out.bedrooms = countRangeText(range.minBeds, range.maxBeds);
    if (tags.length) {
      out.bedroomsNew = tags;
      out.bedroomsDropdown = optionsDropdown(tags);
    }
  }
  if (range.minBaths !== null && range.maxBaths !== null) {
    const tags = wholeNumberTags(range.minBaths, range.maxBaths);
    out.bathrooms = countRangeText(range.minBaths, range.maxBaths);
    if (tags.length) {
      out.bathroomsNew = tags;
      out.bathroomsDropdown = optionsDropdown(tags);
    }
  }
  if (range.minGarages !== null && range.maxGarages !== null) {
    const tags = wholeNumberTags(range.minGarages, range.maxGarages);
    out.garages = countRangeText(range.minGarages, range.maxGarages, " Car");
    if (tags.length) {
      out.garagesNew = tags;
      out.garagesDropdown = optionsDropdown(tags);
    }
  }
  if (range.homeTypes.length) {
    out.homeTypeNew = [...range.homeTypes];
    out.homeTypesDropdown = optionsDropdown(range.homeTypes.map((t) => HOME_TYPE_DROPDOWN_LABEL[t]));
    out.homeTypes = range.homeTypes.map((t) => HOME_TYPE_DISPLAY_LABEL[t]).join("\n");
  }
  return out;
}

/** Whether two values of a range field say the same thing (tags compare as sets in order). */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => String(v) === String(b[i]));
  }
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();
  // A colour is the same colour whatever the case of its hex digits.
  if (/^#[0-9a-f]{3,8}$/i.test(left) && /^#[0-9a-f]{3,8}$/i.test(right)) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}
