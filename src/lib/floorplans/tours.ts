// The tour a builder's link stands for, where the link itself is not one
// to show. Lennar's feeds began giving hd.lennar.com/tours/<n>/ in place of
// the modsy tours on 2026-09-25, and those show a broken tour (Jeff,
// 2026-09-25); the number is the modsy tour's own —
// hd.lennar.com/tours/3944/ is modsy's ".../virtualtour/3944" — so a
// modsy tour already on a record of the community gives the working link.

import type { NormalizedPlan } from "@/lib/floorplans/types";

/** The tour number a Lennar or modsy link carries: /tours/3944/, /virtualtour/3944. Pure. */
export function tourNumber(url: string | null | undefined): string | null {
  if (!url) return null;
  return (
    url.match(/^https?:\/\/hd\.lennar\.com\/tours\/(\d+)/i)?.[1] ??
    url.match(/^https?:\/\/(?:www\.)?modsy\.com\/.*\/virtualtour\/(\d+)(?:[/?#]|$)/i)?.[1] ??
    null
  );
}

/**
 * Plans whose tour link was dropped as one that does not work, given the
 * working tour with the same number where one of the community's records
 * already shows it. A plan with no such tour on file is left with none.
 * Pure.
 */
export function withKnownTours(plans: NormalizedPlan[], known: (string | null | undefined)[]): NormalizedPlan[] {
  const byNumber = new Map<string, string>();
  for (const url of known) {
    if (!url || !/modsy\.com\//i.test(url)) continue;
    const n = tourNumber(url);
    if (n && !byNumber.has(n)) byNumber.set(n, url);
  }
  if (!byNumber.size) return plans;
  return plans.map((plan) => {
    if (plan.virtualTourUrl) return plan;
    const dropped = plan.raw?.droppedTourUrl;
    const n = typeof dropped === "string" ? tourNumber(dropped) : null;
    const tour = n ? byNumber.get(n) : undefined;
    return tour ? { ...plan, virtualTourUrl: tour } : plan;
  });
}
