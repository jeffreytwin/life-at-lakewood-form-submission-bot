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
 * A quick move-in's own name without the lot it stands on: SimplyDwell
 * names them for the plan and the homesite, "Hawthorne Homesite 42",
 * "Buttonwood Homesite 145" (Jeff, 2026-09-22). An address is left whole —
 * nothing in "17547 Palmiste Dr" looks like a homesite.
 */
export function planNameOf(name: string): string {
  return name
    .replace(/[\s,·–—-]*\b(?:home ?site|lot|residence|unit)\b\s*#?\s*\d+[A-Za-z]?\b.*$/i, "")
    .replace(/[\s,·–—-]*#\s*\d+[A-Za-z]?\s*$/, "")
    .trim();
}

/**
 * Whether two plan keys name the same plan though the builder spelled one
 * of them differently: SimplyDwell's "Hawthorne Homesite 42" stands on the
 * plan it calls "Hawthorn". One key has to be the other's beginning, and
 * the tail it adds no more than two letters, so "Cedar" and "Cedar 2" stay
 * apart.
 */
export function nearlySameKey(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 5 || !long.startsWith(short)) return false;
  return /^[a-z]{1,2}$/.test(long.slice(short.length));
}

/** A URL with no query, no fragment and one trailing slash, so two spellings of a page compare equal. */
function canonicalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    return u.href;
  } catch {
    return null;
  }
}

/**
 * The page a page sits under: SimplyDwell gives each quick move-in a page
 * beneath its plan's, ".../hawthorn-broadleaf/hawthorne-homesite-42/". The
 * surest tie there is, and it does not care how the builder spelled the
 * name.
 */
function parentUrl(url: string | null | undefined): string | null {
  const canonical = canonicalUrl(url);
  if (!canonical) return null;
  try {
    const u = new URL(canonical);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    u.pathname = `/${parts.slice(0, -1).join("/")}/`;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Ties every quick move-in in a run to its base plan and flags the base
 * plans that have at least one. In order: the engine's own key, the
 * builder's plan id, the base plan's name where the engine read one, the
 * page the quick move-in's page sits under, and last its own name with the
 * homesite taken off it — exactly, then allowing the builder a letter or
 * two ("Hawthorne Homesite 42" stands on "Hawthorn"). A quick move-in
 * whose base plan is not in the run keeps the engine's name for it and is
 * marked unmatched, so the review queue can say so. Pure; order and the
 * other fields are kept.
 */
export function linkQuickMoveIns(plans: NormalizedPlan[]): NormalizedPlan[] {
  const bases = plans.filter((p) => !p.quickMoveIn);
  const byKey = new Map(bases.map((b) => [b.planKey, b] as const));
  const byPlanId = new Map<string, NormalizedPlan>();
  for (const b of bases) {
    const id = planIdOf(b);
    if (id && !byPlanId.has(id)) byPlanId.set(id, b);
  }
  // A page two plans share says nothing about either, so it is dropped:
  // every plan of a builder whose list is one page would share that page.
  const byUrl = new Map<string, NormalizedPlan | null>();
  for (const b of bases) {
    const url = canonicalUrl(b.sourceUrl);
    if (!url) continue;
    byUrl.set(url, byUrl.has(url) ? null : b);
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
    if (!base) {
      const parent = parentUrl(p.sourceUrl);
      const above = parent && parent !== canonicalUrl(p.sourceUrl) ? byUrl.get(parent) : null;
      if (above) {
        base = above;
        matchedBy = "plan-page";
      }
    }
    if (!base) {
      // The quick move-in's own name, less the homesite it stands on.
      const own = normKey(planNameOf(p.name));
      if (own && own !== p.planKey) {
        const exact = byKey.get(own);
        const near = exact ? [exact] : bases.filter((b) => nearlySameKey(b.planKey, own));
        // Only when it points at one plan: a near miss that fits two is a guess.
        if (near.length === 1) {
          base = near[0];
          matchedBy = "plan-name";
        }
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

const hasPrice = (p: NormalizedPlan): boolean =>
  typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0 && text(p.priceDisplay) !== "";

/**
 * A base plan the builder gave no price takes the price of its cheapest
 * quick move-in until the builder prices it (Jeff, 2026-09-20), and says
 * which home it came from. A plan with its own price carries none of that,
 * so a price that arrives clears the marker on the next run. Runs after
 * linkQuickMoveIns; pure.
 */
export function withQuickMoveInPrices(plans: NormalizedPlan[]): NormalizedPlan[] {
  const cheapest = new Map<string, NormalizedPlan>();
  for (const p of plans) {
    if (!p.quickMoveIn || !p.relatedPlanKey || !hasPrice(p)) continue;
    const best = cheapest.get(p.relatedPlanKey);
    if (!best || (p.price as number) < (best.price as number)) cheapest.set(p.relatedPlanKey, p);
  }
  return plans.map((p) => {
    if (p.quickMoveIn) return p;
    // Explicit null, so a marker on the canonical record is cleared by the merge.
    if (hasPrice(p)) return { ...p, priceFromHome: null };
    const home = cheapest.get(p.planKey);
    if (!home) return { ...p, priceFromHome: null };
    return { ...p, price: home.price, priceDisplay: home.priceDisplay, priceFromHome: home.name };
  });
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
