// Quick move-ins the way Wellen Park and Parrish file them (read from their
// FloorPlans collections, 2026-09-19; docs/WIX_COLLECTIONS.md "Quick
// move-ins"): a quick move-in is its own row, named by its street address,
// carrying little more than a price, one picture, a description and the
// name of the base plan it is built from (relatedFloorPlanQuickMoveInOnly).
// The base plan's row carries the "quick move-ins available" flag, the
// badge and the status dot, and the site lists the quick move-ins under it.
//
// This module ties each quick move-in to its base plan and marks the base
// plans that have one. It runs on every engine's output, so an engine only
// has to record what it knows: the builder's plan id, the plan's name.

import { normKey, type NormalizedPlan, type RelatedPlanMatch } from "@/lib/floorplans/types";

/** The badge the freelancers put on every base plan with quick move-ins (the same file on Wellen Park and Parrish). */
export const QUICK_MOVE_IN_BADGE = "https://static.wixstatic.com/media/28c2d7_1e474c9af37440efa879388e9827b4a9~mv2.png";
/** The status dot beside the plan's name: one colour with quick move-ins, another without. */
export const STATUS_DOT_QUICK_MOVE_INS = "https://static.wixstatic.com/media/d0be81_f345a9c85f234f6b8f240bbdefa0ed9b~mv2.png";
export const STATUS_DOT_NEW_CONSTRUCTION = "https://static.wixstatic.com/media/d0be81_ad8e51464ee34d4b86f4b80584e8367a~mv2.png";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** The builder's own id for the plan a model is built from, when the engine recorded one (Toll: masterPlanID). */
function planIdOf(p: NormalizedPlan): string {
  const raw = p.raw ?? {};
  return text(raw.masterPlanID ?? raw.planId ?? raw.basePlanId);
}

/** The base plan's name as the engine saw it (Toll: modelName; Mattamy and the MPC engine: raw.relatedPlan). */
function relatedNameOf(p: NormalizedPlan): string {
  return text(p.relatedPlanName) || text(p.raw?.relatedPlan);
}

/**
 * Ties every quick move-in in a run to its base plan (by the engine's own
 * key, else the builder's plan id, else the plan's name) and flags the base
 * plans that have at least one. A quick move-in whose base plan is not in
 * the run keeps the engine's name for it and is marked unmatched, so the
 * review queue can say so. Pure; order and the other fields are kept.
 */
export function linkQuickMoveIns(plans: NormalizedPlan[]): NormalizedPlan[] {
  const bases = plans.filter((p) => !p.quickMoveIn);
  const byKey = new Map(bases.map((b) => [b.planKey, b] as const));
  const byPlanId = new Map<string, NormalizedPlan>();
  for (const b of bases) {
    const id = planIdOf(b);
    if (id && !byPlanId.has(id)) byPlanId.set(id, b);
  }
  const children = new Map<string, number>();

  const linked = plans.map((p) => {
    if (!p.quickMoveIn) return p;
    let base: NormalizedPlan | undefined;
    let matchedBy: RelatedPlanMatch = "unmatched";
    if (p.relatedPlanKey && byKey.has(p.relatedPlanKey)) {
      base = byKey.get(p.relatedPlanKey);
      matchedBy = "extractor";
    }
    if (!base) {
      const id = planIdOf(p);
      if (id && byPlanId.has(id)) {
        base = byPlanId.get(id);
        matchedBy = "plan-id";
      }
    }
    if (!base) {
      const name = relatedNameOf(p);
      if (name && byKey.has(normKey(name))) {
        base = byKey.get(normKey(name));
        matchedBy = "plan-name";
      }
    }
    if (base) children.set(base.planKey, (children.get(base.planKey) ?? 0) + 1);
    return {
      ...p,
      relatedPlanKey: base?.planKey ?? null,
      relatedPlanName: base?.name ?? (relatedNameOf(p) || null),
      relatedPlanMatch: matchedBy,
    };
  });

  return linked.map((p) => (p.quickMoveIn ? p : { ...p, hasQuickMoveIns: (children.get(p.planKey) ?? 0) > 0 }));
}

/**
 * The price bracket tag the site filters on: "$400s" for $419,990, "1M+"
 * from a million up, "Custom Pricing" when the builder gives no price
 * (Wellen Park's wording), nothing under $100k.
 */
export function priceTagOf(price: number | null | undefined): string | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return "Custom Pricing";
  if (price >= 1_000_000) return "1M+";
  if (price < 100_000) return null;
  return `$${Math.floor(price / 100_000)}00s`;
}

/**
 * The fields that say whether a base plan has quick move-ins, exactly as the
 * freelancers keep them: the boolean, the "QUICK MOVE-INS BELOW" banner text,
 * the badge picture and the status dot, plus the price bracket tag. A quick
 * move-in row carries none of these (they are blank on Wellen Park and Parrish).
 */
export function basePlanMarkers(rec: {
  quickMoveIn: boolean;
  hasQuickMoveIns?: boolean;
  price: number | null;
}): Record<string, unknown> {
  if (rec.quickMoveIn) return {};
  const has = rec.hasQuickMoveIns === true;
  const tag = priceTagOf(rec.price);
  return {
    quickMoveInAvailable: has,
    newConstructionOrMoveIn: has ? "QUICK MOVE-INS BELOW" : "NEW CONSTRUCTION",
    constructionDot: has ? STATUS_DOT_QUICK_MOVE_INS : STATUS_DOT_NEW_CONSTRUCTION,
    quickMoveInImage: has ? QUICK_MOVE_IN_BADGE : null,
    floorPlanPriceTags: tag ? [tag] : [],
  };
}
