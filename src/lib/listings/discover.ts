// Discovery: a site's starting inventory. The hourly pull only sees what the
// MLS modified in its window and the full run only re-verifies ids the
// engine already holds, so a site whose live galleries cannot seed it (no
// MLS source URLs, or a site that wants its photos fetched afresh) needs one
// pass over every Active listing MLS-wide: keep the ones in a market city
// the engine does not know, pull those by id with their Media, and hand
// them to the normal classify / photos / write path.
//
// Stellar (mfrmls) has 110,000 Active listings, some 550 pages at MLSGrid's
// pace, more than one function invocation allows. A scan the deadline cuts
// short leaves the newest ModificationTimestamp it read here, in
// system_settings.ls_engine_state.discoverCursor, and the next discover run
// (from the Hub, or the cron tick when nothing else is due) asks for Active
// listings modified after it: MLSGrid returns replication results in
// ModificationTimestamp order and refuses a stale @odata.nextLink ("$skip
// value is very high", seen at $skip=84800 on 2026-09-16), so the timestamp
// is the only cursor that survives across invocations. A completed scan
// clears the cursor.

import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/shared/errors";

export interface DiscoverCursor {
  /** The newest ModificationTimestamp the scan has read; the next run asks for records modified after it. */
  sinceTimestamp: string;
  /** When the scan this cursor belongs to began. */
  startedAt: string;
  /** Records scanned and new market-city listings found so far, across the scan's runs. */
  scanned: number;
  found: number;
  pages: number;
  /** MLSGrid's count for the filter when the scan started, if it gave one. */
  expectedCount: number | null;
}

/** What one discover run did, for the run summary and the Hub. */
export interface DiscoverSummary {
  /** Whether this run picked up an earlier scan's cursor. */
  resumed: boolean;
  /** Records scanned in this run, and across the whole scan so far. */
  scanned: number;
  scannedTotal: number;
  expectedCount: number | null;
  pages: number;
  /** New listings in a market city found in this run, and across the scan. */
  found: number;
  foundTotal: number;
  /** Of this run's finds, how many were pulled by id with their Media (the rest wait for the nightly full run). */
  pulled: number;
  /** True when the scan reached MLSGrid's last page. */
  complete: boolean;
}

function asCursor(value: unknown): DiscoverCursor | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<DiscoverCursor>;
  if (typeof c.sinceTimestamp !== "string" || Number.isNaN(Date.parse(c.sinceTimestamp))) return null;
  return {
    sinceTimestamp: c.sinceTimestamp,
    startedAt: typeof c.startedAt === "string" ? c.startedAt : new Date(0).toISOString(),
    scanned: typeof c.scanned === "number" ? c.scanned : 0,
    found: typeof c.found === "number" ? c.found : 0,
    pages: typeof c.pages === "number" ? c.pages : 0,
    expectedCount: typeof c.expectedCount === "number" ? c.expectedCount : null,
  };
}

/** The cursor of a scan in progress, or null. */
export async function loadDiscoverCursor(): Promise<DiscoverCursor | null> {
  const { data, error } = await supabase.from("system_settings").select("ls_engine_state").eq("id", 1).single();
  if (error || !data) return null;
  return asCursor((data.ls_engine_state as { discoverCursor?: unknown } | null)?.discoverCursor);
}

/** Stores the cursor to resume from, or clears it when the scan is complete. Merges into the engine state as it is now. */
export async function saveDiscoverCursor(cursor: DiscoverCursor | null): Promise<void> {
  const { data, error: loadError } = await supabase.from("system_settings").select("ls_engine_state").eq("id", 1).single();
  if (loadError) throw new Error(`load engine state: ${errorMessage(loadError)}`);
  const state = { ...((data?.ls_engine_state as Record<string, unknown> | null) ?? {}) };
  if (cursor) state.discoverCursor = cursor;
  else delete state.discoverCursor;
  const { error } = await supabase.from("system_settings").update({ ls_engine_state: state }).eq("id", 1);
  if (error) throw new Error(`save discover cursor: ${errorMessage(error)}`);
}

/**
 * The cursor a run leaves behind: the scan's running totals plus the resume
 * point, or null when the scan is complete. A truncated run that read
 * nothing keeps the prior resume point (it made no progress).
 */
export function nextCursor(
  prior: DiscoverCursor | null,
  run: { truncated: boolean; lastModificationTimestamp: string | null; scanned: number; found: number; pages: number; expectedCount: number | null; startedAt: Date }
): DiscoverCursor | null {
  if (!run.truncated) return null;
  const since = run.lastModificationTimestamp ?? prior?.sinceTimestamp;
  if (!since) return null;
  return {
    sinceTimestamp: since,
    startedAt: prior?.startedAt ?? run.startedAt.toISOString(),
    scanned: (prior?.scanned ?? 0) + run.scanned,
    found: (prior?.found ?? 0) + run.found,
    pages: (prior?.pages ?? 0) + run.pages,
    expectedCount: prior?.expectedCount ?? run.expectedCount,
  };
}
