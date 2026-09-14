// The cron tick, every 15 minutes: decides whether a run is due (an
// incremental every hour, a full run once a day after 03:00 UTC), refuses to
// overlap a run still in flight, and runs it inside a budget that leaves
// headroom under the function limit. State the tick needs across
// invocations lives in system_settings.ls_engine_state, the same shape as
// the floor plan nightly.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { INCREMENTAL_EVERY_MINUTES, runReconcile, type ReconcileResult } from "@/lib/listings/reconcile";
import { lastOkRunStartedAt, purgeOldRuns, runningRun } from "@/lib/listings/runs";
import type { RunTrigger } from "@/lib/listings/types";

export const TICK_BUDGET_MS = 240_000; // leave headroom under the function limit
export const FULL_RUN_HOUR_UTC = 3;
/** A run row still 'running' after this long was killed by the platform. */
export const RUN_STALE_AFTER_MS = 10 * 60_000;
/** After a failed run the tick waits this long before trying again (a suspended MLSGrid token is hourly). */
export const RETRY_AFTER_ERROR_MINUTES = 30;

export interface EngineState {
  lastFullDate?: string;
  lastRunAt?: string;
  lastRunKey?: string;
  lastMode?: string;
  lastStatus?: string;
  lastPurgeAt?: string;
}

export interface TickOptions {
  trigger?: RunTrigger;
  /** Run this mode now, whether or not it is due or the engine is enabled. */
  force?: "incremental" | "full";
  allowMassDelete?: boolean;
  now?: Date;
}

const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Pure: which run is due, if any. */
export function decideMode(args: {
  now: Date;
  state: EngineState;
  lastOkIncremental: Date | null;
}): "full" | "incremental" | null {
  const { now, state, lastOkIncremental } = args;
  if (state.lastStatus === "error" && state.lastRunAt) {
    const sinceError = now.getTime() - new Date(state.lastRunAt).getTime();
    if (sinceError < RETRY_AFTER_ERROR_MINUTES * 60_000) return null;
  }
  if (now.getUTCHours() >= FULL_RUN_HOUR_UTC && state.lastFullDate !== utcDate(now)) return "full";
  const dueAfterMs = (INCREMENTAL_EVERY_MINUTES - 5) * 60_000;
  if (!lastOkIncremental || now.getTime() - lastOkIncremental.getTime() >= dueAfterMs) return "incremental";
  return null;
}

export async function runEngineTick(opts: TickOptions = {}): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date();
  const trigger = opts.trigger ?? "cron";
  const { data: settings, error } = await supabase
    .from("system_settings")
    .select("ls_engine_enabled, ls_engine_state")
    .eq("id", 1)
    .single();
  if (error || !settings) return { skipped: "no settings row" };
  if (!settings.ls_engine_enabled && !opts.force) return { skipped: "engine disabled" };
  const state = (settings.ls_engine_state ?? {}) as EngineState;

  const inFlight = await runningRun(RUN_STALE_AFTER_MS);
  if (inFlight) return { skipped: `run ${inFlight.id} in progress since ${inFlight.started_at}` };

  const mode = opts.force ?? decideMode({ now, state, lastOkIncremental: await lastOkRunStartedAt("incremental") });
  if (!mode) return { skipped: "not due", lastRunAt: state.lastRunAt ?? null };

  logger.info("Listings engine run starting", { mode, trigger });
  const result: ReconcileResult = await runReconcile({
    mode,
    trigger,
    deadline: now.getTime() + TICK_BUDGET_MS,
    allowMassDelete: opts.allowMassDelete,
  });

  const nextState: EngineState = {
    ...state,
    lastRunAt: now.toISOString(),
    lastRunKey: result.runKey,
    lastMode: mode,
    lastStatus: result.status,
  };
  if (mode === "full" && result.status === "ok" && !result.truncated) nextState.lastFullDate = utcDate(now);
  let purged: { runs: number; events: number } | null = null;
  if (mode === "full") {
    try {
      purged = await purgeOldRuns();
      nextState.lastPurgeAt = now.toISOString();
    } catch (purgeError) {
      logger.warn("Listings retention purge failed", { error: String(purgeError) });
    }
  }
  await supabase.from("system_settings").update({ ls_engine_state: nextState }).eq("id", 1);
  return { mode, ...summarize(result), purged };
}

export function summarize(result: ReconcileResult): Record<string, unknown> {
  return {
    runKey: result.runKey,
    status: result.status,
    stage: result.stage,
    truncated: result.truncated,
    fetched: result.fetched,
    relevant: result.relevant,
    missing: result.missing,
    mlsgrid: result.mlsgrid,
    sites: result.sites,
    counts: {
      inserted: result.counts.inserted,
      updated: result.counts.updated,
      deleted: result.counts.deleted,
      unstaged: result.counts.unstaged,
      deletesSkipped: result.counts.deletes_skipped,
      writesFailed: result.counts.writes_failed,
      warnings: result.counts.warnings,
      errors: result.counts.errors,
      wixRequests: result.counts.wix_requests,
    },
    error: result.error ?? null,
  };
}
