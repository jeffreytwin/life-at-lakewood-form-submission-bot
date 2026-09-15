"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ListingsTabs from "../tabs";
import RunTags from "../run-tags";
import { duration, fmtDateTime, humanizeMessage, levelBadge, megabytes, modeLabel, responseError, runOutcome, siteColors, triggerLabel } from "../format";

interface Run {
  id: string;
  run_key: string;
  mode: string;
  trigger: string;
  status: string;
  stage: string | null;
  started_at: string;
  duration_ms: number | null;
  inserted: number;
  updated: number;
  deleted: number;
  unstaged: number;
  deletes_skipped: number;
  writes_failed: number;
  warnings: number;
  errors: number;
  mlsgrid_request_count: number;
  mlsgrid_bytes: number;
  wix_requests: number;
  error_stage: string | null;
  error_message: string | null;
}

interface EngineEvent {
  id: string;
  run_key: string | null;
  site_id: string | null;
  listing_id: string | null;
  at: string;
  level: string;
  kind: string;
  message: string;
  address: string | null;
  village: string | null;
  details: unknown;
  dismissed_at: string | null;
}

interface SiteOption {
  id: string;
  name: string;
  domain: string;
  target_collection_id: string;
  live_collection_id: string;
}

const KINDS = [
  "insert",
  "update",
  "delete",
  "unstage",
  "write_failed",
  "mass_delete_guard",
  "gap",
  "budget",
  "seed",
  "seed_failed",
  "stats_failed",
  "run_error",
  "events_dropped",
];

const RUNS_PAGE = 20;
/** A run stores at most 1,500 entries (the engine's buffer cap), so one page holds a whole run. */
const RUN_EVENTS_LIMIT = 2000;
/** Filtered mode pages entries, newest first. */
const ENTRIES_PAGE = 300;

interface Filters {
  siteId: string;
  level: string;
  kind: string;
}

const NO_FILTERS: Filters = { siteId: "", level: "", kind: "" };

export default function ListingsChangeLogPage() {
  // useSearchParams needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={<div className="empty-state">Loading…</div>}>
      <ChangeLogView />
    </Suspense>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const err = await responseError(r);
  if (err) throw new Error(err);
  return r.json();
}

/** Entries grouped under their run key, keeping the newest-first order they arrived in. */
function groupByRun(events: EngineEvent[]): Array<[string, EngineEvent[]]> {
  const groups = new Map<string, EngineEvent[]>();
  for (const e of events) {
    const key = e.run_key ?? "";
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.entries()];
}

/** A run key is "<mode>:<started_at ISO>". */
function describeRunKey(runKey: string): { mode: string; startedAt: string | null } {
  const i = runKey.indexOf(":");
  return i === -1 ? { mode: runKey, startedAt: null } : { mode: runKey.slice(0, i), startedAt: runKey.slice(i + 1) };
}

/** The runs behind a set of entries, by key; a run the retention purge already dropped is simply absent. */
async function runsByKey(keys: string[]): Promise<Record<string, Run>> {
  const out: Record<string, Run> = {};
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100);
    const runs = await getJson<Run[]>(`/api/internal/listings/runs?limit=100&runKeys=${encodeURIComponent(part.join(","))}`);
    for (const r of Array.isArray(runs) ? runs : []) out[r.run_key] = r;
  }
  return out;
}

const runKeysOf = (events: EngineEvent[], except?: Record<string, Run>) =>
  [...new Set(events.map((e) => e.run_key).filter((k): k is string => !!k && !(except && k in except)))];

/** Filtered mode: the matching entries, the runs they belong to, and whether older ones remain. */
interface Entries {
  key: string;
  events: EngineEvent[];
  runs: Record<string, Run>;
  exhausted: boolean;
}

