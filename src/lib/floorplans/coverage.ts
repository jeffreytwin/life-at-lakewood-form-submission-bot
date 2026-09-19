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
