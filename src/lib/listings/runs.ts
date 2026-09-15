// Run and event records (ls_sync_runs, ls_sync_events): the same two-level
// trail the Longboat Key pipeline keeps in SyncRuns / SyncEvents. A run row
// is inserted at start (status running) and updated at checkpoints, so a
// tick killed by the function limit still leaves its stage and partial
// counts. Events buffer in memory and flush in chunks; nothing here throws
// into the run.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import type { RunMode, RunTrigger } from "@/lib/listings/types";

export type EventLevel = "info" | "warn" | "error";

export interface EventFields {
  listingId?: string | null;
  address?: string | null;
  village?: string | null;
  siteId?: string | null;
  details?: unknown;
}

export interface RunCounts {
  inserted: number;
  updated: number;
  deleted: number;
  unstaged: number;
  restaged: number;
  promoted: number;
  deletes_skipped: number;
  images_downloaded: number;
  images_imported: number;
  images_failed: number;
  mlsgrid_request_count: number;
  mlsgrid_listing_count: number;
  mlsgrid_items_fetched: number;
  mlsgrid_bytes: number;
  fetch_window_minutes: number | null;
  wix_requests: number;
  wix_rate_limited: number;
  gap_minutes: number | null;
  warnings: number;
  errors: number;
  writes_failed: number;
  stats_refreshed: boolean;
}

export function emptyCounts(): RunCounts {
  return {
    inserted: 0, updated: 0, deleted: 0, unstaged: 0, restaged: 0, promoted: 0, deletes_skipped: 0,
    images_downloaded: 0, images_imported: 0, images_failed: 0,
    mlsgrid_request_count: 0, mlsgrid_listing_count: 0, mlsgrid_items_fetched: 0, mlsgrid_bytes: 0,
    fetch_window_minutes: null, wix_requests: 0, wix_rate_limited: 0, gap_minutes: null,
    warnings: 0, errors: 0, writes_failed: 0, stats_refreshed: false,
  };
}

const MAX_EVENT_BUFFER = 1500;
const FLUSH_CHUNK = 200;

export interface RunHandle {
  id: string | null;
  runKey: string;
  mode: RunMode;
  siteId: string | null;
  startedAt: Date;
  stage: string;
  counts: RunCounts;
  event(level: EventLevel, kind: string, message: string, fields?: EventFields): void;
  flush(): Promise<void>;
  checkpoint(stage: string): Promise<void>;
  finish(status: "ok" | "error", error?: { stage: string; message: string; stack?: string }): Promise<void>;
}

/** The newest reconcile run (photo runs do not count: the gap check is about the pulls). */
export async function previousRunStartedAt(): Promise<Date | null> {
  const { data } = await supabase
    .from("ls_sync_runs")
    .select("started_at")
    .is("site_id", null)
    .neq("mode", "photos")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.started_at ? new Date(data.started_at) : null;
}

/**
 * The incremental watermark: the newest incremental run that finished ok
 * and was not truncated. A full run never advances it (it only re-fetches
 * ids already held), and a truncated run must be re-pulled.
 */
export async function lastCompleteIncrementalStartedAt(): Promise<Date | null> {
  const { data } = await supabase
    .from("ls_sync_runs")
    .select("started_at")
    .is("site_id", null)
    .eq("mode", "incremental")
    .eq("status", "ok")
    .eq("stage", "done")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.started_at ? new Date(data.started_at) : null;
}

export async function lastOkRunStartedAt(mode: RunMode): Promise<Date | null> {
  const { data } = await supabase
    .from("ls_sync_runs")
    .select("started_at")
    .is("site_id", null)
    .eq("mode", mode)
    .eq("status", "ok")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.started_at ? new Date(data.started_at) : null;
}

