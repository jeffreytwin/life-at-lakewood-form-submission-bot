// Per-village price and square footage ranges for the villages collection
// (Jeff, 2026-10-26): what a buyer can get in each neighborhood right now,
// from the site's Floor Plans V2 rows (the plans a builder is selling) and
// its Homes for Sale rows (the live listings), nothing historical. Pure;
// sync.ts loads the rows and writes the fields.
//
// The fields below are named by Lakewood's AmenitiesbyVillage keys and
// carry the formats its rows already use, because the site's page code
// filters on them. Another site's collection names and spells them its own
// way: profiles.ts maps each logical field to that site's key and words
// (Wellen Park's tags read "2 Car" and "Single Family Homes", its home
// types text is one comma-separated line, and it has no dropdown fields),
// and a site's own methodology stays intact where it differs (Jeff,
// 2026-10-27). Lakewood's formats:
//   priceRange          "$300s - $2M+"   (one bucket alone: "$1M+"; both ends in the millions: "$1M - $2M+",
//                       one plus sign, not two, Jeff 2026-10-27)
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
//   hasNewConstruction  true while the village has a floor plan for sale, false otherwise
//                       (Jeff, 2026-10-26: so a buyer can filter to villages with new construction)
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
  /** The source's own words ("Attached Villa", "Townhouse"); homeTypeKind maps them. */
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
  /** The kinds of home for sale, in HOME_TYPE_KINDS order; a profile puts them in the site's words. */
  homeTypes: HomeTypeKind[];
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
  hasNewConstruction: boolean;
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
  "hasNewConstruction",
];

/** The boolean fields, read as booleans off an item. */
export const RANGE_BOOLEAN_KEYS: ReadonlySet<string> = new Set(["hasListingsOrNewConstruction", "hasNewConstruction"]);

/** The one field a village with nothing for sale is written: false, so the villages page can hide it. */
export const AVAILABILITY_FLAG: keyof RangeFields = "hasListingsOrNewConstruction";

/** The Build Your Home button's colour: green with a floor plan for sale, grey without (the collection's own two values). */
export const BUILD_COLOR_FIELD: keyof RangeFields = "buildYourHomeColor";
export const BUILD_COLOR_GREEN = "#2C9E37";
export const BUILD_COLOR_GREY = "#A0A09F";

/** Whether the village has a floor plan for sale, for the new construction filter. */
export const NEW_CONSTRUCTION_FLAG: keyof RangeFields = "hasNewConstruction";

/** What a village with nothing for sale is written: hidden, no new construction, and no plans to build (in the site's grey). */
export function noAvailabilityFields(profile: VillageRangeProfile): Partial<RangeFields> {
  return { hasListingsOrNewConstruction: false, hasNewConstruction: false, buildYourHomeColor: profile.buildColors.grey };
}

/** The tag fields: arrays of strings in Wix. */
export const RANGE_TAG_KEYS: ReadonlySet<string> = new Set(["priceRangeNew", "bedroomsNew", "bathroomsNew", "garagesNew", "homeTypeNew"]);

/** The kinds of home the sites tell apart, in the order their filters list them. */
export const HOME_TYPE_KINDS = ["single-family", "villa", "townhome", "condominium", "coach-home"] as const;
export type HomeTypeKind = (typeof HOME_TYPE_KINDS)[number];

/**
 * The kind a source's home type names: the builders' "Attached Villa" and
 * the MLS's "Villa" are one kind, "Townhouse" is a townhome, a "Garage
 * Condo" is a condominium, a coach home is its own kind (a profile may
 * fold it into condominiums where the site has no coach home filter). Null
 * for a type no site filters on, which is then left out rather than
 * guessed.
 */
export function homeTypeKind(raw: string | null | undefined): HomeTypeKind | null {
  const t = (raw ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!t) return null;
  if (/\bsingle family\b/.test(t) || t === "sfr" || t === "sfh" || t === "detached") return "single-family";
  if (/\bvilla/.test(t)) return "villa";
  if (/\btown ?(home|house)/.test(t)) return "townhome";
  if (/\bcoach home/.test(t) || /\bcarriage home/.test(t)) return "coach-home";
  if (/\bcondo/.test(t)) return "condominium";
  return null;
}

/** How one kind of home reads on a site: its filter tag, its dropdown label (where the site has dropdowns), its display text. */
export interface HomeTypeWords {
  kind: HomeTypeKind;
  tag: string;
  dropdown: string;
  display: string;
}

/**
 * A site's spelling of the range fields: which collection key each
 * logical field lives in (null where the collection has no such field),
 * which item fields carry a village's name, and the words its tags and
 * texts use. profiles.ts holds one per site.
 */
