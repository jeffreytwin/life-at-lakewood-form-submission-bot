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

/**
 * A name without the series a page or an earlier night put on it, however
 * written: "Duval (Signature)", "Signature Duval", and the community's name
 * with it, "Duval (Oakfield Trails Traditional)" (2026-09-29), are Duval.
 * A model home is the plan too: "Duval (Oakfield Trails Signature) - Model
 * Home" is Duval.
 */
function withoutSeries(name: string, series: Set<string>): string {
  const isSeries = (text: string) => {
    const key = normKey(text);
    return [...series].some((s) => key === s || key.endsWith(`-${s}`));
  };
  const trimmed = name
    .trim()
    .replace(/\s*(?:[-–—|:]\s*|\(\s*)model(?:\s+home)?\s*\)?\s*$/i, "")
    .trim();
  const tail = trimmed.match(/^(.*\S)\s*\(([^()]*)\)$/);
  if (tail && isSeries(tail[2])) return tail[1].trim();
  const parts = trimmed.split(/\s+/);
  for (let words = 1; words < parts.length; words++) {
    if (isSeries(parts.slice(0, words).join(" "))) return parts.slice(words).join(" ");
  }
  return trimmed;
}

const labelled = (name: string, series: string) => `${name} (${series})`;

/** A plan already on the site: its key, its name and its page. */
export interface FiledPlan {
  planKey: string;
  name?: string | null;
  sourceUrl?: string | null;
  quickMoveIn?: boolean | null;
}

/**
 * The run's plans with each plan sold in more than one series named for
 * its series, and each home built from one naming it so. A plan already
 * on the site (`filed`) keeps the key and name it is filed under, however
 * it was labelled then: Oakfield Trails' plans were approved as "Duval
 * (Oakfield Trails Traditional)" (2026-09-29), and naming them again would
 * offer each as a new plan and the one on the site as gone. Otherwise a
 * plan is labelled where the run finds it in two series, or where a plan
 * of its name in its series was queued before (`knownKeys`: the
 * connection's records and queued rows, any status), so a night that
 * reads one series does not offer the plan again unlabelled. Plans and
 * homes not in a series are left as they are. Pure; exported for tests.
 */
export function withSeriesLabels(
  plans: NormalizedPlan[],
  communityUrl: string,
  knownKeys: Iterable<string> = [],
  filed: FiledPlan[] = []
): NormalizedPlan[] {
  const known = new Set(knownKeys);
  const seriesByPlan = new Map<NormalizedPlan, string>();
  for (const p of plans) {
    const s = seriesOf(p.sourceUrl, communityUrl);
    if (s) seriesByPlan.set(p, s);
  }
  if (!seriesByPlan.size) return plans;
  const filedSeries = filed
    .filter((f) => !f.quickMoveIn && f.name)
    .map((f) => ({ ...f, series: seriesOf(f.sourceUrl, communityUrl) }))
    .filter((f): f is typeof f & { series: string } => f.series !== null);
  const allSeries = new Set([...seriesByPlan.values(), ...filedSeries.map((f) => f.series)].map(normKey));
  const at = (name: string, series: string) => `${normKey(withoutSeries(name, allSeries))}|${normKey(series)}`;
  const onSite = new Map(filedSeries.map((f) => [at(f.name as string, f.series), { planKey: f.planKey, name: f.name as string }]));

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

  // Each plan's name in its series, for the homes built from it.
  const named = new Map<string, string>(filedSeries.map((f) => [at(f.name as string, f.series), f.name as string]));
  const out = plans.map((p) => {
    const name = bare.get(p);
    const s = seriesByPlan.get(p);
    if (name === undefined || !s) return p;
    const filedAs = onSite.get(at(name, s));
    const finalName = filedAs?.name ?? (labels(name, s) ? labelled(name, s) : name);
    const planKey = filedAs?.planKey ?? normKey(finalName);
    named.set(at(name, s), finalName);
    return finalName === p.name && planKey === p.planKey ? p : { ...p, name: finalName, planKey };
  });

  return out.map((p) => {
    const s = seriesByPlan.get(p);
    if (!p.quickMoveIn || !s) return p;
    const related = (p.relatedPlanName ?? (typeof p.raw?.relatedPlan === "string" ? p.raw.relatedPlan : "")).trim();
    if (!related) return p;
    const name = withoutSeries(related, allSeries);
    const plan = named.get(at(name, s)) ?? (known.has(normKey(labelled(name, s))) ? labelled(name, s) : null);
    if (!plan || plan === related) return p;
    // The key the reader matched by name is the plan's under another name; the home is linked again by this one (quick-move-ins.ts).
    return {
      ...p,
      relatedPlanName: plan,
      relatedPlanKey: null,
      ...(typeof p.raw?.relatedPlan === "string" ? { raw: { ...p.raw, relatedPlan: plan } } : {}),
    };
  });
}
