"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ListingsTabs from "./tabs";
import { ago, duration, fmtDateTime, levelBadge, megabytes, responseError, writeModeBadge } from "./format";

interface SiteCounts {
  staged: number;
  live: number;
  removed: number;
  galleryPending: number;
  needsWrite: number;
  pendingRemovals: number;
}

interface Site {
  id: string;
  name: string;
  domain: string;
  wix_site_id: string | null;
  target_collection_id: string;
  live_collection_id: string;
  write_mode: "shadow" | "live" | "paused";
  market_cities: string[];
  active: boolean;
  counts: SiteCounts;
  villages: number;
  activeVillages: number;
}

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
  error_message: string | null;
}

interface EngineEvent {
  id: string;
  at: string;
  level: string;
  kind: string;
  listing_id: string | null;
  address: string | null;
  message: string;
}

interface EngineState {
  lastRunAt?: string;
  lastRunKey?: string;
  lastMode?: string;
  lastStatus?: string;
  lastFullDate?: string;
}

interface Status {
  engine: { ls_engine_enabled: boolean; ls_engine_state: EngineState | null } | null;
  listingsInFeed: number;
  sites: Site[];
  runs: Run[];
  events: EngineEvent[];
}

interface RunSummary {
  mode: string;
  status: string;
  stage: string;
  truncated: boolean;
  fetched: number;
  relevant: number;
  missing: number;
  mlsgrid: { requests: number; bytes: number; rateLimited: number };
  sites: Array<{ domain: string; target: string; inserted: number; updated: number; unchanged: number; deleted: number; unstaged: number; held: number; failed: number; waitingForPhotos: number; skipped?: string }>;
  counts: { inserted: number; updated: number; deleted: number; unstaged: number; deletesSkipped: number; writesFailed: number; warnings: number; errors: number; wixRequests: number };
  error: string | null;
}

function summarize(r: RunSummary): string {
  const parts = [
    `${r.mode} run ${r.status}${r.stage ? ` at ${r.stage}` : ""}${r.truncated ? " (truncated)" : ""}`,
    `fetched ${r.fetched}, relevant ${r.relevant}, missing ${r.missing}`,
    `inserted ${r.counts.inserted}, updated ${r.counts.updated}, deleted ${r.counts.deleted}, unstaged ${r.counts.unstaged}, held ${r.counts.deletesSkipped}, failed ${r.counts.writesFailed}`,
    `MLSGrid ${r.mlsgrid.requests} req (${megabytes(r.mlsgrid.bytes)}), Wix ${r.counts.wixRequests} req`,
  ];
  for (const s of r.sites) {
    if (s.skipped) parts.push(`${s.domain}: skipped (${s.skipped})`);
    else if (s.waitingForPhotos) parts.push(`${s.domain}: ${s.waitingForPhotos} waiting for photos`);
  }
  if (r.error) parts.push(`error: ${r.error}`);
  return parts.join(" · ");
}

