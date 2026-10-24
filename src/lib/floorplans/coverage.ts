// The one signal a broken builder page gives that an "ok" run would hide:
// far fewer plans than last time. A page that changed shape usually still
// parses to something, so it is the count that drops, not an error that
// fires. Below the floor the run is recorded as partial, counted as a
// failure for the connection's health, and no removal is proposed from
// it (sync.ts). No IO here.

export const COVERAGE_FLOOR = 0.6;

export interface Coverage {
  ok: boolean;
  detail: string;
}

export function describeCoverage(found: number, lastKnown: number | null | undefined): Coverage {
  if (!lastKnown || found >= COVERAGE_FLOOR * lastKnown) return { ok: true, detail: `${found} plans` };
  return {
    ok: false,
    detail: `partial: ${found} of the ${lastKnown} plans found last time (removals held; check the builder's page)`,
  };
}

/**
 * The count a run is held to: the last run's, once the connection has had
 * a good one. Before that the count on file is the one the connection was
 * set up with, read off the old site, and nothing the builder lists now:
 * Emerald Landing at Waterside came over with 21 and David Weekley sells
 * 8 homes there and no plans, and its first run was failed as "8 of the
 * 21 plans found last time" (Jeff, 2026-10-03). Pure.
 */
export function countToMeet(lastPlanCount: number | null | undefined, onboardedAt: string | null | undefined): number | null {
  return onboardedAt ? lastPlanCount ?? null : null;
}

/** How far apart two short runs must be for what they found to be taken for what the builder lists: a night. */
export const SHORTFALL_NIGHTS_MS = 20 * 60 * 60 * 1000;

/**
 * The count a run short of its count leaves for the next run to meet:
 * none of its own, so the next run is held to the same count, until the
 * connection has come back short on two nights running. Then what it
 * found is what the builder lists now, and the run after it is held to
 * that. A short run used to leave its own count, and one bad read was
 * enough to lower the bar: Richmond American's Estates at Rivers Edge
 * read its five plans and none of its ten homes one night (10-18), a Run
 * pressed an hour later read the same, passed as "ok: 5 plans", and
 * queued every home for removal; approved, ten homes Richmond still sold
 * came off the site. A run made again the same night (nightly.ts,
 * retriesOwed) would do that on its own. Null leaves the count as it is.
 * Pure; exported for tests.
 */
export function countAfterShortfall(
  found: number,
  before: { lastRunStatus: string | null | undefined; lastRunAt: string | null | undefined },
  now = Date.now()
): number | null {
  const shortBefore = (before.lastRunStatus ?? "").startsWith("partial:");
  const at = Date.parse(before.lastRunAt ?? "");
  return shortBefore && Number.isFinite(at) && now - at >= SHORTFALL_NIGHTS_MS ? found : null;
}
