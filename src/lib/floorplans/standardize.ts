// What every plan reads like on the site whatever the builder called it
// (Jeff, 2026-09-20): one of five home types, and a single number for
// bedrooms and bathrooms, the larger end of any range. Applied to every
// engine's output before the diff (sync.ts), so a builder engine can pass
// through whatever its page says. No IO here.

import type { NormalizedPlan } from "@/lib/floorplans/types";

export const HOME_TYPES = ["Single Family Home", "Townhome", "Condominium", "Coach Home", "Attached Villa"] as const;
export type HomeType = (typeof HOME_TYPES)[number];

export const isHomeType = (value: unknown): value is HomeType => HOME_TYPES.includes(value as HomeType);

/**
 * The standard home type a builder's label means, or null when the label
 * says nothing recognizable (the Hub then asks for it). Order matters:
 * "Townhome" before the "home" fallback, "Coach Home" before the
 * condominium words, "detached" before the villa words (a detached villa
 * is a single-family home), villas before the single-family fallback.
 */
export function standardHomeType(raw: string | null | undefined): HomeType | null {
  const t = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (isHomeType(raw?.trim())) return raw!.trim() as HomeType;
  if (/\b(town ?homes?|town ?houses?|towns|row ?homes?|row ?houses?)\b/.test(t)) return "Townhome";
  if (/\b(coach|carriage)\b/.test(t)) return "Coach Home";
  if (/\bcondo/.test(t) || /\b(flats?|apartments?)\b/.test(t)) return "Condominium";
  // A "detached villa" (Taylor Morrison's Detached Villa Golf Collection) stands alone: single-family.
  if (/\bdetached\b/.test(t)) return "Single Family Home";
  if (/\bvillas?\b|\bduplex\b|\bpaired\b|\btwin\b/.test(t)) return "Attached Villa";
  if (/single|detached|estate|\bsfh\b|\bhomes?\b|\bhouses?\b/.test(t)) return "Single Family Home";
  return null;
}

/**
 * Bathrooms from a count of full baths and a count of half baths, as the
 * whole site writes them: the full baths, and ".5" for any half baths at
 * all — four full and one half are "4.5", five full and three half "5.5"
 * (Jeff, 2026-09-24: ".5 everywhere", as every builder on the site already
 * shows it). None gives the full baths alone. Adding a half for each half
 * bath, as Pulte's and Highland's readers did, made three full and two
 * half "4". Null without a count of full baths.
 */
export function bathsOf(full: number | null | undefined, half: number | null | undefined): string | null {
  if (full == null || !Number.isFinite(full)) return null;
  const halves = half != null && Number.isFinite(half) && half > 0;
  if (!Number.isInteger(full) || !halves) return String(full);
  return `${full}.5`;
}

/**
 * The bathrooms Perry's plan pages give as two counts in their strip of
 * facts, "2 Baths 2 Cars 1 Half Baths", as bathsOf writes them. Only that
 * strip: other builders lay their counts out differently — David Weekley's
 * "Bedrooms 3 Full Baths 2 Half Bath 1" puts each number after its label,
 * and read the other way it pairs the wrong numbers — so a page without
 * the strip says nothing here. Pure.
 */
export function bathsStated(text: string): string | null {
  const strip = /(\d+)\s*Baths?\s+\d+\s*Cars?\s+(\d+)\s*Half\s*Baths?\b/i.exec(text);
  return strip ? bathsOf(Number(strip[1]), Number(strip[2])) : null;
}

/**
 * The larger end of a range: "3-4" is "4", "2.5 - 3.5" is "3.5", "3 to 4"
 * is "4". A single number, "3+", or text without two numbers is kept as it
 * came; blank stays blank.
 */
export function largestInRange(text: string | null | undefined): string {
  const s = (text ?? "").trim();
  if (!s) return "";
  const numbers = s.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return s;
  return String(Math.max(...numbers.map(Number)));
}

const FULL_AND_HALF = /(\d+)\s*full(?:\s*baths?)?\s*(?:and|&|\+|,|\/)\s*(\d+)\s*half\b/i;

/**
 * Bathrooms where the words give full and half baths: Kolter's "3 Full and
 * 1 Half Bath" is "3.5" (bathsOf). Read from the words, not from Claude's
 * count of them, which came back "3" one night and "3.5" the next and put
 * the change in the queue both ways (Jeff, 2026-09-26). Null where the
 * words give no such pair. Pure.
 */
export function fullAndHalfBaths(text: string | null | undefined): string | null {
  const pair = FULL_AND_HALF.exec(String(text ?? ""));
  return pair ? bathsOf(Number(pair[1]), Number(pair[2])) : null;
}

