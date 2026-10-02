// A tour on every plan of a connection is the page's, not any plan's.
// Adams Homes' pages carry a list of homes for sale across three states in
// their scripts, and the first tour in it, a home at Alachua, was read as
// the tour of every plan and home at Aviary, none of which has one (Jeff,
// 2026-10-02). A plan kept in two collections shares its tour with itself
// (Ashton Woods' Duval) and a home shows its plan's, so only a tour on
// every base plan, three or more plans by name, is taken back out.

import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";

/** A tour as the tour it opens: a Matterport by its model, anything else by its address. Exported for tour-review.ts. */
export function tourKey(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  const model = u.match(/matterport\.com\/(?:show\/?\?(?:[^#]*&)?m=|models\/|discover\/space\/)([A-Za-z0-9]+)/i)?.[1];
  return model ? `matterport:${model}` : u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
}

/** A plan's name without the collection it is filed under: "Duval (Oakfield Trails Signature)" is Duval. */
const planOf = (name: string) => normKey(name.replace(/\s*\([^)]*\)\s*/g, " "));

/**
 * The plans and homes without a tour that every base plan carries. The
 * tour is gone, not unread (tourStated), so one already on a record comes
 * off it. Needs three plans by name; fewer are left as they are. Pure.
 */
export function withoutCommunityTour(plans: NormalizedPlan[]): NormalizedPlan[] {
  const base = plans.filter((p) => !p.quickMoveIn);
  if (new Set(base.map((p) => planOf(p.name))).size < 3) return plans;
  const shared = tourKey(base[0].virtualTourUrl);
  if (!shared || !base.every((p) => tourKey(p.virtualTourUrl) === shared)) return plans;
  return plans.map((p) =>
    tourKey(p.virtualTourUrl) === shared ? { ...p, virtualTourUrl: null, virtualTourImage: null, tourStated: true } : p
  );
}
