// Nightly sync orchestration, driven by a frequent cron tick.
//
// The tick fires every 15 minutes; this decides whether it's time to run
// (Hub-configurable: enabled flag + hour in ET, stored on system_settings),
// processes nightly-eligible connections in time-budgeted batches (a cycle
// resumes across ticks until every connection is covered), and sends the
// digest SMS when the cycle completes.
//
// Eligibility: connection active, builder active, and onboarded_at set —
// i.e. the connection has succeeded at least one manual run. New builders
// never reach automation without passing through human review first.
//
// "Sync now" (Jeff, 2026-09-25) starts the same cycle by hand, whatever the
// hour and whether or not the nightly one is on; the tick carries it on
// from there, a minute at a time, until every connection has had its run.
// One tick works at a time (fp_tick_lock_until), and each connection is
// held while it runs (runs.ts), so a Run pressed during a sync does not
// run the same connection twice at once.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { readsThroughBrowser } from "@/lib/floorplans/sync";
import { holdRun, runHeld, sweepCutOffRuns } from "@/lib/floorplans/runs";

const TICK_BUDGET_MS = 240_000; // leave headroom under the function limit
// A builder read through a browser takes minutes, not seconds, so the tick
// only starts one with most of its budget left; otherwise it waits for the
// next tick, where it goes first. Started too late it would be killed
// mid-run, with nothing written down (Jeff, 2026-09-22).
const RENDER_RESERVE_MS = 200_000;

export interface NightlyState {
  cycleDate?: string; // ET date the current/last cycle belongs to
  startedAt?: string;
  completedAt?: string;
  ran?: number;
  failed?: number;
  /** Started with "Sync now" rather than by the clock: it runs even with the nightly sync off. */
  manual?: boolean;
}

/** A tick holds the lock no longer than a function lives. */
const TICK_LOCK_MS = 320_000;

/** Whether a cycle has started and not finished. Pure; exported for tests. */
export function cycleInProgress(state: NightlyState | null | undefined): boolean {
  return Boolean(state?.startedAt && !state.completedAt);
}

/**
 * Whether tonight's cycle is owed: the nightly sync is on, its hour has
 * come, and no cycle begun since then has finished. A "Sync now" pressed
 * after the hour counts as tonight's; one pressed before it does not.
 * Pure; exported for tests.
 */
export function nightlyDue(
  state: NightlyState | null | undefined,
  settings: { fp_nightly_enabled: boolean; fp_nightly_hour: number },
  now = new Date()
): boolean {
  if (!settings.fp_nightly_enabled || cycleInProgress(state)) return false;
  const { date: today, hour } = etParts(now);
  if (hour < settings.fp_nightly_hour) return false;
  if (!state?.startedAt || !state.completedAt) return true;
  const began = etParts(new Date(state.startedAt));
  return !(began.date === today && began.hour >= settings.fp_nightly_hour);
}

function etParts(now = new Date()): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10) % 24,
  };
}

