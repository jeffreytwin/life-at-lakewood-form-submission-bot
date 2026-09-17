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

// Attention levels (Jeff, 2026-09-16): an error event is one that needs a
// person; the Errors panel shows nothing else. A failure the engine retries
// on its own is a warning the first times. When the same failure (kind,
// location, listing) has already been warned about on ESCALATE_AFTER earlier
// runs inside ESCALATION_WINDOW_MS it is plainly not clearing by itself, so
// the new warning is stored as an error, once: while that problem has an
// open (undismissed) error, further repeats stay warnings.

/**
 * Kinds whose warnings describe a failure a later run retries by itself, and
 * which therefore mean something is stuck if they keep repeating.
 *
 * `rate_limited` is deliberately not one of them. A 429 is the other end
 * asking for less, and it repeats by design until the engine has slowed
 * enough — escalating it would page a person about the one thing they cannot
 * act on. On 2026-09-16 that filled the panel with 57 identical errors.
 */
export const RETRIED_KINDS: ReadonlySet<string> = new Set(["import_failed", "write_failed", "stats_failed", "folder_missing", "run_error"]);
/** Earlier runs' warnings about the same problem before a repeat becomes an error. */
export const ESCALATE_AFTER = 2;
export const ESCALATION_WINDOW_MS = 6 * 3600_000;

export interface PriorEvent {
  level: string;
  kind: string;
  site_id: string | null;
  listing_id: string | null;
  dismissed_at: string | null;
}

const repeatKey = (e: { kind?: unknown; site_id?: unknown; listing_id?: unknown }): string =>
  `${String(e.kind)}|${e.site_id ?? ""}|${e.listing_id ?? ""}`;

/**
 * Pure: promotes this run's retried-kind warnings to errors when earlier
 * runs already warned about the same problem, unless it has an open error
 * already. Returns how many rows were promoted.
 */
export function escalateRepeats(rows: Array<Record<string, unknown>>, prior: PriorEvent[]): number {
  const warned = new Map<string, number>();
  const open = new Set<string>();
  for (const p of prior) {
    const key = repeatKey(p);
    if (p.level === "warn") warned.set(key, (warned.get(key) ?? 0) + 1);
    else if (p.level === "error" && !p.dismissed_at) open.add(key);
  }
  let promoted = 0;
  const hours = Math.round(ESCALATION_WINDOW_MS / 3600_000);
  for (const row of rows) {
    if (row.level !== "warn" || !RETRIED_KINDS.has(String(row.kind))) continue;
    const key = repeatKey(row);
    if (open.has(key)) continue;
    const earlier = warned.get(key) ?? 0;
    if (earlier < ESCALATE_AFTER) continue;
    row.level = "error";
    row.message = `${String(row.message)}; ${earlier} earlier run(s) in the last ${hours} h hit the same failure, so it is not clearing on its own`.slice(0, 1000);
    promoted += 1;
  }
  return promoted;
}

/**
 * A run that stopped on a rate limit, an upstream 5xx or a network fault is
 * retried by the next tick, so it is a warning (escalated if it keeps
 * happening); any other failure needs a look.
 */
