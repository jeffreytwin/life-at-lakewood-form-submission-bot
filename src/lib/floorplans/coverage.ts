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

/** How long a connection must have been short for what it finds to be taken for what the builder lists: a night. */
export const SHORTFALL_NIGHTS_MS = 20 * 60 * 60 * 1000;

/**
 * The count a run short of its count leaves for the next run to meet:
 * none of its own, so the next run is held to the same count, until the
 * connection has been short from one night to the next. Then what it
 * found is what the builder lists now, and the run after it is held to
 * that. A short run used to leave its own count, and one bad read was
 * enough to lower the bar: Richmond American's Estates at Rivers Edge
 * read its five plans and none of its ten homes one night (10-18), a Run
 * pressed an hour later read the same, passed as "ok: 5 plans", and
 * queued every home for removal; approved, ten homes Richmond still sold
 * came off the site. A run made again the same night (nightly.ts,
 * retriesOwed) would do that on its own.
 *
 * The night is counted from the first short run (short_since), not the
 * run before: every run moved that on, a night's retry and a Run pressed
 * in the day alike, and a connection run more often than every twenty
 * hours never came down. Ashton Woods dropped its Traditional plans at
 * Oakfield on 11-04 and the connection read the 11 it lists now seven
 * times that day, each one failed against the 28 of the day before
 * (Jeff, 2026-11-04). Null leaves the count as it is. Pure; exported for
 * tests.
 */
export function countAfterShortfall(found: number, shortSince: string | null | undefined, now = Date.now()): number | null {
  const at = Date.parse(shortSince ?? "");
  return Number.isFinite(at) && now - at >= SHORTFALL_NIGHTS_MS ? found : null;
}

/**
 * What a run leaves in short_since: the first short run sets it, a later
 * short run keeps it, and a run that meets its count clears it. Pure.
 */
export function shortSinceAfter(ok: boolean, shortSince: string | null | undefined, now = Date.now()): string | null {
  if (ok) return null;
  return shortSince && Number.isFinite(Date.parse(shortSince)) ? shortSince : new Date(now).toISOString();
}

/**
 * The count a connection is held to once a person has taken plans off the
 * site by hand (remove-plan.ts): the one on file, less what came off. The
 * run after it finds the builder's page without them, and held to the old
 * count it failed as short: Lennar dropped its Manor Homes at Stillwater on
 * 11-07, the 13 plans and homes were removed from the queue, and every run
 * after it read the 9 Executive Homes left and failed as "9 of the 22 plans
 * found last time" until the shortfall had lasted a night (Jeff,
 * 2026-11-07). Null where there is no count on file. Pure.
 */
export function countAfterRemoval(lastPlanCount: number | null | undefined, removed: number): number | null {
  if (lastPlanCount == null) return null;
  return Math.max(0, lastPlanCount - Math.max(0, removed));
}
