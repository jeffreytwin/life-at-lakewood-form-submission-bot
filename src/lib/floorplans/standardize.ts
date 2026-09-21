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
 * condominium words, villas before the single-family fallback.
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
  if (/\bvillas?\b|\bduplex\b|\bpaired\b|\btwin\b/.test(t)) return "Attached Villa";
  if (/single|detached|estate|\bsfh\b|\bhomes?\b|\bhouses?\b/.test(t)) return "Single Family Home";
  return null;
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

/**
 * Garages as the sites show them: the builder's number of cars, kept as it
 * is, "2.5 car" (Jeff, 2026-09-21: never rounded), the larger end of a
 * range as with beds and baths. Nothing for nothing, and a label with no
 * number in it ("Yes") is kept as it is for a person to fix.
 */
export function standardGarages(text: string | null | undefined): string | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  const numbers = s.match(/\d+(?:\.\d+)?/g);
  if (!numbers) return s;
  return `${Math.max(...numbers.map(Number))} car`;
}

/** The plan as the site files it: standard home type, one number for beds, baths and garages. The builder's own labels are kept in raw. */
export function standardizePlan(plan: NormalizedPlan): NormalizedPlan {
  const homeType = standardHomeType(plan.homeType);
  const garages = standardGarages(plan.garages);
  return {
    ...plan,
    homeType,
    beds: largestInRange(plan.beds),
    baths: largestInRange(plan.baths),
    garages,
    raw: {
      ...(plan.raw ?? {}),
      ...(plan.homeType && homeType !== plan.homeType ? { homeTypeRaw: plan.homeType } : {}),
      ...(plan.garages && garages !== plan.garages ? { garagesRaw: plan.garages } : {}),
    },
  };
}
