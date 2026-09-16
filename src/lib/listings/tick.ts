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
import { runStandalonePhotoJob, type StandalonePhotoResult } from "@/lib/listings/photos";
import type { RunTrigger } from "@/lib/listings/types";
import type { DiscoverCursor } from "@/lib/listings/discover";

export const TICK_BUDGET_MS = 240_000; // leave headroom under the function limit
export const FULL_RUN_HOUR_UTC = 3;
/** A run row still 'running' after this long was killed by the platform. */
export const RUN_STALE_AFTER_MS = 10 * 60_000;
/** After a failed run the tick waits this long before trying again (a suspended MLSGrid token is hourly). */
export const RETRY_AFTER_ERROR_MINUTES = 30;
/** After a run, the photo backlog gets the rest of the tick only when at least this much is left. */
export const PHOTOS_MIN_REMAINING_MS = 45_000;

export interface EngineState {
  lastFullDate?: string;
  lastRunAt?: string;
  lastRunKey?: string;
  lastMode?: string;
  lastStatus?: string;
  lastPurgeAt?: string;
  /** A discovery scan in progress (written by the discover run itself); the tick continues it when nothing else is due. */
  discoverCursor?: DiscoverCursor;
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
}): "full" | "incremental" | "discover" | null {
  const { now, state, lastOkIncremental } = args;
  if (state.lastStatus === "error" && state.lastRunAt) {
    const sinceError = now.getTime() - new Date(state.lastRunAt).getTime();
    if (sinceError < RETRY_AFTER_ERROR_MINUTES * 60_000) return null;
  }
  if (now.getUTCHours() >= FULL_RUN_HOUR_UTC && state.lastFullDate !== utcDate(now)) return "full";
  const dueAfterMs = (INCREMENTAL_EVERY_MINUTES - 5) * 60_000;
  if (!lastOkIncremental || now.getTime() - lastOkIncremental.getTime() >= dueAfterMs) return "incremental";
  if (state.discoverCursor?.nextLink) return "discover";
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

  const deadline = now.getTime() + TICK_BUDGET_MS;
  const mode = opts.force ?? decideMode({ now, state, lastOkIncremental: await lastOkRunStartedAt("incremental") });
  if (!mode) {
    // Nothing due: the tick works the photo backlog instead, as its own run when there is one.
    const photos = await runStandalonePhotoJob({ trigger, deadline });
    return { skipped: "not due", lastRunAt: state.lastRunAt ?? null, photos: photos.status === "skipped" ? null : photos };
  }

  logger.info("Listings engine run starting", { mode, trigger });
  const result: ReconcileResult = await runReconcile({
    mode,
    trigger,
    deadline,
    allowMassDelete: opts.allowMassDelete,
  });

  // Re-read the state: a discover run stores or clears its cursor there while this tick holds the copy from before.
  const { data: after } = await supabase.from("system_settings").select("ls_engine_state").eq("id", 1).single();
  const nextState: EngineState = {
    ...((after?.ls_engine_state as EngineState | null) ?? state),
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

  // The run's own photo step is capped; with time left the tick keeps draining the backlog.
  let photosAfter: StandalonePhotoResult | null = null;
  if (Date.now() < deadline - PHOTOS_MIN_REMAINING_MS) {
    try {
      const after = await runStandalonePhotoJob({ trigger, deadline });
      if (after.status !== "skipped") photosAfter = after;
    } catch (photoError) {
      logger.warn("Listings photo backlog pass failed", { error: String(photoError) });
    }
  }
  return { mode, ...summarize(result), purged, photosAfter };
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
    photos: result.photos ?? null,
    discover: result.discover ?? null,
    error: result.error ?? null,
  };
}
