// The watch list (Jeff, 2026-10-17): "coming soon" neighborhoods a person
// is waiting on, from an announcement or added by hand. The daily scan
// looks for homes in each (new-neighborhoods.ts); when it finds any, it
// raises a new-neighborhood alert and marks the entry found.

import { supabase } from "@/lib/supabase/client";
import { failedAt as failed } from "@/lib/shared/describe-error";
import type { Outcome } from "@/lib/community-alerts/alerts";
import { placeKey, siteContext, SITE_SOURCES } from "@/lib/community-alerts/new-neighborhoods";

export interface WatchEntry {
  id: string;
  name: string;
  site: string | null;
  note: string | null;
  sourceUrl: string | null;
  status: "watching" | "found" | "stopped";
  createdAt: string;
  foundAt: string | null;
  alertId: string | null;
}

interface WatchRow {
  id: string;
  name: string;
  note: string | null;
  source_url: string | null;
  status: WatchEntry["status"];
  created_at: string;
  found_at: string | null;
  alert_id: string | null;
  fp_sites: { domain: string } | null;
}

const toEntry = (r: WatchRow): WatchEntry => ({
  id: r.id,
  name: r.name,
  site: r.fp_sites?.domain ?? null,
  note: r.note,
  sourceUrl: r.source_url,
  status: r.status,
  createdAt: r.created_at,
  foundAt: r.found_at,
  alertId: r.alert_id,
});

/** What is being watched, and what was found lately (the last 90 days). */
export async function listWatch(): Promise<{ watching: WatchEntry[]; found: WatchEntry[] }> {
  const columns = "id, name, note, source_url, status, created_at, found_at, alert_id, fp_sites:site_id(domain)";
  const { data: watching, error } = await supabase
    .from("ca_watch_list")
    .select(columns)
    .eq("status", "watching")
    .order("created_at", { ascending: false });
  if (error) throw failed("reading the watch list", error);
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: found, error: foundError } = await supabase
    .from("ca_watch_list")
    .select(columns)
    .eq("status", "found")
    .gte("found_at", since)
    .order("found_at", { ascending: false });
  if (foundError) throw failed("reading what the watch list found", foundError);
  return {
    watching: ((watching ?? []) as unknown as WatchRow[]).map(toEntry),
    found: ((found ?? []) as unknown as WatchRow[]).map(toEntry),
  };
}

export interface NewWatch {
  site: string;
  name: string;
  note?: string | null;
  sourceUrl?: string | null;
}

/**
 * Starts watching a name on a site. A name either engine already has is
 * refused: there is nothing to wait for. Watching a name lifts an ignore
 * of it, since the person has said they want to hear about it.
 */
export async function addWatch(entry: NewWatch): Promise<Outcome & { id?: string }> {
  const name = entry.name.trim();
  if (!name) return { ok: false, status: 400, error: "Name the neighborhood" };
  if (!(entry.site in SITE_SOURCES)) {
    return { ok: false, status: 400, error: `Pick a site: ${Object.keys(SITE_SOURCES).join(", ")}` };
  }
  const key = placeKey(name);
  if (!key) return { ok: false, status: 400, error: `"${name}" is only the place's own name` };
  const sourceUrl = entry.sourceUrl?.trim() || null;
  if (sourceUrl && !/^https?:\/\//.test(sourceUrl)) return { ok: false, status: 400, error: "The link must start with http(s)://" };
  const ctx = await siteContext(entry.site);
  if (!ctx) return { ok: false, status: 400, error: `No site ${entry.site} in the new-build engine` };
  if (ctx.known.has(key)) {
    return { ok: false, status: 409, error: `${name} is already in the new-build or listings engine for ${entry.site}` };
  }
  const { error: unignoreError } = await supabase
    .from("ca_ignored_neighborhoods")
    .delete()
    .eq("site_id", ctx.fpSiteId)
    .eq("name_key", key);
  if (unignoreError) throw failed("lifting the ignore", unignoreError);
  const { data, error } = await supabase
    .from("ca_watch_list")
    .insert({
      site_id: ctx.fpSiteId,
      name,
      name_key: key,
      note: entry.note?.trim().slice(0, 1000) || null,
      source_url: sourceUrl,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return { ok: false, status: 409, error: `${name} is already being watched on ${entry.site}` };
  if (error) throw failed("adding to the watch list", error);
  return { ok: true, id: data.id };
}

export async function stopWatching(id: string): Promise<Outcome> {
  const { data, error } = await supabase
    .from("ca_watch_list")
    .update({ status: "stopped", stopped_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "watching")
    .select("id");
  if (error) throw failed("taking it off the watch list", error);
  if (!data?.length) return { ok: false, status: 404, error: "Nothing watched by that id" };
  return { ok: true };
}

/**
 * An announcement's Watch button: the neighborhood goes on the watch list
 * with what the announcement said, and the alert closes as done, since
 * watching it is the action it asked for.
 */
export async function watchFromAlert(alertId: string): Promise<Outcome> {
  const { data: alert, error } = await supabase
    .from("ca_alerts")
    .select("id, kind, status, name, detail")
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw failed("reading the alert", error);
  if (!alert || alert.status !== "open") return { ok: false, status: 404, error: "No open alert by that id" };
  if (alert.kind !== "announcement") return { ok: false, status: 400, error: "Only an announcement can be watched" };
  const detail = (alert.detail ?? {}) as { site?: string; summary?: string; sources?: string[] };
  const added = await addWatch({
    site: detail.site ?? "",
    name: alert.name,
    note: detail.summary ?? null,
    sourceUrl: detail.sources?.[0] ?? null,
  });
  // Already watched is as good as watched.
  if (!added.ok && added.status !== 409) return added;
  const now = new Date().toISOString();
  const { error: closeError } = await supabase
    .from("ca_alerts")
    .update({ status: "done", resolved_at: now, updated_at: now })
    .eq("id", alertId)
    .eq("status", "open");
  if (closeError) throw failed("closing the announcement", closeError);
  return { ok: true };
}