/**
 * A count of bedrooms or bathrooms as the sites show one: a number. Homes
 * by Towne gives bedrooms as "4 + Den + Bonus Room" and "3 + Study" (Jeff,
 * 2026-09-26); the rooms besides the bedrooms are not bedrooms, so the
 * count is the number. "4 Bedrooms" is "4", full and half baths are
 * written as bathsOf writes them, a range is its larger end
 * (largestInRange), and a bare "5+" is kept as it came. Pure; exported
 * for tests.
 */
export function roomCount(text: string | null | undefined): string {
  const s = (text ?? "").trim();
  if (!s) return "";
  const split = fullAndHalfBaths(s);
  if (split) return split;
  const count = largestInRange(s.replace(/\s*\+\s*[a-z].*$/i, ""));
  const number = count.match(/^\d+(?:\.\d+)?/)?.[0];
  return number && /[a-z]/i.test(count) ? number : count;
}

/** The numbers builders spell out: "Three Car Garage", "Two 2-Car Garage", "Double Garage". */
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  single: 1,
  two: 2,
  double: 2,
  three: 3,
  triple: 3,
  four: 4,
  quad: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const WORDS = Object.keys(WORD_NUMBERS).join("|");
const NUMBER_WORD = new RegExp(`\\b(${WORDS})\\b`, "gi");

/** So many garages of so many cars each: Stock's "Two 2-Car Garage" is four bays, not two. */
const MULTIPLIED = new RegExp(`\\b(${WORDS})\\s+(\\d+(?:\\.\\d+)?)\\s*-?\\s*car\\b`, "i");

/** The number a token stands for, spelled or written; null when it stands for none. */
function countOf(token: string): number | null {
  const n = /^\d/.test(token) ? Number(token) : WORD_NUMBERS[token.toLowerCase()];
  return Number.isFinite(n) ? n : null;
}

/**
 * Garages as the sites show them: the builder's number of cars, kept as it
 * is, "2.5 car" (Jeff, 2026-09-21: never rounded), the larger end of a
 * range as with beds and baths. A number the builder spelled out counts
 * ("Three Car Garage" is 3), and a label that counts garages rather than
 * cars is multiplied out — Stock writes "Two 2-Car Garage" for the four
 * bays its own icon row shows (Jeff, 2026-09-22). Nothing for nothing, and
 * a label with no number in it ("Yes") is kept as it is for a person to fix.
 */
export function standardGarages(text: string | null | undefined): string | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  const multiplied = s.match(MULTIPLIED);
  const garages = multiplied ? countOf(multiplied[1]) : null;
  const each = multiplied ? Number(multiplied[2]) : 0;
  if (garages && each > 0) return `${Math.round(garages * each * 10) / 10} car`;
  const spelled = s.replace(NUMBER_WORD, (word) => String(WORD_NUMBERS[word.toLowerCase()]));
  const numbers = spelled.match(/\d+(?:\.\d+)?/g);
  if (!numbers) return s;
  return `${Math.max(...numbers.map(Number))} car`;
}

/**
 * What is true of every plan a builder offers, whatever its own pages say.
 * Stock Luxury Homes builds single-family homes and nothing else (Jeff,
 * 2026-09-22), and its pages name no type at all, so the builder's setting
 * says it once rather than a person saying it on every plan.
 */
export interface BuilderDefaults {
  /** The home type every plan of this builder is, when the builder only builds one. */
  homeType?: HomeType | null;
}

/** The builder's settings, as far as standardizing cares; anything unrecognized is ignored. */
export function builderDefaults(config: Record<string, unknown> | null | undefined): BuilderDefaults {
  const homeType = config?.homeType;
  return { homeType: isHomeType(homeType) ? homeType : null };
}

/**
 * What a builder labels as a tour that is not one: an interactive floor
 * plan — a drawing to click around, not a walkthrough of the house.
 * Perry's "3D Tour" button opens one at blu-plan.com (Jeff, 2026-09-22);
 * Neal Communities' at ifp.thebdxinteractive.com, ML3DS's at
 * rifp.ml3ds-iconstage.com and CPS's at planviewer.cpsusa.com (Jeff,
 * 2026-09-25). Here rather than in one engine, because the label is the
 * builder's and any engine can be taken in by it.
 */
