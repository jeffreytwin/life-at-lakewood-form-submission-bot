// A change read twice before anyone is asked about it.
//
// A run reads a builder's page a little differently from one night to the
// next, and each reading that differs from the record was proposed as a
// change, then the next reading proposed it back: David Weekley's Truman
// came back with one of its two elevations one night and both the next,
// six times in a week, and every "2 photos → 1 photo" approved took an
// elevation off the site until the next run put it back; ICI's Brooke and
// Cameron drawings swapped one revision for the other on Oct 7 and back on
// Oct 8; M/I's Interlude description traded places with itself six days
// running (Jeff, 2026-10-13: "reduce unnecessary changes without skipping
// over real changes").
//
// So a description, photos or drawings a run reads differently from the
// record are held until the next run that reads the field reads them the
// same way (fp_unconfirmed_changes, migration 080). A builder's real change
// reads the same night after night: it reaches the queue one run later. A
// change already waiting in the queue with the same new value needs no
// second reading.
//
// Nothing is held for good. A field read differently from the record on
// MOST_RUNS_HELD runs within SIGHTING_DAYS of the first, in a row or not,
// the same way or not, is put to a person on the last of them: a reading
// that comes and goes reaches the queue once in a while rather than every
// other night, and where the record is the reading that was wrong (an
// approval of a bad reading), the right one still comes back to be
// approved. Rejected, a reading never comes back (stillRejected, sync.ts).
//
// A table that cannot be read or written costs the hold, never the change:
// the change is queued at once, as it was before.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import type { FieldChange } from "@/lib/floorplans/diff";

/** The queue labels a change of is held for a second reading: what a page is read differently for from night to night. */
export const CONFIRMED_LABELS: ReadonlySet<string> = new Set(["description", "photos", "blueprints"]);

/** Runs within SIGHTING_DAYS a field may read differently from the record, however it read, before its change is put to a person anyway. */
export const MOST_RUNS_HELD = 3;

/**
 * Days the runs that read a field differently are counted over, from the
 * first; and days a reading is remembered after the last that differed.
 */
export const SIGHTING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What earlier runs read for a field that differed from the record. */
export interface Sighting {
  /** The field's last reading, where it differed from the record; null where the last run that read it read the record's. */
  newValue: string | null;
  /** The run of the last reading. */
  runId: string;
  /** Runs that read the field differently from the record, in a row or not, since firstSeenAt. */
  runs: number;
  /** When the runs counted began (ISO). */
  firstSeenAt: string;
  /** When a run last read it differently from the record (ISO). */
  seenAt: string;
}

export interface Confirmation {
  /** Changes read the same way twice, or not held at all: queued (or approved on their own) as before. */
  confirmed: FieldChange[];
  /** Changes held for a second reading: neither queued nor written with anything else. */
  held: FieldChange[];
  /** What is remembered of the held ones for the next run: a count of 1 begins a new count, from now. */
  remember: { label: string; newValue: string; runs: number; firstSeenAt: string }[];
  /** Fields this run read the record's way: what was held for them is kept, its count with it, but no longer as the last reading. */
  interrupted: string[];
  /** Labels whose remembered reading goes: confirmed, or not read differently for SIGHTING_DAYS. */
  forget: string[];
}

/**
 * Which of a plan's changes go to the queue this run and which wait for a
 * second reading. `compared` names the fields the run speaks for
 * (diff.ts, comparedFields): one of them read the way the record has it
 * breaks the run of readings without forgetting it. Pure; exported for
 * tests.
 */
export function confirmChanges(
  changes: FieldChange[],
  compared: Iterable<string>,
  seen: ReadonlyMap<string, Sighting>,
  waiting: ReadonlyMap<string, string | null>,
  runId: string,
  now: number = Date.now()
): Confirmation {
  const out: Confirmation = { confirmed: [], held: [], remember: [], interrupted: [], forget: [] };
  const within = (at: string) => now - Date.parse(at) < SIGHTING_DAYS * DAY_MS;
  const changed = new Set(changes.map((c) => c.label));
  for (const change of changes) {
    if (!CONFIRMED_LABELS.has(change.label)) {
      out.confirmed.push(change);
      continue;
    }
    const sighting = seen.get(change.label);
    const last = sighting && within(sighting.seenAt) ? sighting : undefined;
    // A plan read twice in one run counts once.
    const earlier = last && last.runId !== runId ? last : undefined;
    // The last run that read the field read it this way.
    const again = earlier?.newValue === change.newValue;
    const counting = last && within(last.firstSeenAt) ? last : undefined;
    const runs = !counting ? 1 : earlier ? counting.runs + 1 : counting.runs;
    if (waiting.get(change.label) === change.newValue || again || runs >= MOST_RUNS_HELD) {
      out.confirmed.push(change);
      if (seen.has(change.label)) out.forget.push(change.label);
      continue;
    }
    out.held.push(change);
    out.remember.push({ label: change.label, newValue: change.newValue, runs, firstSeenAt: runs > 1 && counting ? counting.firstSeenAt : new Date(now).toISOString() });
  }
  for (const label of compared) {
    if (changed.has(label)) continue;
    const sighting = seen.get(label);
    if (!sighting) continue;
    if (!within(sighting.seenAt)) out.forget.push(label);
    else if (sighting.newValue !== null) out.interrupted.push(label);
  }
  return out;
}