function ChangeLogView() {
  const searchParams = useSearchParams();
  // From the overview: a run to open, an entry to highlight, or a listing to look up.
  const focusRunKey = searchParams.get("runKey") ?? "";
  const highlightId = searchParams.get("eventId") ?? "";
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [listingInput, setListingInput] = useState(searchParams.get("listingId") ?? "");
  const [listingId, setListingId] = useState(searchParams.get("listingId") ?? "");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusRunKey ? [focusRunKey] : []));
  // An open run's entries, keyed by run key and the filter combination they were fetched with.
  const [eventCache, setEventCache] = useState<Record<string, EngineEvent[]>>({});
  const requested = useRef(new Set<string>());
  const [entries, setEntries] = useState<Entries | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ sites?: SiteOption[] }>("/api/internal/listings/status")
      .then((data) => {
        if (Array.isArray(data?.sites)) {
          setSites(
            data.sites.map((s) => ({ id: s.id, name: s.name, domain: s.domain, target_collection_id: s.target_collection_id, live_collection_id: s.live_collection_id }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // The listing lookup applies after a short pause; the selects apply at once.
  useEffect(() => {
    const timer = setTimeout(() => setListingId(listingInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [listingInput]);

  const filterKey = `${filters.siteId}|${filters.level}|${filters.kind}`;
  const eventsUrl = useCallback(
    (extra: Record<string, string>) => {
      const q = new URLSearchParams();
      if (filters.siteId) q.set("siteId", filters.siteId);
      if (filters.level) q.set("level", filters.level);
      if (filters.kind) q.set("kind", filters.kind);
      for (const [k, v] of Object.entries(extra)) q.set(k, v);
      return `/api/internal/listings/events?${q.toString()}`;
    },
    [filters.siteId, filters.level, filters.kind]
  );

  // With a filter set (and no single run in focus) the page shows only what matches, under the runs it belongs to.
  const filtered = !focusRunKey && !!(filters.siteId || filters.level || filters.kind || listingId);
  const entriesKey = `${filterKey}|${listingId}`;

  const loadRuns = useCallback(
    (before?: string) => {
      const q = new URLSearchParams();
      if (focusRunKey) q.set("runKey", focusRunKey);
      else {
        q.set("limit", String(RUNS_PAGE));
        if (before) q.set("before", before);
      }
      return getJson<Run[]>(`/api/internal/listings/runs?${q.toString()}`)
        .then((data) => {
          const page = Array.isArray(data) ? data : [];
          setRuns((current) => (before && current ? [...current, ...page.filter((p) => !current.some((c) => c.id === p.id))] : page));
          setExhausted(!!focusRunKey || page.length < RUNS_PAGE);
          setError(null);
        })
        .catch((e) => {
          setError(e.message);
          setRuns((current) => current ?? []);
        });
    },
    [focusRunKey]
  );

  useEffect(() => {
    if (!filtered) loadRuns();
  }, [filtered, loadRuns]);

  function loadMoreRuns() {
    const oldest = runs?.[runs.length - 1];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    loadRuns(oldest.started_at).finally(() => setLoadingMore(false));
  }

  // Each open run's entries, fetched once per filter combination.
  useEffect(() => {
    if (filtered) return;
    for (const runKey of expanded) {
      const key = `${runKey}|${filterKey}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      getJson<EngineEvent[]>(eventsUrl({ runKey, limit: String(RUN_EVENTS_LIMIT) }))
        .then((data) => setEventCache((c) => ({ ...c, [key]: Array.isArray(data) ? data : [] })))
        .catch((e) => {
          requested.current.delete(key);
          setError(e.message);
        });
    }
  }, [filtered, expanded, filterKey, eventsUrl]);

  // Filtered mode: the newest matching entries and the runs behind them.
  useEffect(() => {
    if (!filtered) return;
    let cancelled = false;
    const extra: Record<string, string> = { limit: String(ENTRIES_PAGE) };
    if (listingId) extra.listingId = listingId;
    getJson<EngineEvent[]>(eventsUrl(extra))
      .then(async (data) => {
        const events = Array.isArray(data) ? data : [];
        const byKey = await runsByKey(runKeysOf(events));
        if (cancelled) return;
        setEntries({ key: entriesKey, events, runs: byKey, exhausted: events.length < ENTRIES_PAGE });
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [filtered, entriesKey, listingId, eventsUrl]);

  function loadMoreEntries() {
    if (!entries || entries.key !== entriesKey || entries.exhausted || loadingMore) return;
    const oldest = entries.events[entries.events.length - 1];
    if (!oldest) return;
    const key = entries.key;
    setLoadingMore(true);
    const extra: Record<string, string> = { limit: String(ENTRIES_PAGE), before: oldest.at };
    if (listingId) extra.listingId = listingId;
    getJson<EngineEvent[]>(eventsUrl(extra))
      .then(async (data) => {
        const page = Array.isArray(data) ? data : [];
        const more = await runsByKey(runKeysOf(page, entries.runs));
        setEntries((current) =>
          current && current.key === key
            ? {
                key,
                events: [...current.events, ...page.filter((p) => !current.events.some((c) => c.id === p.id))],
                runs: { ...current.runs, ...more },
                exhausted: page.length < ENTRIES_PAGE,
              }
            : current
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMore(false));
  }

  function toggle(runKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runKey)) next.delete(runKey);
      else next.add(runKey);
      return next;
    });
  }

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? "";
  const colors = siteColors(sites.find((s) => s.id === filters.siteId)?.domain);
  const showSite = !filters.siteId && sites.length > 1;
  const anyFilter = filters.siteId || filters.level || filters.kind || listingInput;
  const current = filtered && entries?.key === entriesKey ? entries : null;
  const entryProps: EntriesProps = { sites, siteName, showSite, highlightId, onListing: setListingInput };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Change Log</h2>
          <p className="text-muted">
            Every run, newest first, with what it did underneath: inserts, rewrites, removals and why, guard holds and problems.
            Open a run to see its entries; set a filter or look a listing up to see only what matches, under the runs it happened in.
          </p>
        </div>
      </div>
      <ListingsTabs />

      {error && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--danger)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div
        className="card"
        style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", ...(colors ? { background: colors.tint, borderLeft: `3px solid ${colors.accent}` } : {}) }}
      >
        <label>
          Location{" "}
          <select value={filters.siteId} onChange={(e) => setFilters((f) => ({ ...f, siteId: e.target.value }))} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="">All locations</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          Level{" "}
          <select value={filters.level} onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label>
          Kind{" "}
          <select value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="">All</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Listing{" "}
          <input
            className="form-input"
            style={{ width: 170, display: "inline-block" }}
            placeholder="MFRA4670555"
            value={listingInput}
            onChange={(e) => setListingInput(e.target.value)}
          />
        </label>
        {anyFilter && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setFilters(NO_FILTERS);
              setListingInput("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {focusRunKey && (
        <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="text-sm">Showing one run; the filters apply to its entries.</span>
          <Link href="/dashboard/listings/change-log" className="btn btn-secondary btn-sm">
            Show all runs
          </Link>
        </div>
      )}

      {filtered ? (
        current === null ? (
          <div className="empty-state">Loading…</div>
        ) : current.events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            No entries match.
          </div>
        ) : (
          <>
            {groupByRun(current.events).map(([runKey, events]) => {
              const run = current.runs[runKey];
              return run ? (
                <RunCard key={runKey} run={run} open events={events} {...entryProps} />
              ) : (
                <RunKeyGroup key={runKey || "(no run)"} runKey={runKey} events={events} {...entryProps} />
              );
            })}
            {!current.exhausted && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button className="btn btn-secondary" disabled={loadingMore} onClick={loadMoreEntries}>
                  {loadingMore ? "Loading…" : "Load older entries"}
                </button>
              </div>
            )}
          </>
        )
      ) : runs === null ? (
        <div className="empty-state">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          {focusRunKey ? "That run is no longer in the log." : "No runs yet."}
        </div>
      ) : (
        <>
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              open={expanded.has(run.run_key)}
              onToggle={() => toggle(run.run_key)}
              events={eventCache[`${run.run_key}|${filterKey}`]}
              {...entryProps}
            />
          ))}
          {!exhausted && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <button className="btn btn-secondary" disabled={loadingMore} onClick={loadMoreRuns}>
                {loadingMore ? "Loading…" : `Load ${RUNS_PAGE} older runs`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface EntriesProps {
  sites: SiteOption[];
  siteName: (id: string | null) => string;
  showSite: boolean;
  highlightId: string;
  onListing?: (listingId: string) => void;
}

const headerStyle = {
  width: "100%",
  background: "none",
  border: "none",
  color: "inherit",
  font: "inherit",
  textAlign: "left" as const,
  padding: "12px 16px",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 14,
  alignItems: "center",
};

function RunCard({ run, open, onToggle, events, ...entries }: { run: Run; open: boolean; onToggle?: () => void; events: EngineEvent[] | undefined } & EntriesProps) {
  const outcome = runOutcome(run);
  const trigger = triggerLabel(run.trigger);
  const header = (
    <>
      {onToggle && <span style={{ width: 12, color: "var(--text-muted)" }}>{open ? "▾" : "▸"}</span>}
      <span style={{ minWidth: 200 }}>
        <strong>{fmtDateTime(run.started_at)}</strong>
        <span className="text-muted text-sm" title={trigger.title}>
          {" "}
          · {trigger.label}
        </span>
      </span>
      <span className="badge badge-muted" style={{ textTransform: "none" }}>
        {modeLabel(run.mode)}
      </span>
      <span className={outcome.cls} title={outcome.title}>
        {outcome.label}
      </span>
      <span className="text-sm text-muted">{duration(run.duration_ms)}</span>
      <span className="text-sm" title="New / updated / removed">
        +{run.inserted} / ~{run.updated} / −{run.deleted}
        {run.unstaged ? ` / ${run.unstaged} unstaged` : ""}
      </span>
      {run.deletes_skipped > 0 && (
        <span className="text-sm" title="Removals the guard held back">
          held {run.deletes_skipped}
        </span>
      )}
      {run.writes_failed > 0 && (
        <span className="text-sm" style={{ color: "var(--danger)" }} title="Writes Wix rejected; retried on the next run">
          failed {run.writes_failed}
        </span>
      )}
      <span className="text-sm text-muted" title="MLSGrid and Wix requests">
        MLSGrid {run.mlsgrid_request_count} req · {megabytes(run.mlsgrid_bytes)} · Wix {run.wix_requests} req
      </span>
      <span style={{ flex: 1 }} />
      <RunTags warnings={run.warnings} errors={run.errors} />
    </>
  );
  return (
    <div className="card" style={{ marginBottom: 10, padding: 0 }}>
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={open} style={{ ...headerStyle, cursor: "pointer" }}>
          {header}
        </button>
      ) : (
        <div style={headerStyle}>{header}</div>
      )}
      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          {run.error_message && (
            <div className="text-sm" style={{ color: "var(--danger)", marginBottom: 8 }}>
              Stopped at {run.error_stage ?? run.stage ?? "?"}: {run.error_message}
            </div>
          )}
          {events === undefined ? (
            <p className="text-muted text-sm" style={{ margin: 0 }}>Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-muted text-sm" style={{ margin: 0 }}>No entries match for this run.</p>
          ) : (
            <>
              <EntriesTable events={events} {...entries} />
              {events.length >= RUN_EVENTS_LIMIT && (
                <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>Showing the first {RUN_EVENTS_LIMIT} entries.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Entries whose run row is gone (purged) or missing: a header from the key alone. */
function RunKeyGroup({ runKey, events, ...entries }: { runKey: string; events: EngineEvent[] } & EntriesProps) {
  const { mode, startedAt } = describeRunKey(runKey);
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-header" style={{ flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <div>
          <strong>{startedAt ? fmtDateTime(startedAt) : runKey || "No run"}</strong>
          {runKey && (
            <span className="badge badge-muted" style={{ textTransform: "none", marginLeft: 8 }}>
              {modeLabel(mode)}
            </span>
          )}
        </div>
        {runKey && <span className="text-muted text-sm">run no longer in the log</span>}
      </div>
      <EntriesTable events={events} {...entries} />
    </div>
  );
}

function EntriesTable({ events, sites, siteName, showSite, highlightId, onListing }: { events: EngineEvent[] } & EntriesProps) {
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Level</th>
            <th>Kind</th>
            <th>Listing</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} style={e.id === highlightId ? { background: "rgba(248, 113, 113, 0.08)" } : undefined}>
              <td className="text-sm" style={{ whiteSpace: "nowrap" }}>
                {fmtDateTime(e.at)}
                {showSite && e.site_id && <div className="text-muted">{siteName(e.site_id)}</div>}
              </td>
              <td>
                <span className={levelBadge(e.level)}>{e.level}</span>
                {e.dismissed_at && (
                  <div className="text-muted text-sm" title={`Dismissed ${fmtDateTime(e.dismissed_at)}`}>
                    dismissed
                  </div>
                )}
              </td>
              <td className="text-sm">{e.kind}</td>
              <td className="text-sm">
                {e.listing_id ? (
                  onListing ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: "1px 8px" }}
                      onClick={() => onListing(e.listing_id ?? "")}
                      title="Show everything that happened to this listing"
                    >
                      {e.listing_id}
                    </button>
                  ) : (
                    e.listing_id
                  )
                ) : (
                  "—"
                )}
                {e.address && <div className="text-muted">{e.address}</div>}
                {e.village && <div className="text-muted">{e.village}</div>}
              </td>
              <td className="text-sm">
                {humanizeMessage(e.message, sites)}
                {e.details != null && (
                  <details style={{ marginTop: 4 }}>
                    <summary className="text-muted">details</summary>
                    <pre className="font-mono text-sm" style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