const INTERACTIVE_PLAN = /(?:^|\/\/|\.)(?:blu-plan\.com|thebdxinteractive\.com|ml3ds-iconstage\.com|planviewer\.cpsusa\.com)(?:[/:?#]|$)/i;

/**
 * Lennar's own tour links, which its feeds began giving in place of the
 * modsy ones on 2026-09-25: hd.lennar.com/tours/3914/ shows a broken tour,
 * where the modsy link it replaced still works (Jeff, 2026-09-25). One of
 * these is never a plan's tour; the modsy tour it stands for is found by
 * its number where one is known (tours.ts).
 */
const LENNAR_TOUR = /^https?:\/\/hd\.lennar\.com\//i;

/**
 * Addresses that are never a tour, whatever a page calls them: KB's
 * "kb-vu.com/reservu/…" is its reservation app, and a picture or a
 * document is a picture or a document — KB's Plan 1707 at Creekside came
 * back with its front elevation (".../exterior-images-front/…-exterior_4050-1.jpg")
 * as its tour (Jeff, 2026-09-25).
 */
const NOT_A_TOUR = /(?:^|\/\/|\.)kb-vu\.com(?:[/:?#]|$)|\.(?:jpe?g|png|webp|avif|gif|svg|pdf)(?:[?#]|$)/i;

/** The address if it is a tour at all, and nothing if it only says it is. Exported for tests. */
export function asTour(url: string | null | undefined): string | null {
  const address = url?.trim();
  if (!address) return null;
  if (INTERACTIVE_PLAN.test(address) || NOT_A_TOUR.test(address)) return null;
  // Lennar's viewer link names the same tour modsy's does, by the same number.
  const viewer = address.match(/^https?:\/\/hd\.lennar\.com\/apps\/home-viewer\?vtid=(\d+)/i);
  if (viewer) return `https://hd.modsy.com/apps/home-viewer?vtid=${viewer[1]}`;
  return LENNAR_TOUR.test(address) ? null : address;
}

/** Whether an address is an interactive floor plan rather than a tour. Exported for tests. */
export function isInteractivePlan(url: string | null | undefined): boolean {
  return Boolean(url && INTERACTIVE_PLAN.test(url.trim()));
}

/** Words kept in capitals: Roman numerals ("Gateway II", "Cambria IV") and compass points ("NE 12th St"). */
const KEPT_CAPITALS = /^(?:I{1,3}|IV|VI{0,3}|IX|XI{0,3}|N|S|E|W|NE|NW|SE|SW)$/;
/** Words a title keeps small, but for its first. */
const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

/**
 * A plan's or a home's name with no word in capitals, in title case: the
 * builders' feeds give homes as "18355 ARBOR VISTA DR", "12785 JADE
 * EMPRESS LOOP, Unit 202" and "7910 Lake Powell PL", and the sites show
 * none in capitals (Jeff, 2026-09-24). Only a word all in capitals is
 * changed; a Roman numeral, a compass point, a single letter ("Elevation
 * A") and anything with a digit in it ("2546F", "#303") are left as they
 * are. Exported for tests.
 */
export function readableName(name: string): string {
  let first = true;
  return name.replace(/[A-Za-z0-9'’#.&/-]+/g, (word) => {
    const isFirst = first;
    first = false;
    if (/\d/.test(word) || !/[A-Z]{2}/.test(word) || /[a-z]/.test(word)) return word;
    const letters = word.replace(/[^A-Za-z]/g, "");
    if (KEPT_CAPITALS.test(letters)) return word;
    const lower = word.toLowerCase();
    if (!isFirst && SMALL_WORDS.has(lower)) return lower;
    // Each part of "SEA-VIEW" and "O'NEIL" begins with a capital; "BUILDER'S" does not grow one.
    return lower
      .replace(/(^|[-/&])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())
      .replace(/\b([a-z])(['’])([a-z])/gi, (_, a: string, mark: string, b: string) => a.toUpperCase() + mark + b.toUpperCase());
  });
}

/** The last word of a street's name, spelled out or cut short. */
const STREET_WORD =
  "(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|circle|cir|place|pl|terrace|ter|trail|trl|boulevard|blvd|loop|run|cove|cv|path|pass|parkway|pkwy|point|pt|row|glen|bend|crossing|xing|highway|hwy|square|sq|landing|trace|walk)";
const STREET_ADDRESS = new RegExp(`^\\d{1,6}[a-z]?\\s+(?:[a-z0-9'’.&-]+\\s+){0,4}${STREET_WORD}\\.?(?=$|[\\s,#])`, "i");

/**
 * Whether a name is a street address — "12422 Stonegate Trail", "4931
 * Carova Way", "12785 JADE EMPRESS LOOP, Unit 202" — which only a home
 * for sale is named by: a floor plan never is. Medallion's River Preserve
 * Estates lists its plans and its homes on one page, and a run that read
 * two of its homes as plans proposed turning them into base plans (Jeff,
 * 2026-09-26). Exported for tests.
 */
export function namesAnAddress(name: string | null | undefined): boolean {
  return STREET_ADDRESS.test(String(name ?? "").trim());
}

const HOME_LABEL =
  /^(.+?)\s*[-–—|:]\s*(?:move[\s-]*in[\s-]*ready|quick[\s-]*move[\s-]*in|ready\s+now|available\s+now|under\s+construction)\b/i;

/**
 * The plan a home's list label names, where the label is a plan and what
 * state the home is in rather than an address: Kolter's Cresswind cards
 * read "Casey - Move-In Ready" above "18366 Rockport Place", and a run
 * that took the label for the name offered the home again as a new one
 * (Jeff, 2026-09-26). Null where the name says nothing of the kind.
 * Exported for tests.
 */
export function planInHomeLabel(name: string | null | undefined): string | null {
  return String(name ?? "").trim().match(HOME_LABEL)?.[1]?.trim() || null;
}

/** A builder's stand-in for a picture it does not have yet, by its file's name. */
const STAND_IN_PICTURE = /(?:coming[-_ ]?soon|no[-_ ]?image|image[-_ ]?not[-_ ]?available|placeholder)(?=[-_.]|$)/i;

/**
 * Whether a picture is one the site can show: a whole web address, and not
 * a builder's stand-in for a photo it does not have yet. Lennar gives a
 * home with no photos of its own "/images/com/images/version10/default/qmi/
 * ComingSoon.jpg", an address on no host at all, and five homes led with
 * it into the queue as a broken picture (Jeff, 2026-09-24). Exported for
 * tests.
 */
export function showablePicture(url: string | null | undefined): boolean {
  const address = (url ?? "").trim();
  if (!/^https?:\/\/[^\s/]+\/\S*$/i.test(address)) return false;
  let file = address.replace(/[?#].*$/, "");
  file = file.slice(file.lastIndexOf("/") + 1);
  try {
    file = decodeURIComponent(file);
  } catch {
    // left as written
  }
  return !STAND_IN_PICTURE.test(file);
}

/**
 * The plan as the site files it: its name in title case (readableName),
 * standard home type, one number for beds, baths and garages, and only
 * pictures the site can show. A builder that
 * only builds one type has it written in whatever its page said; the
 * builder's own labels are kept in raw either way.
 */
export function standardizePlan(plan: NormalizedPlan, defaults: BuilderDefaults = {}): NormalizedPlan {
  const homeType = defaults.homeType ?? standardHomeType(plan.homeType);
  const garages = standardGarages(plan.garages);
  const tour = asTour(plan.virtualTourUrl);
  const galleryImages = (plan.galleryImages ?? []).filter(showablePicture);
  const shown = new Set(galleryImages);
  const galleryMeta = plan.galleryMeta
    ? Object.fromEntries(Object.entries(plan.galleryMeta).filter(([url]) => shown.has(url)))
    : plan.galleryMeta;
  return {
    ...plan,
    name: readableName(plan.name),
    ...(plan.relatedPlanName ? { relatedPlanName: readableName(plan.relatedPlanName) } : {}),
    galleryImages,
    galleryMeta,
    blueprintImages: (plan.blueprintImages ?? []).filter(showablePicture),
    homeType,
    beds: roomCount(plan.beds),
    baths: roomCount(plan.baths),
    garages,
    virtualTourUrl: tour,
    // A plan whose tour turned out to be an interactive drawing has no
    // still for it either; a plan that never had one is left alone.
    ...(plan.virtualTourUrl && !tour ? { virtualTourImage: null } : {}),
    raw: {
      ...(plan.raw ?? {}),
      ...(plan.homeType && homeType !== plan.homeType ? { homeTypeRaw: plan.homeType } : {}),
      // What the builder said beside the count ("4 + Den + Bonus Room").
      ...(/[a-z]/i.test(plan.beds ?? "") ? { bedsRaw: plan.beds } : {}),
      ...(plan.garages && garages !== plan.garages ? { garagesRaw: plan.garages } : {}),
      ...(plan.virtualTourUrl && !tour
        ? isInteractivePlan(plan.virtualTourUrl)
          ? { interactivePlanUrl: plan.virtualTourUrl }
          : { droppedTourUrl: plan.virtualTourUrl }
        : {}),
    },
  };
}
