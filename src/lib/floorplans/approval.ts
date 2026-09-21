import { speaksAsOwner } from "@/lib/floorplans/description";

// What has to be true before a queued change goes to the site, beyond a
// person saying yes. No IO here.
/**
 * What a floor plan must carry before it is approved (Jeff, 2026-09-19 for
 * the score, 2026-09-20 for the rest): the sites filter and sort on these,
 * so a row without them is a row the site cannot place. A quick move-in's
 * row shows only its price, so that is all it needs.
 */
const REQUIRED: [key: string, label: string][] = [
  ["priceDisplay", "a price"],
  ["beds", "bedrooms"],
  ["baths", "bathrooms"],
  ["sqft", "square feet"],
  ["garages", "garages"],
  ["homeType", "a home type"],
];

const present = (v: unknown): boolean =>
  typeof v === "number" ? Number.isFinite(v) && v > 0 : typeof v === "string" ? v.trim() !== "" : false;

/** What a record still lacks before approval, in the words the queue shows: "a price", "bedrooms", "a score". */
export function missingFields(record: unknown): string[] {
  const rec = (record ?? {}) as Record<string, unknown>;
  const required = rec.quickMoveIn === true ? REQUIRED.slice(0, 1) : REQUIRED;
  const missing = required.filter(([key]) => !present(rec[key])).map(([, label]) => label);
  if (rec.quickMoveIn !== true && !(typeof rec.score === "number" && Number.isFinite(rec.score))) missing.push("a score");
  // A quick move-in shows on the sites only under its floor plan (Jeff, 2026-09-21):
  // one the run does not know needs a plan created from it, or named, first.
  if (rec.quickMoveIn === true && rec.relatedPlanMatch === "unmatched") {
    missing.push("a floor plan to file it under (create one from this home, or name one the site has)");
  }
  // A description that speaks as the plan's owner reads as ours on the site (description.ts).
  if (typeof rec.description === "string" && speaksAsOwner(rec.description)) missing.push('a description without "we" or "our"');
  return missing;
}

const listOf = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * Why a change cannot be approved yet, or null when it can. A base plan
 * needs its score (the sites list high scores first; the freelancers used
 * 1 to 10), its price, bedrooms, bathrooms, square feet, garages and home
 * type; a quick move-in needs its price; a removal needs nothing. What is
 * missing can be typed in the edit overlay.
 */
export function approvalBlocker(changeType: string, record: unknown): string | null {
  if (changeType === "remove") return null;
  if (!record) return "no proposed record to approve";
  const missing = missingFields(record);
  return missing.length ? `needs ${listOf(missing)} before approval (set ${missing.length === 1 ? "it" : "them"} in the edit overlay)` : null;
}

/**
 * Whether a rejection of a new plan still holds against the same plan
 * queued again: it does unless the builder has since filled in something
 * the rejected version lacked (a plan rejected for having no price comes
 * back when it gets one, Jeff, 2026-09-20). A complete plan that was
 * rejected stays rejected.
 */
export function rejectionStillApplies(rejected: unknown, proposed: unknown): boolean {
  const now = new Set(missingFields(proposed));
  // The score is a person's number, never the builder's, so it does not count.
  return missingFields(rejected).every((m) => m === "a score" || now.has(m));
}