export function runErrorLevel(message: string): EventLevel {
  const upstream = /\b(MLSGrid|Wix API[^:]*):? ?(429|5\d\d)\b/i.test(message);
  const network = /timed? ?out|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|network error/i.test(message);
  return upstream || network ? "warn" : "error";
}

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
      const retried = rows.filter((r) => r.level === "warn" && RETRIED_KINDS.has(String(r.kind)));
      if (retried.length) {
        try {
          const { data, error: priorError } = await supabase
            .from("ls_sync_events")
            .select("level, kind, site_id, listing_id, dismissed_at")
            .in("kind", [...new Set(retried.map((r) => String(r.kind)))])
            .in("level", ["warn", "error"])
            .neq("run_key", runKey)
            .gte("at", new Date(Date.now() - ESCALATION_WINDOW_MS).toISOString())
            .limit(2000);
          if (priorError) throw priorError;
          const promoted = escalateRepeats(rows, (data ?? []) as PriorEvent[]);
          counts.warnings -= promoted;
          counts.errors += promoted;
        } catch (error) {
          logger.warn("Listings events escalation check failed", { runKey, error: errorMessage(error) });
        }
      }
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
        handle.event(runErrorLevel(err.message), "run_error", `Run failed at ${err.stage}: ${err.message}`, {
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

/** How long a listing no site ever showed has to sit unchanged before the sweep takes it. */
export const UNMATCHED_RETENTION_DAYS = 60;
/** At most this many per sweep, so a predicate that is wrong cannot empty the table in one night. */
export const UNMATCHED_PURGE_MAX_ROWS = 500;

export interface UnmatchedPurgeResult {
  listings: number;
  mediaRows: number;
  /** The sweep filled its cap, so more are waiting and the next run will take them. */
  hitCap: boolean;
  /** How many went, by status, for the event message. */
  byStatus: Record<string, number>;
}

interface PurgedRow {
  listing_id: string;
  standard_status: string | null;
  city: string | null;
  in_feed: boolean;
  last_change: string | null;
  media_rows: number;
}

/**
 * Retention for listings no site has ever shown (migration 055). A market
 * city holds every Active listing in it whether or not a term matches, and
 * nothing used to delete one, so the unshown set only grew.
 *
 * Status decides, not age: an unmatched listing that is still Active is the
 * inventory the wide city list exists to hold and the unmatched view's whole
 * content, so only listings that can no longer become live are swept, and
 * only once nothing has changed on them for UNMATCHED_RETENTION_DAYS. See the
 * migration for why the clock is modification_timestamp and not last_seen_at.
 *
 * The point of the bound is that the unmatched set is read, not merely
 * stored: it is where a missing term or a missing village shows up. So the
 * predicate is deliberately the complement of what `listUnmatchedListings`
 * selects (`in_feed = true AND standard_status = 'Active'`) -- this can only
 * ever delete rows that view has never shown. Widen it and that stops being
 * true.
 *
 * Writes an event when it deletes something, because a sweep nobody sees is
 * how data gets out of hand quietly -- which is the point of having it. A
 * sweep that deletes nothing stays silent, so the nightly does not log a
 * no-op every night for the two months before the first row is old enough.
 */
export async function purgeUnmatchedListings(
  options: { olderThanDays?: number; maxRows?: number } = {}
): Promise<UnmatchedPurgeResult> {
  const olderThanDays = options.olderThanDays ?? UNMATCHED_RETENTION_DAYS;
  const maxRows = options.maxRows ?? UNMATCHED_PURGE_MAX_ROWS;
  const { data, error } = await supabase.rpc("ls_purge_unmatched_listings", {
    older_than_days: olderThanDays,
    max_rows: maxRows,
  });
  if (error) throw new Error(`purge unmatched listings: ${errorMessage(error)}`);

  const rows = (data ?? []) as PurgedRow[];
  const byStatus: Record<string, number> = {};
  let mediaRows = 0;
  for (const row of rows) {
    const status = row.standard_status || "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    mediaRows += Number(row.media_rows) || 0;
  }
  const result: UnmatchedPurgeResult = { listings: rows.length, mediaRows, hitCap: rows.length >= maxRows, byStatus };
  if (!rows.length) return result;

  const spread = Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([status, n]) => `${n} ${status}`)
    .join(", ");
  const capNote = result.hitCap ? ` The sweep filled its limit of ${maxRows}, so more are waiting for the next one.` : "";
  await recordGlobalEvent({
    level: "info",
    kind: "retention_purge",
    message:
      `Removed ${rows.length} listing(s) no site was showing and ${mediaRows} photo record(s) with them ` +
      `(${spread}; nothing changed on them in ${olderThanDays} days).${capNote}`,
    details: {
      listings: rows.length,
      mediaRows,
      olderThanDays,
      maxRows,
      hitCap: result.hitCap,
      byStatus,
      sample: rows.slice(0, 10).map((r) => ({ listingId: r.listing_id, status: r.standard_status, city: r.city, lastChange: r.last_change })),
    },
  });
  return result;
}

/**
 * An event that belongs to no site and no run: the retention sweep works
 * across every site's market at once. site_id is nullable and the Change Log
 * only filters on it when a site is chosen, so an unfiltered view shows it.
 * Never throws -- a failed note must not fail the sweep that already ran.
 */
async function recordGlobalEvent(event: { level: EventLevel; kind: string; message: string; details?: unknown }): Promise<void> {
  const { error } = await supabase.from("ls_sync_events").insert({
    site_id: null,
    level: event.level,
    kind: event.kind,
    message: event.message,
    details: event.details ?? null,
  });
  if (error) logger.warn("Listings retention event failed", { kind: event.kind, error: errorMessage(error) });
}