/** A run still marked running, or null. Rows older than `staleAfterMs` are marked killed on the way. */
export async function runningRun(staleAfterMs: number): Promise<{ id: string; started_at: string } | null> {
  const { data } = await supabase
    .from("ls_sync_runs")
    .select("id, started_at, stage")
    .is("site_id", null)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(5);
  const now = Date.now();
  let live: { id: string; started_at: string } | null = null;
  for (const row of (data ?? []) as { id: string; started_at: string; stage: string | null }[]) {
    if (now - new Date(row.started_at).getTime() < staleAfterMs) {
      live = row;
      continue;
    }
    await supabase
      .from("ls_sync_runs")
      .update({
        status: "error",
        error_stage: row.stage ?? "unknown",
        error_message: "killed: the invocation ended before the run recorded a result",
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
  return live;
}

export async function startRun(args: {
  mode: RunMode;
  trigger: RunTrigger;
  siteId?: string | null;
  runKey?: string;
  startedAt?: Date;
}): Promise<RunHandle> {
  const startedAt = args.startedAt ?? new Date();
  const runKey = args.runKey ?? `${args.mode}:${startedAt.toISOString()}`;
  const counts = emptyCounts();
  let buffer: Array<Record<string, unknown>> = [];
  let dropped = 0;
  let droppedNoted = false;
  let stage = "start";
  let id: string | null = null;

  const { data, error } = await supabase
    .from("ls_sync_runs")
    .insert({
      site_id: args.siteId ?? null,
      run_key: runKey,
      mode: args.mode,
      trigger: args.trigger,
      status: "running",
      stage,
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) logger.warn("Listings run row insert failed", { runKey, error: errorMessage(error) });
  else id = data.id;

  function row(level: EventLevel, kind: string, message: string, fields: EventFields): Record<string, unknown> {
    let details: unknown = null;
    if (fields.details !== undefined && fields.details !== null) {
      try {
        const json = JSON.stringify(fields.details);
        details = json.length > 8000 ? { truncated: json.slice(0, 8000) } : JSON.parse(json);
      } catch {
        details = { note: "details not serialisable" };
      }
    }
    return {
      run_id: id,
      run_key: runKey,
      site_id: fields.siteId ?? args.siteId ?? null,
      listing_id: fields.listingId ?? null,
      at: new Date().toISOString(),
      level,
      kind,
      message: String(message).slice(0, 1000),
      address: fields.address ? String(fields.address).slice(0, 300) : null,
      village: fields.village ? String(fields.village).slice(0, 200) : null,
      details,
    };
  }

  const handle: RunHandle = {
    id,
    runKey,
    mode: args.mode,
    siteId: args.siteId ?? null,
    startedAt,
    get stage() {
      return stage;
    },
    set stage(value: string) {
      stage = value;
    },
    counts,
    event(level, kind, message, fields = {}) {
      if (level === "warn") counts.warnings += 1;
      else if (level === "error") counts.errors += 1;
      if (buffer.length >= MAX_EVENT_BUFFER) {
        dropped += 1;
        if (!droppedNoted) {
          droppedNoted = true;
          buffer.push(row("warn", "events_dropped", `Event buffer cap (${MAX_EVENT_BUFFER}) reached; further events in this run are counted but not stored`, {}));
        }
        return;
      }
      buffer.push(row(level, kind, message, fields));
    },
    async flush() {
      if (!buffer.length) return;
      const rows = buffer;
      buffer = [];
      for (let i = 0; i < rows.length; i += FLUSH_CHUNK) {
        const { error: insError } = await supabase.from("ls_sync_events").insert(rows.slice(i, i + FLUSH_CHUNK));
        if (insError) logger.warn("Listings events flush failed", { runKey, error: errorMessage(insError), rows: rows.length });
      }
    },
    async checkpoint(nextStage) {
      stage = nextStage;
      await handle.flush();
      if (!id) return;
      const { error: updError } = await supabase.from("ls_sync_runs").update({ stage, ...counts }).eq("id", id);
      if (updError) logger.warn("Listings run checkpoint failed", { runKey, error: errorMessage(updError) });
    },
    async finish(status, err) {
      if (err) {
        handle.event("error", "run_error", `Run failed at ${err.stage}: ${err.message}`, {
          details: { stage: err.stage, stack: err.stack?.slice(0, 2000) },
        });
      }
      await handle.flush();
      const finishedAt = new Date();
      const patch: Record<string, unknown> = {
        status,
        stage: err ? stage : stage === "start" ? "done" : stage,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        ...counts,
        warnings: counts.warnings + dropped,
        error_stage: err?.stage ?? null,
        error_message: err?.message?.slice(0, 1000) ?? null,
        error_stack: err?.stack?.slice(0, 2000) ?? null,
      };
      if (!id) return;
      const { error: updError } = await supabase.from("ls_sync_runs").update(patch).eq("id", id);
      if (updError) logger.warn("Listings run finish failed", { runKey, error: errorMessage(updError) });
    },
  };

  return handle;
}

/** Retention: events older than 30 days; runs older than 90 days, never below the newest 50. */
export async function purgeOldRuns(): Promise<{ runs: number; events: number }> {
  const eventsCutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: eventsDeleted } = await supabase.from("ls_sync_events").delete().lt("at", eventsCutoff).select("id");
  const { data: keep } = await supabase
    .from("ls_sync_runs")
    .select("started_at")
    .order("started_at", { ascending: false })
    .range(49, 49);
  const floor = keep?.[0]?.started_at ? new Date(keep[0].started_at).getTime() : null;
  const ageCutoff = Date.now() - 90 * 24 * 3600_000;
  let runs = 0;
  if (floor !== null) {
    const cutoff = new Date(Math.min(floor, ageCutoff)).toISOString();
    const { data } = await supabase.from("ls_sync_runs").delete().lt("started_at", cutoff).select("id");
    runs = (data ?? []).length;
  }
  return { runs, events: (eventsDeleted ?? []).length };
}