export interface VillageRangeProfile {
  name: string;
  fields: Record<keyof RangeFields, string | null>;
  /** The item fields a village's name may be in, best first. */
  titleKeys: string[];
  /** What follows the number in a garage tag: "" for ["2", "3"], " Car" for ["2 Car", "3 Car"]. */
  garageTagSuffix: string;
  /** What follows the square footage range: " square feet" on every site today; a site may spell it otherwise. */
  sqftSuffix: string;
  /** The Build Your Home button's two colours, as the collection's rows already carry them. */
  buildColors: { green: string; grey: string };
  /**
   * Village names the plans or listings use for a village the collection
   * names otherwise, data name to row name ("Crosswind Ranch" is the row
   * "Crosswind"; "Del Webb Explore North River Ranch" is "Del Webb
   * Explore"). Compared as villageKey.
   */
  villageAliases: Record<string, string>;
  /** The kinds the site filters on, in its order, with its words for each. */
  homeTypes: HomeTypeWords[];
  /** Kinds the site has no filter for, counted as another kind (Lakewood: a coach home is a condominium). */
  foldHomeTypes: Partial<Record<HomeTypeKind, HomeTypeKind>>;
  /** What joins the display text's types: a line break on Lakewood, ", " on Wellen Park. */
  homeTypesSeparator: string;
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
 * titles: case, stray spaces, dash style, apostrophes and "&" vs "and" do
 * not count. "Azario – Esplanade" and "Azario - Esplanade" are the same
 * village; so are "River's Reach" and "Rivers Reach" (Parrish, 2026-10-27).
 */
export function villageKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['‘’]/g, "")
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
    const kind = homeTypeKind(row.homeType);
    if (kind && !range.homeTypes.includes(kind)) range.homeTypes.push(kind);
  }
  for (const range of byKey.values()) {
    range.homeTypes.sort((a, b) => HOME_TYPE_KINDS.indexOf(a) - HOME_TYPE_KINDS.indexOf(b));
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

/**
 * "$300s - $2M+", or the one bucket when both ends share it. When both ends
 * are millions the low end drops its plus sign ("$1M - $2M+"), so the range
 * does not read as two open-ended figures.
 */
export function priceRangeText(minPrice: number, maxPrice: number): string {
  const lo = priceBucket(Math.min(minPrice, maxPrice));
  const hi = priceBucket(Math.max(minPrice, maxPrice));
  if (lo === hi) return lo;
  const low = lo.endsWith("M+") && hi.endsWith("M+") ? lo.slice(0, -1) : lo;
  return `${low} - ${hi}`;
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

/** "2,300 - 4,700 square feet", or "2,300 square feet" when both ends round the same; the suffix is the site's. */
export function sqftRangeText(minSqft: number, maxSqft: number, suffix = " square feet"): string {
  const lo = roundSqft(Math.min(minSqft, maxSqft));
  const hi = roundSqft(Math.max(minSqft, maxSqft));
  return (lo === hi ? withCommas(lo) : `${withCommas(lo)} - ${withCommas(hi)}`) + suffix;
}

/**
 * The rows with each alias of the profile's replaced by the village name
 * the collection uses, so a village the sources name two ways is one range.
 */
export function applyVillageAliases(rows: VillageRow[], profile: VillageRangeProfile): VillageRow[] {
  const aliases = new Map(Object.entries(profile.villageAliases).map(([from, to]) => [villageKey(from), to]));
  if (aliases.size === 0) return rows;
  return rows.map((row) => {
    const to = aliases.get(villageKey(row.village ?? ""));
    return to ? { ...row, village: to } : row;
  });
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
 * The site's words for the kinds of home a village has: folded where the
 * site has no filter for a kind, in the site's order, each once.
 */
export function homeTypeWords(kinds: HomeTypeKind[], profile: VillageRangeProfile): HomeTypeWords[] {
  const present = new Set(kinds.map((k) => profile.foldHomeTypes[k] ?? k));
  return profile.homeTypes.filter((w) => present.has(w.kind));
}

/**
 * The fields a village's range writes, as logical fields (the profile's
 * `fields` says where each lives on the site, or that it does not). Each
 * group needs its own data: price fields a price, the square footage field
 * a size, bedroom fields a bedroom count, and so on; a group with no data
 * is left out, and a village with no data at all gets nothing (its row is
 * left as it is). A tag list is never written empty.
 */
export function rangeFields(range: VillageRange, profile: VillageRangeProfile): Partial<RangeFields> {
  const out: Partial<RangeFields> = {};
  // A range exists only for a village with at least one plan or listing.
  if (range.plans + range.listings > 0) out.hasListingsOrNewConstruction = true;
  out.hasNewConstruction = range.plans > 0;
  out.buildYourHomeColor = range.plans > 0 ? profile.buildColors.green : profile.buildColors.grey;
  if (range.minPrice !== null && range.maxPrice !== null) {
    const buckets = priceBuckets(range.minPrice, range.maxPrice);
    out.priceRange = priceRangeText(range.minPrice, range.maxPrice);
    out.priceRangeDropdown = priceRangeDropdown(buckets);
    out.priceRangeNew = priceRangeTags(buckets);
  }
  if (range.minSqft !== null && range.maxSqft !== null) {
    out.squareFootageRange = sqftRangeText(range.minSqft, range.maxSqft, profile.sqftSuffix);
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
    const tags = wholeNumberTags(range.minGarages, range.maxGarages).map((n) => `${n}${profile.garageTagSuffix}`);
    out.garages = countRangeText(range.minGarages, range.maxGarages, " Car");
    if (tags.length) {
      out.garagesNew = tags;
      out.garagesDropdown = optionsDropdown(tags);
    }
  }
  const words = homeTypeWords(range.homeTypes, profile);
  if (words.length) {
    out.homeTypeNew = words.map((w) => w.tag);
    out.homeTypesDropdown = optionsDropdown(words.map((w) => w.dropdown));
    out.homeTypes = words.map((w) => w.display).join(profile.homeTypesSeparator);
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
