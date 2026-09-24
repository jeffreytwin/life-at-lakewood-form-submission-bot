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
 * What a builder labels as a tour that is not one. Perry Homes puts a "3D
 * Tour" button on its plans that opens an interactive floor plan at
 * blu-plan.com — a drawing to click around, not a walkthrough of the
 * house (Jeff, 2026-09-22). Here rather than in one engine, because the
 * label is the builder's and any engine can be taken in by it.
 */
const NOT_A_TOUR = /(?:^|\/\/|\.)blu-plan\.com(?:[/:?#]|$)/i;

/** The address if it is a tour at all, and nothing if it only says it is. Exported for tests. */
export function asTour(url: string | null | undefined): string | null {
  const address = url?.trim();
  if (!address) return null;
  return NOT_A_TOUR.test(address) ? null : address;
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
    beds: largestInRange(plan.beds),
    baths: largestInRange(plan.baths),
    garages,
    virtualTourUrl: tour,
    // A plan whose tour turned out to be an interactive drawing has no
    // still for it either; a plan that never had one is left alone.
    ...(plan.virtualTourUrl && !tour ? { virtualTourImage: null } : {}),
    raw: {
      ...(plan.raw ?? {}),
      ...(plan.homeType && homeType !== plan.homeType ? { homeTypeRaw: plan.homeType } : {}),
      ...(plan.garages && garages !== plan.garages ? { garagesRaw: plan.garages } : {}),
      ...(plan.virtualTourUrl && !tour ? { interactivePlanUrl: plan.virtualTourUrl } : {}),
    },
  };
}
