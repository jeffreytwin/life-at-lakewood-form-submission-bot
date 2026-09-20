// A quick move-in that stands in for its floor plan (Jeff, 2026-09-20).
// Quick move-ins only show on the sites under their base plan, so a home of
// a plan the builder no longer lists has nowhere to appear. A person asks
// for the plan to be created from the home (the queue's edit overlay), the
// decision is remembered (fp_stand_in_plans, migration 069), and every Run
// builds the plan again from the homes that name it, so it follows their
// prices and pictures and leaves through the removal queue when the last of
// them sells. A real plan of the same name, once the builder lists it again,
// takes the same row and the rule goes quiet. No IO here; sync.ts and the
// stand-in route call these.

import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";

export interface StandInRule {
  /** The floor plan's key: what a real plan of the same name would carry. */
  planKey: string;
  planName: string;
  /** The quick move-in the person clicked on, kept so a home the engine gave no plan name still counts. */
  sourcePlanKey: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** The base plan's name as the engine or a person recorded it on a quick move-in. */
export function relatedNameOf(p: NormalizedPlan): string {
  return text(p.relatedPlanName) || text(p.raw?.relatedPlan);
}

/** The quick move-ins that belong to the rule's plan: named for it, or the one the rule was made from. */
export function homesOfPlan(rule: StandInRule, plans: NormalizedPlan[]): NormalizedPlan[] {
  return plans.filter(
    (p) => p.quickMoveIn && (p.planKey === rule.sourcePlanKey || normKey(relatedNameOf(p)) === rule.planKey)
  );
}

const priceOf = (p: NormalizedPlan): number | null =>
  typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0 ? p.price : null;

/**
 * The floor plan its homes stand in for: the pictures, drawings, description
 * and tour of the home with the most photos, its specs, and the lowest of
 * the homes' prices (it is the only home of the plan left, or the cheapest).
 * Drawings from the other homes follow. No score: a person sets it, or the
 * remembered one comes back (scores.ts). Null without a home.
 */
export function standInPlan(rule: StandInRule, homes: NormalizedPlan[]): NormalizedPlan | null {
  if (!homes.length) return null;
  const richest = [...homes].sort((a, b) => b.galleryImages.length - a.galleryImages.length)[0];
  const priced = homes.filter((h) => priceOf(h) !== null).sort((a, b) => priceOf(a)! - priceOf(b)!);
  const cheapest = priced[0] ?? null;
  const first = <T>(pick: (h: NormalizedPlan) => T | null | undefined): T | null => {
    for (const h of [richest, ...homes]) {
      const v = pick(h);
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return null;
  };
  const blueprintImages = [...new Set(homes.flatMap((h) => h.blueprintImages))];
  const { relatedPlanKey: _k, relatedPlanName: _n, relatedPlanMatch: _m, ...base } = richest;
  void _k; void _n; void _m;
  return {
    ...base,
    planKey: rule.planKey,
    name: rule.planName,
    price: cheapest ? priceOf(cheapest) : null,
    priceDisplay: cheapest?.priceDisplay ?? null,
    beds: first((h) => h.beds) ?? "",
    baths: first((h) => h.baths) ?? "",
    sqft: first((h) => h.sqft),
    garages: first((h) => h.garages),
    homeType: first((h) => h.homeType),
    quickMoveIn: false,
    comingSoon: false,
    galleryImages: richest.galleryImages,
    galleryMeta: richest.galleryMeta,
    blueprintImages: [...richest.blueprintImages, ...blueprintImages.filter((u) => !richest.blueprintImages.includes(u))],
    description: first((h) => h.description),
    virtualTourUrl: first((h) => h.virtualTourUrl),
    virtualTourImage: first((h) => h.virtualTourImage),
    hasQuickMoveIns: true,
    score: null,
    userEditedFields: [],
    standInFor: homes.map((h) => h.name),
    raw: { ...(richest.raw ?? {}), standInFor: homes.map((h) => h.name) },
  };
}

/**
 * A run's plans with the stand-in plans added: one for each rule whose plan
 * the builder does not list and whose homes are on offer. Each such home is
 * given the plan's name where the engine gave none, so linkQuickMoveIns ties
 * it to the stand-in. A rule whose plan the builder lists again does
 * nothing; one whose homes have all sold adds nothing, and the plan then
 * leaves through the removal queue.
 */
export function withStandIns(plans: NormalizedPlan[], rules: StandInRule[]): { plans: NormalizedPlan[]; standIns: NormalizedPlan[] } {
  if (!rules.length) return { plans, standIns: [] };
  const listed = new Set(plans.filter((p) => !p.quickMoveIn).map((p) => p.planKey));
  const named = new Map<string, string>();
  const standIns: NormalizedPlan[] = [];
  for (const rule of rules) {
    if (listed.has(rule.planKey)) continue;
    const homes = homesOfPlan(rule, plans);
    const plan = standInPlan(rule, homes);
    if (!plan) continue;
    standIns.push(plan);
    // A home named for the plan links by that name; the home the rule was
    // made from links by the rule's name whatever the engine called its plan.
    for (const h of homes) if (normKey(relatedNameOf(h)) !== rule.planKey) named.set(h.planKey, rule.planName);
  }
  const withNames = plans.map((p) =>
    named.has(p.planKey) ? { ...p, relatedPlanName: named.get(p.planKey), raw: { ...(p.raw ?? {}), relatedPlan: named.get(p.planKey) } } : p
  );
  return { plans: [...withNames, ...standIns], standIns };
}
