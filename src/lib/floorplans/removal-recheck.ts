// A run that would take a bunch of plans off at once is checked again an
// hour later (Jeff, 2026-10-27), floor plans far sooner than quick move-ins
// (looksSuspicious). A page that drew only part of its list still clears
// the coverage floor (coverage.ts: 60% of last time), and its run came
// through as "ok" with every plan it missed queued for removal, nothing to
// tell them from homes that sold; they only went when Jeff pressed Run
// again and the page drew in full.
//
// Nothing is kept back from the queue ("it makes those essentially
// invisible, and any potential problems invisible as well"). A run whose
// removals look like a page that did not load queues them flagged as
// suspicious (fp_pending_changes.review_flag, migration 087), with the
// time of their re-check. The plans are remembered on the connection
// (fp_builder_communities.removals_held, migration 086), and the nightly
// tick runs the connection again once the hour is up (nightly.ts,
// rechecksDue), in the middle of the night. What that run reads again has
// its removal withdrawn (sync.ts, withdrawOutdatedRemovals); what it still
// finds missing is flagged as double-checked instead. So by morning a
// person sees only the removals read missing twice, an hour apart, and
// approved, they are written to Wix at once like any other (approvals.ts).
// A run before the hour is up confirms nothing: what it still misses waits
// for the same re-check. No IO here.

/** How long a suspicious removal waits for the run that checks it again. */
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

/** What a connection remembers for a re-check, as its row keeps it. */
export interface RemovalHold {
  keys: string[] | null;
  /** When the run that checks them again is due (ISO). */
  recheckAt: string | null;
}

export interface RemovalDecision {
  /** Every removal the run found: all are queued. */
  queue: string[];
  /** Those to flag as suspicious: they wait for the re-check. */
  suspicious: string[];
  /** Those to flag as double-checked: still missing an hour after an earlier run missed them. */
  confirmed: string[];
  /** What the connection remembers for the re-check after this run. */
  hold: string[];
  /** When the re-check is due (ISO); null when nothing waits for one. */
  recheckAt: string | null;
}

/**
 * How the plans a run found missing are queued for removal: flagged as
 * suspicious, as double-checked, or plainly. `missing` are the plans the
 * run did not read that have been missing long enough to remove (sync.ts);
 * `queued`, those already in the queue for removal, keep the flag they
 * have and are not counted again; `onFile` is how many floor plans and
 * quick move-ins the connection has on the site. Pure; exported for tests.
 */
export function decideRemovals(
  missing: Missing[],
  onFile: PlanCounts,
  held: RemovalHold,
  queued: ReadonlySet<string> = new Set(),
  now = Date.now()
): RemovalDecision {
  const heldKeys = new Set(held.keys ?? []);
  const due = held.recheckAt ? Date.parse(held.recheckAt) : NaN;
  const stillMissing = missing.filter((m) => heldKeys.has(m.key));
  const fresh = missing.filter((m) => !heldKeys.has(m.key) && !queued.has(m.key));
  const keys = (list: Missing[]) => list.map((m) => m.key);
  const queue = keys(missing);

  // Waiting for the re-check: what goes missing meanwhile waits for it too.
  if (stillMissing.length && Number.isFinite(due) && now < due) {
    return { queue, suspicious: keys(fresh), confirmed: [], hold: keys([...stillMissing, ...fresh]), recheckAt: held.recheckAt };
  }

  // The re-check (or none owed): what an hour apart still misses is double-checked.
  const confirmed = Number.isFinite(due) ? keys(stillMissing) : [];
  if (fresh.length && looksSuspicious(countsOf(fresh), onFile)) {
    return { queue, suspicious: keys(fresh), confirmed, hold: keys(fresh), recheckAt: new Date(now + RECHECK_AFTER_MS).toISOString() };
  }
  return { queue, suspicious: [], confirmed, hold: [], recheckAt: null };
}

/**
 * Whether a connection is owed its re-check now: something waits for it, the
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

/** "4 floor plans and 2 quick move-ins". */
function whatOf(list: Missing[]): string {
  const { plans, homes } = countsOf(list);
  return [plans && `${plans} floor plan${plans === 1 ? "" : "s"}`, homes && `${homes} quick move-in${homes === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" and ");
}

/** The note a removal waiting for its re-check is queued with. Pure; exported for tests. */
export function suspiciousFlag(batch: Missing[], recheckAt: string): string {
  return `Suspicious: ${whatOf(batch)} went missing at once; the page may not have loaded in full. The sync checks again at ${recheckTime(recheckAt)} and withdraws any it finds.`;
}

/** The note a removal a re-check confirmed is flagged with instead. Pure; exported for tests. */
export function doubleCheckedFlag(batch: Missing[], recheckAt: string): string {
  const first = new Date(Date.parse(recheckAt) - RECHECK_AFTER_MS).toISOString();
  return `Double-checked: ${whatOf(batch)} went missing at once at ${recheckTime(first)} and ${batch.length === 1 ? "was" : "were"} still missing on a re-check at ${recheckTime(recheckAt)}. Worth confirming on the builder's page before approving.`;
}

/** "3:14 PM", Eastern, the way a person reads the time a re-check is due. */
export function recheckTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}