async function sendDigest(phone: string, message: string) {
  try {
    const { getTwilioClient, getTwilioPhoneNumber } = await import("@/lib/twilio/client");
    await getTwilioClient().messages.create({
      to: phone,
      from: getTwilioPhoneNumber(),
      body: message,
    });
  } catch (error) {
    logger.error("Floor plan digest SMS failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Take the tick lock; false while another tick holds it. */
async function holdTick(): Promise<boolean> {
  const now = Date.now();
  const { data, error } = await supabase
    .from("system_settings")
    .update({ fp_tick_lock_until: new Date(now + TICK_LOCK_MS).toISOString() })
    .eq("id", 1)
    .or(`fp_tick_lock_until.is.null,fp_tick_lock_until.lt.${new Date(now).toISOString()}`)
    .select("id");
  if (error) throw new Error(`tick lock: ${error.message}`);
  return (data ?? []).length > 0;
}

async function letGoOfTick(): Promise<void> {
  await supabase.from("system_settings").update({ fp_tick_lock_until: null }).eq("id", 1);
}

/** The connections a cycle begun at startedAt still owes a run, in the order it gives them. */
export async function owedRuns(startedAt: string) {
  const { data: pending } = await supabase
    .from("fp_builder_communities")
    .select("id, last_run_at, extractor_params, fp_builders:builder_id(name, active, extraction_method)")
    .eq("active", true)
    .not("onboarded_at", "is", null)
    .or(`last_run_at.is.null,last_run_at.lt.${startedAt}`);
  const builderOf = (c: { fp_builders: unknown }) =>
    c.fp_builders as { name: string; active: boolean; extraction_method: string | null } | null;
  return (pending ?? [])
    .filter((c) => builderOf(c)?.active)
    .map((c) => ({ id: c.id as string, builder: builderOf(c)!, params: c.extractor_params as Record<string, unknown> | null }));
}

/**
 * Start a cycle by hand ("Sync now"). Null when one is already going;
 * the tick that follows, and every tick after it, carries it on.
 */
export async function startSync(): Promise<NightlyState | null> {
  const { data: settings, error } = await supabase
    .from("system_settings")
    .select("fp_nightly_state")
    .eq("id", 1)
    .single();
  if (error || !settings) throw new Error(`sync settings: ${error?.message ?? "no settings row"}`);
  if (cycleInProgress(settings.fp_nightly_state as NightlyState | null)) return null;
  const state: NightlyState = {
    cycleDate: etParts().date,
    startedAt: new Date().toISOString(),
    ran: 0,
    failed: 0,
    manual: true,
  };
  await supabase.from("system_settings").update({ fp_nightly_state: state }).eq("id", 1);
  logger.info("Floor plan sync started by hand");
  return state;
}

export async function runNightlyTick(): Promise<Record<string, unknown>> {
  if (!(await holdTick())) return { skipped: "another tick is running" };
  try {
    return await tick();
  } finally {
    await letGoOfTick();
  }
}

async function tick(): Promise<Record<string, unknown>> {
  // Runs cut off by the function's time limit, whoever started them.
  const cutOff = await sweepCutOffRuns();

  const { data: settings, error } = await supabase
    .from("system_settings")
    .select("fp_nightly_enabled, fp_nightly_hour, fp_digest_phone, fp_nightly_state")
    .eq("id", 1)
    .single();
  if (error || !settings) return { skipped: "no settings row" };

  let state = (settings.fp_nightly_state ?? {}) as NightlyState;
  if (cycleInProgress(state)) {
    // A nightly cycle stops when the nightly sync is turned off; one
    // started by hand goes on.
    if (!settings.fp_nightly_enabled && !state.manual) return { skipped: "nightly disabled", cutOff };
  } else if (nightlyDue(state, settings)) {
    state = { cycleDate: etParts().date, startedAt: new Date().toISOString(), ran: 0, failed: 0 };
    await supabase.from("system_settings").update({ fp_nightly_state: state }).eq("id", 1);
    logger.info("Floor plan nightly cycle starting", { today: state.cycleDate });
  } else {
    return {
      skipped: !settings.fp_nightly_enabled ? "nightly disabled" : state.completedAt ? "already completed today" : `waiting for ${settings.fp_nightly_hour}:00 ET`,
      cutOff,
    };
  }

  const startedAt = state.startedAt!;
  const todo = await owedRuns(startedAt);

  let ran = state.ran ?? 0;
  let failed = state.failed ?? 0;
  const deadline = Date.now() + TICK_BUDGET_MS;
  let processed = 0;
  let busy = 0;

  for (const conn of todo) {
    const needs = readsThroughBrowser(conn.builder.name, conn.builder.extraction_method, conn.params) ? RENDER_RESERVE_MS : 0;
    if (Date.now() + needs > deadline) {
      // Out of room for this one; it is first in line on the next tick.
      if (needs === 0) break;
      continue;
    }
    // A connection someone is running by hand already has its run.
    if (!(await holdRun(conn.id))) {
      busy += 1;
      continue;
    }
    const result = await runHeld(conn.id);
    processed += 1;
    ran += 1;
    if (result.status === "failed" || result.status === "partial") failed += 1;
  }

  const remaining = todo.length - processed;
  const nextState: NightlyState = { ...state, ran, failed };

  if (remaining <= 0) {
    nextState.completedAt = new Date().toISOString();
    const { count: pendingCount } = await supabase
      .from("fp_pending_changes")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    const { count: starredTouched } = await supabase
      .from("fp_follow_up_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    // Name what needs a person, not just how many: a builder page that
    // broke reads "zero results" or "partial" here, worst first.
    const { data: failing } = await supabase
      .from("fp_builder_communities")
      .select("last_run_status, consecutive_failures, fp_builders:builder_id(name), fp_communities:community_id(name)")
      .eq("active", true)
      .gt("consecutive_failures", 0)
      .order("consecutive_failures", { ascending: false })
      .limit(5);
    const attention = (failing ?? []).map((c) => {
      const b = c.fp_builders as unknown as { name: string } | null;
      const k = c.fp_communities as unknown as { name: string } | null;
      return `${b?.name ?? "?"}/${k?.name ?? "?"} (${(c.last_run_status ?? "").slice(0, 60)}, ${c.consecutive_failures}×)`;
    });
    const digest =
      `Floor plan sync: ${pendingCount ?? 0} changes awaiting review` +
      (starredTouched ? ` (${starredTouched} starred-plan follow-ups open)` : "") +
      `. Ran ${ran} connections${failed ? `, ${failed} failed` : ""}.` +
      (attention.length ? ` Needs attention: ${attention.join("; ")}.` : "");
    logger.info("Floor plan sync cycle complete", { ran, failed, pendingCount, manual: state.manual === true });
    if (settings.fp_digest_phone) await sendDigest(settings.fp_digest_phone, digest);
  }

  await supabase.from("system_settings").update({ fp_nightly_state: nextState }).eq("id", 1);
  return { processed, busy, cutOff, remaining: Math.max(0, remaining), ran, failed, complete: remaining <= 0 };
}
