// A home for sale the builder marks sold is no longer for sale (Jeff,
// 2026-09-28). Kolter's Cresswind list keeps its sold homes among the
// rest, each card led by "SOLD" ("SOLD, Lido | Key Collection Homesite
// 562, 2,383 Total Sq. Ft. …"), and its page puts a SOLD ribbon on the
// photo; 18340 Rockport Place was read as on offer and a new photo of it
// proposed. Left out of the run, a sold home is no longer seen, and its
// row comes up for removal as any home's does. No IO.

import type { NormalizedPlan } from "@/lib/floorplans/types";

/** A card or label that opens by saying the home is sold or spoken for: "SOLD, Lido | …", "Under Contract - …". */
const SOLD_LABEL = /^\s*(?:sold|under\s+contract|sale\s+pending|pending\s+sale|pending)\s*(?:[,|:–—-]|$)/i;

/** Whether a line of a card says the home is sold. Pure; exported for tests. */
export function saysSold(text: string | null | undefined): boolean {
  return SOLD_LABEL.test(String(text ?? ""));
}

/** Whether a home for sale is marked sold: by its own page (raw.sold), or by the card that listed it. Pure; exported for tests. */
export function isSoldHome(plan: NormalizedPlan): boolean {
  if (!plan.quickMoveIn) return false;
  const featuresLine = typeof plan.raw?.featuresLine === "string" ? plan.raw.featuresLine : null;
  return plan.raw?.sold === true || saysSold(plan.name) || saysSold(plan.description) || saysSold(featuresLine);
}

/** The run's plans and homes without the homes marked sold. Pure. */
export function withoutSoldHomes(plans: NormalizedPlan[]): NormalizedPlan[] {
  return plans.filter((plan) => !isSoldHome(plan));
}
