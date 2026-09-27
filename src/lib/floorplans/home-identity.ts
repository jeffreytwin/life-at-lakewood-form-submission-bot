// A home for sale read again under another name is the home already on the
// site, not a new one. Its key comes from its name, and the name a run
// reads can change from one night to the next: Neal's Palm Grove listed
// one home as "17602 Meandering Palms Crossing", then "17602 Meandering
// Palms Crossing - Ready Feb 2027", then "Ready February 2027", and each
// new name was offered and written as a new home — three rows on the site
// for one house (Jeff, 2026-09-27). Its own page stays the same, so a home
// is known by that page first (sameHome), and by its name only after.

import { sameHome } from "@/lib/floorplans/extractors/claude-extract";
import { namesAnAddress } from "@/lib/floorplans/standardize";
import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";

/** A home the Hub already tracks for this builder and community. */
export interface FiledHome {
  plan_key: string;
  record: unknown;
  created_at?: string | null;
}

/**
 * The name a home keeps when read again under another: the street address
 * it was filed by, unless the new name is a different address. An address
 * with a move-in date after it ("17602 Meandering Palms Crossing - Ready
 * Feb 2027") is that address again. Pure; exported for tests.
 */
export function nameKept(filed: string, read: string): string {
  if (!namesAnAddress(filed)) return read;
  if (!namesAnAddress(read)) return filed;
  return normKey(read).startsWith(normKey(filed)) ? filed : read;
}

const asHome = (row: FiledHome): NormalizedPlan | null => {
  const record = row.record as NormalizedPlan | null;
  return record?.quickMoveIn === true ? record : null;
};

/**
 * Each home this run read, filed under the row the site already has for
 * it: the row its key names, or a row for the same home under another name
 * (sameHome). Where a home already has more than one row, the one named by
 * its street address stays, then the one its key names, then the oldest;
 * the others are no longer seen and come up for removal as usual. A row
 * two of this run's homes could both be is left alone. Pure; exported for
 * tests.
 */
export function filedAsBefore(plans: NormalizedPlan[], filed: FiledHome[]): NormalizedPlan[] {
  const homes = filed.map((row) => ({ row, home: asHome(row) })).filter((h): h is { row: FiledHome; home: NormalizedPlan } => h.home !== null);
  const candidates = plans.map((plan) =>
    plan.quickMoveIn ? homes.filter(({ row, home }) => row.plan_key === plan.planKey || sameHome(home, plan)) : []
  );
  // A row more than one of this run's homes could be says nothing about either.
  const claims = new Map<string, number>();
  for (const found of candidates) for (const { row } of found) claims.set(row.plan_key, (claims.get(row.plan_key) ?? 0) + 1);
  const time = (row: FiledHome) => (row.created_at ? Date.parse(row.created_at) : Infinity);
  return plans.map((plan, i) => {
    const found = candidates[i];
    if (!found.length || found.some(({ row }) => (claims.get(row.plan_key) ?? 0) > 1)) return plan;
    // Of two rows named by the address, the bare address ("17602 Meandering
    // Palms Crossing" over "... - Ready Feb 2027").
    const bare = (h: NormalizedPlan) => (namesAnAddress(h.name) ? normKey(h.name).length : 0);
    const best = [...found].sort(
      (a, b) =>
        Number(namesAnAddress(b.home.name)) - Number(namesAnAddress(a.home.name)) ||
        bare(a.home) - bare(b.home) ||
        Number(b.row.plan_key === plan.planKey) - Number(a.row.plan_key === plan.planKey) ||
        time(a.row) - time(b.row)
    )[0];
    if (best.row.plan_key === plan.planKey) return plan;
    return { ...plan, planKey: best.row.plan_key, name: nameKept(best.home.name, plan.name) };
  });
}

/**
 * Whether a home offered as new is one the site already has: a pending
 * addition left from a run that read it under another name. Pure;
 * exported for tests.
 */
export function alreadyFiled(offered: NormalizedPlan | null, filed: FiledHome[]): boolean {
  if (!offered?.quickMoveIn) return false;
  return filed.some((row) => {
    const home = asHome(row);
    return home !== null && row.plan_key !== offered.planKey && sameHome(home, offered);
  });
}
