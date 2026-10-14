// A person's own change to a floor plan already on the site (Jeff,
// 2026-10-14: "allow the user (or yourself) to queue any floor plan that
// needs to be adjusted"). The Hub only let a plan be edited while the sync
// had something of it waiting in the queue, so a live plan the builder's
// pages had wrong — D.R. Horton's Siesta villa filed as a single-family
// home — had no way to be put right. An adjustment queues the live plan as
// it stands, to be edited in the overlay and approved like any change.
// Pure: the Floor Plans page reads the label and the summary in the browser.

import type { NormalizedPlan } from "@/lib/floorplans/types";

/** The queue's label for an adjustment: its own, so the sync never proposes, withdraws or holds one back. */
export const ADJUSTMENT_LABEL = "adjusted by hand";

/** The run id an adjustment is queued under, followed by when. */
export const ADJUSTMENT_RUN = "adjust:";

type Shown = [field: string, label: string, how: "value" | "changed"];

/** The fields an adjustment can change, in the words the queue row uses. */
const SHOWN: Shown[] = [
  ["name", "name", "value"],
  ["priceDisplay", "price", "value"],
  ["beds", "beds", "value"],
  ["baths", "baths", "value"],
  ["sqft", "sq ft", "value"],
  ["garages", "garages", "value"],
  ["homeType", "home type", "value"],
  ["relatedPlanName", "floor plan", "value"],
  ["score", "score", "value"],
  ["description", "description", "changed"],
  ["virtualTourUrl", "tour", "changed"],
  ["galleryImages", "photos", "changed"],
  ["blueprintImages", "drawings", "changed"],
];

/** A value as the comparison sees it: nothing, a blank and an empty list are the same. */
const bare = (v: unknown): string => {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "";
  return typeof v === "string" ? v.trim() : JSON.stringify(v);
};

const shown = (field: string, v: unknown): string => {
  if (v == null || v === "") return "none";
  if (field === "sqft" && Number.isFinite(Number(v))) return Number(v).toLocaleString("en-US");
  return String(v);
};

/**
 * What an adjustment changes from the plan on the site, for the queue
 * row's "old → new": "home type Single Family Home" → "home type Attached
 * Villa", several joined by "; ". A long text or a gallery is named rather
 * than shown. Both null while it changes nothing yet.
 */
export function adjustmentSummary(
  before: Partial<NormalizedPlan> | null | undefined,
  after: Partial<NormalizedPlan> | null | undefined
): { oldValue: string | null; newValue: string | null } {
  const was = (before ?? {}) as Record<string, unknown>;
  const now = (after ?? {}) as Record<string, unknown>;
  const olds: string[] = [];
  const news: string[] = [];
  for (const [field, label, how] of SHOWN) {
    if (bare(was[field]) === bare(now[field])) continue;
    if (how === "changed") {
      olds.push(label);
      news.push(`new ${label}`);
    } else {
      olds.push(`${label} ${shown(field, was[field])}`);
      news.push(`${label} ${shown(field, now[field])}`);
    }
  }
  return olds.length ? { oldValue: olds.join("; "), newValue: news.join("; ") } : { oldValue: null, newValue: null };
}

/** What goes with a field when it is taken: the number behind a typed price, the plan behind a typed plan name. */
const GOES_WITH: Record<string, string[]> = {
  priceDisplay: ["price", "priceFromHome"],
  relatedPlanName: ["relatedPlanKey", "relatedPlanMatch"],
};

/**
 * What an approved adjustment writes: the plan as it stands when it is
 * written, with only what the person set taken from the queued copy (its
 * edited fields and its score). An adjustment can wait in the queue for
 * days, and a price the sync approved on its own meanwhile stays.
 */
export function adjustedOnto(latest: NormalizedPlan | null, queued: NormalizedPlan): NormalizedPlan {
  if (!latest) return queued;
  const out: Record<string, unknown> = { ...latest };
  const from = queued as unknown as Record<string, unknown>;
  const edited = queued.userEditedFields ?? [];
  for (const field of edited) {
    for (const key of [field, ...(GOES_WITH[field] ?? [])]) {
      if (key in from) out[key] = from[key];
    }
  }
  if ("score" in from) out.score = from.score;
  out.userEditedFields = [...new Set([...(latest.userEditedFields ?? []), ...edited])];
  return out as unknown as NormalizedPlan;
}
