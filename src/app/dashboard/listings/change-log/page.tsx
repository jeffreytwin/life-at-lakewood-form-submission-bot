"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ListingsTabs from "../tabs";
import { fmtDateTime, levelBadge, responseError, siteColors } from "../format";

interface EngineEvent {
  id: string;
  run_key: string;
  site_id: string | null;
  listing_id: string | null;
  at: string;
  level: string;
  kind: string;
  message: string;
  address: string | null;
  village: string | null;
  details: unknown;
}

interface SiteOption {
  id: string;
  name: string;
  domain: string;
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

interface Filters {
  siteId: string;
  level: string;
  kind: string;
  listingId: string;
  runKey: string;
}

const NO_FILTERS: Filters = { siteId: "", level: "", kind: "", listingId: "", runKey: "" };

export default function ListingsChangeLogPage() {
  // useSearchParams needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={<div className="empty-state">Loading…</div>}>
      <EventsView />
    </Suspense>
  );
}

function EventsView() {
  const searchParams = useSearchParams();
  // A listing id or run key in the URL (from the overview's links) is the lookup.
  const initial = (): Filters => ({
    ...NO_FILTERS,
    listingId: searchParams.get("listingId") ?? "",
    runKey: searchParams.get("runKey") ?? "",
  });
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [filters, setFilters] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/listings/status")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.sites)) setSites(data.sites.map((s: SiteOption) => ({ id: s.id, name: s.name, domain: s.domain })));
      })
      .catch(() => {});
  }, []);

  // Text filters apply after a short pause; selects apply at once.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(filters), 350);
    return () => clearTimeout(timer);
  }, [filters]);

  const fetchEvents = useCallback(() => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(applied)) if (value) q.set(key, value);
    q.set("limit", "300");
    fetch(`/api/internal/listings/events?${q.toString()}`)
      .then(async (r) => {
        const err = await responseError(r);
        if (err) throw new Error(err);
        return r.json();
      })
      .then((data) => {
        setEvents(Array.isArray(data) ? data : []);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [applied]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? "";
  const colors = siteColors(sites.find((s) => s.id === filters.siteId)?.domain);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Change Log</h2>
          <p className="text-muted">
            One row per notable thing a run did: inserts, rewrites, removals and why, guard holds, and run problems. Filter by a
            listing id to see everything that happened to one listing.
          </p>
        </div>
      </div>
      <ListingsTabs />

      <div
        className="card"
        style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", ...(colors ? { background: colors.tint, borderLeft: `3px solid ${colors.accent}` } : {}) }}
      >
        <label>
          Site{" "}
          <select value={filters.siteId} onChange={(e) => setFilters((f) => ({ ...f, siteId: e.target.value }))} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="">All sites</option>
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
            value={filters.listingId}
            onChange={(e) => setFilters((f) => ({ ...f, listingId: e.target.value }))}
          />
        </label>
        <label>
          Run{" "}
          <input
            className="form-input"
            style={{ width: 260, display: "inline-block" }}
            placeholder="full:2026-09-15T01:02:35.641Z"
            value={filters.runKey}
            onChange={(e) => setFilters((f) => ({ ...f, runKey: e.target.value }))}
          />
        </label>
        {(filters.siteId || filters.level || filters.kind || filters.listingId || filters.runKey) && (
          <button className="btn btn-secondary btn-sm" onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </button>
        )}
      </div>

      {error ? (
        <div className="empty-state">{error}</div>
      ) : loading && events.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          No events match.
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Level</th>
                  <th>Kind</th>
                  <th>Listing</th>
                  <th>Message</th>
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="text-sm" style={{ whiteSpace: "nowrap" }}>
                      {fmtDateTime(e.at)}
                      {e.site_id && <div className="text-muted">{siteName(e.site_id)}</div>}
                    </td>
                    <td>
                      <span className={levelBadge(e.level)}>{e.level}</span>
                    </td>
                    <td className="text-sm">{e.kind}</td>
                    <td className="text-sm">
                      {e.listing_id ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: "1px 8px" }}
                          onClick={() => setFilters({ ...NO_FILTERS, listingId: e.listing_id ?? "" })}
                          title="Show every event for this listing"
                        >
                          {e.listing_id}
                        </button>
                      ) : (
                        "—"
                      )}
                      {e.address && <div className="text-muted">{e.address}</div>}
                      {e.village && <div className="text-muted">{e.village}</div>}
                    </td>
                    <td className="text-sm">
                      {e.message}
                      {e.details != null && (
                        <details style={{ marginTop: 4 }}>
                          <summary className="text-muted">details</summary>
                          <pre className="font-mono text-sm" style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>
                            {JSON.stringify(e.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                    <td className="text-sm">
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: "1px 8px" }}
                        onClick={() => setFilters({ ...NO_FILTERS, runKey: e.run_key })}
                        title="Show every event of this run"
                      >
                        {e.run_key.split(":")[0]}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {events.length >= 300 && <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>Showing the newest 300; narrow the filters for older events.</p>}
        </div>
      )}
    </div>
  );
}
