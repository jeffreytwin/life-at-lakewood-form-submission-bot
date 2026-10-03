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
