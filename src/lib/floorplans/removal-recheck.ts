// A run that would take a bunch of plans off at once is held for a second
// look an hour later (Jeff, 2026-10-27), floor plans far sooner than quick
// move-ins (looksSuspicious). A page that drew only part of its
// list still clears the coverage floor (coverage.ts: 60% of last time), and
// its run came through as "ok" with every plan it missed queued for
// removal; the removals only went when Jeff pressed Run again and the page
// drew in full. So a run whose removals look like a page that did not
// load, rather than homes that sold, queues none of them: it says so in
// its status ("suspicious: ...") and the plans are held on the connection
// (fp_builder_communities.removals_held, migration 086). The nightly tick
// runs the connection again once the hour is up (nightly.ts, rechecksDue),
// and what that run still finds missing is queued; what it reads again was
// never gone. A run before the hour is up decides nothing: what it still
// misses stays held to the same hour, and what it reads again is let go.
// No IO here.

/** How long a held removal waits before the run that confirms it. */
export const RECHECK_AFTER_MS = 60 * 60 * 1000;

/**
 * Floor plans one run may take off before it looks like a page that did
 * not load. A builder seldom stops offering a plan, and seldom two at
 * once; homes sell every week (Jeff, 2026-10-27: "it's way more
 * suspicious when floor plans are up for mass removal"). In the thirty
 * days to 10-27, 167 runs took off one quick move-in and 34 two, where 14
 * took off one floor plan.
 */
export const SUSPICIOUS_PLANS = 2;

/** Quick move-ins one run may take off before it does. */
export const SUSPICIOUS_HOMES = 4;

/** Or this share of the community's quick move-ins, three or more. */
export const SUSPICIOUS_HOME_SHARE = 0.5;

/** A count of floor plans and of quick move-ins. */
export interface PlanCounts {
  plans: number;
  homes: number;
}

/** Whether what one run would take off looks like a page that did not load. Pure; exported for tests. */
export function looksSuspicious(removals: PlanCounts, onFile: PlanCounts): boolean {
  if (removals.plans >= SUSPICIOUS_PLANS) return true;
  if (removals.homes >= SUSPICIOUS_HOMES) return true;
  return removals.homes >= 3 && onFile.homes > 0 && removals.homes >= SUSPICIOUS_HOME_SHARE * onFile.homes;
}

/** A plan a run found missing. */
export interface Missing {
  key: string;
  quickMoveIn: boolean;
}

const countsOf = (missing: Missing[]): PlanCounts => ({
  plans: missing.filter((m) => !m.quickMoveIn).length,
  homes: missing.filter((m) => m.quickMoveIn).length,
});

/** What a connection holds for a re-check, as its row keeps it. */
export interface RemovalHold {
  keys: string[] | null;
  /** When the run that confirms them is due (ISO). */
  recheckAt: string | null;
}

export interface RemovalDecision {
  /** Removals to queue now: missing on a run at least an hour after an earlier one missed them, or too few to doubt. */
  queue: string[];
  /** Removals held for the re-check. */
  hold: string[];
  /** When the re-check is due (ISO); null when nothing is held. */
  recheckAt: string | null;
  /** How many of `queue` were confirmed by a re-check. */
  confirmed: number;
}

/**
 * Which of the plans a run found missing are queued for removal and which
 * are held for a re-check. `missing` are the plans the run did not read
 * that have been missing long enough to remove (sync.ts); `onFile` is how
 * many floor plans and quick move-ins the connection has on the site.
 * Pure; exported for tests.
 */
export function decideRemovals(missing: Missing[], onFile: PlanCounts, held: RemovalHold, now = Date.now()): RemovalDecision {
  const heldKeys = new Set(held.keys ?? []);
  const due = held.recheckAt ? Date.parse(held.recheckAt) : NaN;
  const stillMissing = missing.filter((m) => heldKeys.has(m.key));
  const rest = missing.filter((m) => !heldKeys.has(m.key));
  const keys = (list: Missing[]) => list.map((m) => m.key);
  const later = new Date(now + RECHECK_AFTER_MS).toISOString();

  // Held and the hour not up: nothing is decided yet.
  if (stillMissing.length && Number.isFinite(due) && now < due) {
    return { queue: [], hold: keys([...stillMissing, ...rest]), recheckAt: held.recheckAt, confirmed: 0 };
  }

  // The re-check (or nothing held): what an hour apart still misses is gone.
  const confirmed = Number.isFinite(due) ? stillMissing : [];
  const fresh = Number.isFinite(due) ? rest : missing;
  if (fresh.length && looksSuspicious(countsOf(fresh), onFile)) {
    return { queue: keys(confirmed), hold: keys(fresh), recheckAt: later, confirmed: confirmed.length };
  }
  return { queue: keys([...confirmed, ...fresh]), hold: [], recheckAt: null, confirmed: confirmed.length };
}

/**
 * Whether a connection is owed its re-check now: something is held, the
 * hour is up, and no run has been made since. A re-check that failed or
 * was cut off is not run again and again; the connection's next run, the
 * nightly one or a Run, makes the decision. Pure; exported for tests.
 */
export function recheckOwed(
  c: { removals_held: string[] | null; removal_recheck_at: string | null; last_run_at: string | null; last_run_status: string | null },
  now = Date.now()
): boolean {
  if (!c.removals_held?.length || !c.removal_recheck_at) return false;
  const due = Date.parse(c.removal_recheck_at);
  if (!Number.isFinite(due) || now < due) return false;
  if ((c.last_run_status ?? "").startsWith("cut off:")) return false;
  return !c.last_run_at || Date.parse(c.last_run_at) < due;
}

/** "3:14 PM", Eastern, the way a person reads the time a re-check is due. */
export function recheckTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}
