// One plan sold in two series of a community, kept as two plans with the
// series in their names (Jeff, 2026-09-28: "they aren't duplicates … keep
// both since their names are different").
//
// Ashton Woods sells Oakfield Trails as two series, each under its own
// address beneath the community's:
//
//   /tampa/oakfield-trails-traditional/duval
//   /tampa/oakfield-trails-signature/signature-duval
//
// Duval, Griffin, Plant, Siesta and Teton are in both, at two prices. The
// series was left to Claude's reading of the page, so one night gave
// "Duval (Traditional)" and "Duval (Signature)" and another gave one
// "Duval", the two listings merged as one plan listed twice
// (mergeRepeatedPlan), which the Hub then offered as a third plan. And a
// home built from the Signature Duval was filed under plain "Duval".
//
// Here the series is read from the address instead, every night the same:
// a plan in both series is named for its series, a plan in one keeps its
// own name, and a plan once filed under its series keeps the label on a
// night only one series is read. A home built from a labelled plan names
// the plan in its own series. No IO.

import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";

/** Builders that sell one plan in more than one series of a community, each series under its own address. */
export const SERIES_BUILDERS = new Set(["Ashton Woods"]);

/** The last folder of the community's own address: "oakfield-trails" for /tampa/oakfield-trails?comm=…. */
function communitySlug(communityUrl: string): string | null {
  try {
    return new URL(communityUrl).pathname.split("/").filter(Boolean).pop()?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

const titleCase = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/**
 * The series a page sits in, by its address: the folder that is the
 * community's own followed by more ("oakfield-trails-signature" under
 * "oakfield-trails" is Signature). Null where the page is not in one.
 * Pure; exported for tests.
 */
export function seriesOf(url: string | null | undefined, communityUrl: string | null | undefined): string | null {
  if (!url || !communityUrl) return null;
  const slug = communitySlug(communityUrl);
  if (!slug) return null;
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
  } catch {
    return null;
  }
  const folder = segments.find((s) => s.startsWith(`${slug}-`) && s.length > slug.length + 1);
  return folder ? titleCase(folder.slice(slug.length + 1)) : null;
}

/** A name without the series a page or an earlier night put on it: "Duval (Signature)" and "Signature Duval" are Duval. */
function withoutSeries(name: string, series: Set<string>): string {
  const trimmed = name.trim();
  const tail = trimmed.match(/^(.*\S)\s*\(([^()]*)\)$/);
  if (tail && series.has(normKey(tail[2]))) return tail[1].trim();
  for (const s of series) {
    const words = s.split("-").length;
    const parts = trimmed.split(/\s+/);
    if (parts.length > words && normKey(parts.slice(0, words).join(" ")) === s) return parts.slice(words).join(" ");
  }
  return trimmed;
}

const labelled = (name: string, series: string) => `${name} (${series})`;

/**
 * The run's plans with each plan sold in more than one series named for
 * its series, and each home built from one naming it so. A plan is
 * labelled where the run finds it in two series, or where a plan of its
 * name in its series is already on file (`knownKeys`: the connection's
 * records and queued rows, any status), so a night that reads one series
 * does not offer the plan again unlabelled. Plans and homes not in a
 * series are left as they are. Pure; exported for tests.
 */
export function withSeriesLabels(plans: NormalizedPlan[], communityUrl: string, knownKeys: Iterable<string> = []): NormalizedPlan[] {
  const known = new Set(knownKeys);
  const seriesByPlan = new Map<NormalizedPlan, string>();
  for (const p of plans) {
    const s = seriesOf(p.sourceUrl, communityUrl);
    if (s) seriesByPlan.set(p, s);
  }
  if (!seriesByPlan.size) return plans;
  const allSeries = new Set([...seriesByPlan.values()].map(normKey));

  // Each base plan's own name, and the series each name is sold in.
  const bare = new Map<NormalizedPlan, string>();
  const soldIn = new Map<string, Set<string>>();
  for (const p of plans) {
    const s = seriesByPlan.get(p);
    if (p.quickMoveIn || !s) continue;
    const name = withoutSeries(p.name, allSeries);
    bare.set(p, name);
    const key = normKey(name);
    soldIn.set(key, (soldIn.get(key) ?? new Set()).add(normKey(s)));
  }
  const labels = (name: string, series: string) =>
    (soldIn.get(normKey(name))?.size ?? 0) > 1 || known.has(normKey(labelled(name, series)));

  // The labelled plans by their own name and series, for the homes built from them.
  const labelledPlans = new Map<string, string>();
  const out = plans.map((p) => {
    const name = bare.get(p);
    const s = seriesByPlan.get(p);
    if (name === undefined || !s) return p;
    const finalName = labels(name, s) ? labelled(name, s) : name;
    if (finalName !== name) labelledPlans.set(`${normKey(name)}|${normKey(s)}`, finalName);
    return finalName === p.name && normKey(finalName) === p.planKey ? p : { ...p, name: finalName, planKey: normKey(finalName) };
  });

  return out.map((p) => {
    const s = seriesByPlan.get(p);
    if (!p.quickMoveIn || !s) return p;
    const related = (p.relatedPlanName ?? (typeof p.raw?.relatedPlan === "string" ? p.raw.relatedPlan : "")).trim();
    if (!related) return p;
    const name = withoutSeries(related, allSeries);
    const plan = labelledPlans.get(`${normKey(name)}|${normKey(s)}`) ?? (known.has(normKey(labelled(name, s))) ? labelled(name, s) : null);
    if (!plan || plan === related) return p;
    // The key the reader matched by name is the unlabelled plan's; the home is linked again by its label (quick-move-ins.ts).
    return {
      ...p,
      relatedPlanName: plan,
      relatedPlanKey: null,
      ...(typeof p.raw?.relatedPlan === "string" ? { raw: { ...p.raw, relatedPlan: plan } } : {}),
    };
  });
}