export default function ListingsOverviewPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const fetchStatus = useCallback(() => {
    fetch("/api/internal/listings/status")
      .then(async (r) => {
        const err = await responseError(r);
        if (err) throw new Error(err);
        return r.json();
      })
      .then((data: Status) => {
        setStatus(data);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function call(key: string, url: string, init: RequestInit, onOk?: (body: unknown) => void) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
      const err = await responseError(res);
      const body = err ? null : await res.json().catch(() => null);
      if (err) setError(err);
      else onOk?.(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      fetchStatus();
    }
  }

  function toggleEngine(enabled: boolean) {
    if (
      enabled &&
      !confirm("Switch the engine on? The cron then runs an incremental pull every hour and a full verify once a day, writing each site's target collection.")
    ) {
      return;
    }
    call("engine", "/api/internal/listings/engine", { method: "POST", body: JSON.stringify({ enabled }) });
  }

  function runNow(mode: "incremental" | "full", allowMassDelete = false) {
    const what = allowMassDelete ? "Apply the removals the guard held back? They are deleted from the target collection" : mode === "full" ? "Run a full verify of every held listing now?" : "Run an incremental pull now?";
    if (!confirm(what)) return;
    call(allowMassDelete ? "held" : `run:${mode}`, "/api/internal/listings/run", { method: "POST", body: JSON.stringify({ mode, allowMassDelete }) }, (body) =>
      setLastResult(summarize(body as RunSummary))
    );
  }

  function pauseResume(site: Site) {
    const next = site.write_mode === "paused" ? "shadow" : "paused";
    const what = next === "paused"
      ? `Pause ${site.domain}? Runs keep pulling and classifying for it, but nothing is written to ${site.target_collection_id} until it is resumed.`
      : `Resume ${site.domain}? The next run writes everything due to ${site.target_collection_id}.`;
    if (!confirm(what)) return;
    call(`site:${site.id}`, `/api/internal/listings/sites/${site.id}`, { method: "PATCH", body: JSON.stringify({ write_mode: next }) });
  }

  const engine = status?.engine;
  const state = engine?.ls_engine_state ?? {};
  const totals = (status?.sites ?? []).reduce(
    (acc, s) => ({
      live: acc.live + s.counts.live,
      staged: acc.staged + s.counts.staged,
      pendingRemovals: acc.pendingRemovals + s.counts.pendingRemovals,
      galleryPending: acc.galleryPending + s.counts.galleryPending,
    }),
    { live: 0, staged: 0, pendingRemovals: 0, galleryPending: 0 }
  );
  const lastRun = status?.runs[0];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Listings Engine</h2>
          <p className="text-muted">
            MLSGrid listings, classified per site and written to each site&apos;s target collection. In shadow mode a site&apos;s
            live collection is untouched; the Velo pipeline keeps serving it until cutover.
          </p>
        </div>
      </div>
      <ListingsTabs />

      {error && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--danger)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading || !status ? (
        <div className="empty-state">{error ? "" : "Loading…"}</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={!!engine?.ls_engine_enabled}
                  disabled={busy !== null}
                  onChange={(e) => toggleEngine(e.target.checked)}
                />
                <strong>Engine {engine?.ls_engine_enabled ? "on" : "off"}</strong>
              </label>
              <span className="text-muted text-sm">
                {engine?.ls_engine_enabled
                  ? "Incremental every hour, full verify daily after 03:00 UTC."
                  : "The cron tick is idle; runs happen only from the buttons here."}
              </span>
              <span className="text-muted text-sm">
                Last run {ago(state.lastRunAt)}
                {state.lastMode ? ` (${state.lastMode}, ${state.lastStatus ?? "?"})` : ""}
                {state.lastFullDate ? ` · last full ${state.lastFullDate}` : ""}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => runNow("incremental")}>
                {busy === "run:incremental" ? "Running…" : "Run incremental now"}
              </button>
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => runNow("full")}>
                {busy === "run:full" ? "Running…" : "Run full verify now"}
              </button>
            </div>
            {lastResult && (
              <p className="text-sm" style={{ marginTop: 12, marginBottom: 0 }}>
                <strong>Result:</strong> {lastResult}
              </p>
            )}
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Listings in feed</div>
              <div className="stat-value">{status.listingsInFeed}</div>
              <div className="stat-sub">held by the engine, across all sites</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Live rows</div>
              <div className="stat-value">{totals.live}</div>
              <div className="stat-sub">{totals.staged} staged · {totals.galleryPending} galleries incomplete</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pending removals</div>
              <div className="stat-value">{totals.pendingRemovals}</div>
              <div className="stat-sub">deleted on the next run, or held by the guard</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Last run</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {lastRun ? (
                  <span className={`badge ${lastRun.status === "ok" ? "badge-success" : lastRun.status === "running" ? "badge-info" : "badge-danger"}`}>
                    {lastRun.status}
                  </span>
                ) : (
                  "—"
                )}
              </div>
              <div className="stat-sub">
                {lastRun ? `${lastRun.mode} · ${ago(lastRun.started_at)} · ${lastRun.warnings} warn, ${lastRun.errors} err` : "no runs yet"}
              </div>
            </div>
          </div>

          {status.sites.map((site) => {
            const mode = writeModeBadge(site.write_mode);
            return (
              <div className="card" key={site.id} style={{ marginBottom: 16 }}>
                <div className="card-header" style={{ flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <strong>{site.domain}</strong> <span className={mode.cls}>{mode.label}</span>
                    {!site.wix_site_id && <span className="badge badge-danger" style={{ marginLeft: 6 }}>no Wix site id</span>}
                    <div className="text-muted text-sm">
                      writes {site.target_collection_id}
                      {site.write_mode !== "live" ? ` (live collection ${site.live_collection_id} untouched)` : ""} · market{" "}
                      {site.market_cities.join(", ") || "—"} · {site.activeVillages} of {site.villages} villages active
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {site.counts.pendingRemovals > 0 && (
                      <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => runNow("incremental", true)}>
                        {busy === "held" ? "Applying…" : `Apply ${site.counts.pendingRemovals} held removal(s)`}
                      </button>
                    )}
                    {site.write_mode !== "live" && (
                      <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => pauseResume(site)}>
                        {busy === `site:${site.id}` ? "…" : site.write_mode === "paused" ? "Resume writes" : "Pause writes"}
                      </button>
                    )}
                    <Link href="/dashboard/listings/villages" className="btn btn-secondary btn-sm">
                      Villages
                    </Link>
                  </div>
                </div>
                <div className="stats-grid" style={{ marginBottom: 0 }}>
                  {(
                    [
                      ["Live", site.counts.live, "in the target collection"],
                      ["Staged", site.counts.staged, "eligible, waiting for photos or a write"],
                      ["Removed", site.counts.removed, `${site.counts.pendingRemovals} still to delete`],
                      ["Needs write", site.counts.needsWrite, `${site.counts.galleryPending} galleries incomplete`],
                    ] as const
                  ).map(([label, value, sub]) => (
                    <div className="stat-card" key={label} style={{ padding: 14 }}>
                      <div className="stat-label">{label}</div>
                      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
                      <div className="stat-sub">{sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>Recent runs</h3>
              <Link href="/dashboard/listings/events" className="text-sm">
                All events →
              </Link>
            </div>
            {status.runs.length === 0 ? (
              <p className="text-muted">No runs yet.</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Mode</th>
                      <th>Result</th>
                      <th>Took</th>
                      <th>Writes</th>
                      <th>Held</th>
                      <th>Failed</th>
                      <th>MLSGrid</th>
                      <th>Wix</th>
                      <th>Warn / err</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.runs.map((run) => (
                      <tr key={run.id}>
                        <td className="text-sm" title={run.run_key}>
                          {fmtDateTime(run.started_at)}
                          <div className="text-muted">{run.trigger}</div>
                        </td>
                        <td>{run.mode}</td>
                        <td>
                          <span className={`badge ${run.status === "ok" ? "badge-success" : run.status === "running" ? "badge-info" : "badge-danger"}`}>
                            {run.status}
                          </span>
                          <div className="text-muted text-sm">{run.stage ?? ""}</div>
                          {run.error_message && <div className="text-sm" style={{ color: "var(--danger)" }}>{run.error_message}</div>}
                        </td>
                        <td className="text-sm">{duration(run.duration_ms)}</td>
                        <td className="text-sm">
                          +{run.inserted} / ~{run.updated} / −{run.deleted}
                          {run.unstaged ? ` / ${run.unstaged} unstaged` : ""}
                        </td>
                        <td className="text-sm">{run.deletes_skipped || ""}</td>
                        <td className="text-sm" style={run.writes_failed ? { color: "var(--danger)" } : undefined}>{run.writes_failed || ""}</td>
                        <td className="text-sm">
                          {run.mlsgrid_request_count} req · {megabytes(run.mlsgrid_bytes)}
                        </td>
                        <td className="text-sm">{run.wix_requests} req</td>
                        <td className="text-sm">
                          {run.warnings} / {run.errors}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Warnings and errors</h3>
              <span className="text-muted text-sm">newest 50</span>
            </div>
            {status.events.length === 0 ? (
              <p className="text-muted">Nothing to report.</p>
            ) : (
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
                    {status.events.map((e) => (
                      <tr key={e.id}>
                        <td className="text-sm">{fmtDateTime(e.at)}</td>
                        <td>
                          <span className={levelBadge(e.level)}>{e.level}</span>
                        </td>
                        <td className="text-sm">{e.kind}</td>
                        <td className="text-sm">
                          {e.listing_id ? (
                            <Link href={`/dashboard/listings/events?listingId=${encodeURIComponent(e.listing_id)}`}>{e.listing_id}</Link>
                          ) : (
                            "—"
                          )}
                          {e.address && <div className="text-muted">{e.address}</div>}
                        </td>
                        <td className="text-sm">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