export interface ConnectionScope {
  site_id: string;
  community_id: string;
  builder_id: string;
}

/** Rows read at once; a request returns no more than a thousand. */
const PAGE = 1000;

/**
 * What earlier runs read and have not seen twice, for every plan of a
 * connection, by plan key and label; null when the table cannot be read,
 * and then nothing is held. A field not read differently for SIGHTING_DAYS
 * goes first, the readings of plans the builder has since dropped with it.
 */
export async function loadSightings(scope: ConnectionScope): Promise<Map<string, Map<string, Sighting>> | null> {
  const cutoff = new Date(Date.now() - SIGHTING_DAYS * DAY_MS).toISOString();
  const { error: pruneError } = await supabase.from("fp_unconfirmed_changes").delete().match(scope).lt("seen_at", cutoff);
  if (pruneError) logger.warn("Old unconfirmed changes could not be cleared", { scope, error: pruneError.message });
  const byPlan = new Map<string, Map<string, Sighting>>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fp_unconfirmed_changes")
      .select("plan_key, field_changed, new_value, run_id, runs, first_seen_at, seen_at")
      .match(scope)
      .order("plan_key")
      .order("field_changed")
      .range(from, from + PAGE - 1);
    if (error) {
      logger.warn("Unconfirmed changes could not be read; changes are queued without a second reading", { scope, error: error.message });
      return null;
    }
    for (const row of data ?? []) {
      const plan = byPlan.get(row.plan_key) ?? new Map<string, Sighting>();
      plan.set(row.field_changed, {
        newValue: row.new_value ?? null,
        runId: row.run_id,
        runs: Number(row.runs) || 1,
        firstSeenAt: row.first_seen_at,
        seenAt: row.seen_at,
      });
      byPlan.set(row.plan_key, plan);
    }
    if ((data ?? []).length < PAGE) return byPlan;
  }
}

/** The new value of each change of a plan already waiting in the queue, by label. */
export async function waitingValues(ids: ConnectionScope & { plan_key: string }): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from("fp_pending_changes")
    .select("field_changed, new_value")
    .match({ ...ids, change_type: "update" })
    .in("status", ["pending", "approving"]);
  if (error) {
    logger.warn("Waiting changes could not be read", { planKey: ids.plan_key, error: error.message });
    return new Map();
  }
  return new Map((data ?? []).filter((r) => r.field_changed).map((r) => [r.field_changed as string, r.new_value as string | null]));
}

/**
 * Keeps what a run read for the changes it held, marks the fields it read
 * the record's way, and forgets what it confirmed or what is out of date.
 * False when what it held could not be kept: then the run queues those
 * changes rather than hold them without a trace.
 */
export async function keepSightings(ids: ConnectionScope & { plan_key: string }, confirmation: Confirmation, runId: string): Promise<boolean> {
  const now = new Date().toISOString();
  let kept = true;
  if (confirmation.remember.length) {
    // Every row carries every column: rows sent together are written with
    // the same columns, and one left out would be written as null.
    const rows = confirmation.remember.map((r) => ({
      ...ids,
      field_changed: r.label,
      new_value: r.newValue,
      run_id: runId,
      runs: r.runs,
      first_seen_at: r.firstSeenAt,
      seen_at: now,
    }));
    const { error } = await supabase.from("fp_unconfirmed_changes").upsert(rows, { onConflict: "site_id,community_id,builder_id,plan_key,field_changed" });
    if (error) {
      logger.warn("Unconfirmed changes could not be kept; queued without a second reading", { planKey: ids.plan_key, error: error.message });
      kept = false;
    }
  }
  if (confirmation.interrupted.length) {
    const { error } = await supabase
      .from("fp_unconfirmed_changes")
      .update({ new_value: null, run_id: runId })
      .match(ids)
      .in("field_changed", confirmation.interrupted);
    if (error) logger.warn("Unconfirmed changes read the record's way could not be marked", { planKey: ids.plan_key, error: error.message });
  }
  if (confirmation.forget.length) {
    const { error } = await supabase.from("fp_unconfirmed_changes").delete().match(ids).in("field_changed", confirmation.forget);
    if (error) logger.warn("Confirmed changes could not be forgotten", { planKey: ids.plan_key, error: error.message });
  }
  return kept;
}

/** Forgets every reading a connection's runs were holding (Reset, connection-clear.ts). */
export async function forgetSightings(scope: ConnectionScope): Promise<void> {
  const { error } = await supabase.from("fp_unconfirmed_changes").delete().match(scope);
  if (error) logger.warn("Unconfirmed changes could not be forgotten", { scope, error: error.message });
}
