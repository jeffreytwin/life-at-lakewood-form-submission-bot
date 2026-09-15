"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ListingsTabs from "./tabs";
import Toggle from "./toggle";
import { ago, duration, fmtDateTime, levelBadge, megabytes, responseError, siteColors, wixCollectionUrl, writeModeBadge } from "./format";

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

function summarize(r: RunSummary, siteName: (domain: string) => string): string {
  const parts = [
    `${r.mode} run ${r.status}${r.stage ? ` at ${r.stage}` : ""}${r.truncated ? " (truncated)" : ""}`,
    `fetched ${r.fetched}, relevant ${r.relevant}, missing ${r.missing}`,
    `inserted ${r.counts.inserted}, updated ${r.counts.updated}, deleted ${r.counts.deleted}, unstaged ${r.counts.unstaged}, held ${r.counts.deletesSkipped}, failed ${r.counts.writesFailed}`,
    `MLSGrid ${r.mlsgrid.requests} req (${megabytes(r.mlsgrid.bytes)}), Wix ${r.counts.wixRequests} req`,
  ];
  for (const s of r.sites) {
    if (s.skipped) parts.push(`${siteName(s.domain)}: skipped (${s.skipped})`);
    else if (s.waitingForPhotos) parts.push(`${siteName(s.domain)}: ${s.waitingForPhotos} waiting for photos`);
  }
  if (r.error) parts.push(`error: ${r.error}`);
  return parts.join(" · ");
}

/** One of a site's count boxes; Live leads to the Wix collection, In Progress to the staging page. */
function SiteStat({ label, value, sub, href, external, title }: { label: string; value: number; sub: string; href?: string | null; external?: boolean; title?: string }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
      <div className="stat-sub">
        {sub}
        {href ? (external ? " ↗" : " →") : ""}
      </div>
    </>
  );
  if (href && external) {
    return (
      <a className="stat-card" href={href} target="_blank" rel="noreferrer" title={title} style={{ padding: 14 }}>
        {body}
      </a>
    );
  }
  if (href) {
    return (
      <Link className="stat-card" href={href} title={title} style={{ padding: 14 }}>
        {body}
      </Link>
    );
  }
  return (
    <div className="stat-card" style={{ padding: 14 }}>
      {body}
    </div>
  );
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

  const siteName = (domain: string) => status?.sites.find((s) => s.domain === domain)?.name ?? domain;

  function toggleEngine(enabled: boolean) {
    if (
      enabled &&
      !confirm("Turn listing updates on? The cron then runs an incremental pull every hour and a full verify once a day, writing each site's target collection.")
    ) {
      return;
    }
    call("engine", "/api/internal/listings/engine", { method: "POST", body: JSON.stringify({ enabled }) });
  }

  function runNow(mode: "incremental" | "full") {
    if (!confirm(mode === "full" ? "Run a full verify of every held listing now?" : "Run an incremental pull now?")) return;
    call(`run:${mode}`, "/api/internal/listings/run", { method: "POST", body: JSON.stringify({ mode }) }, (body) =>
      setLastResult(summarize(body as RunSummary, siteName))
    );
  }

  function applyHeldRemovals() {
    if (!confirm("Apply the removals the guard held back? They are deleted from the target collection.")) return;
    call("held", "/api/internal/listings/run", { method: "POST", body: JSON.stringify({ mode: "incremental", allowMassDelete: true }) }, (body) =>
      setLastResult(summarize(body as RunSummary, siteName))
    );
  }

  function toggleSiteUpdates(site: Site, on: boolean) {
    const what = on
      ? `Resume listing updates for ${site.name}? The next run writes everything due to ${site.target_collection_id}.`
      : `Pause listing updates for ${site.name}? Runs keep pulling and classifying for it, but nothing is written to ${site.target_collection_id} until updates are resumed.`;
    if (!confirm(what)) return;
    call(`site:${site.id}`, `/api/internal/listings/sites/${site.id}`, { method: "PATCH", body: JSON.stringify({ write_mode: on ? "shadow" : "paused" }) });
  }

  const engine = status?.engine;
  const updatesOn = !!engine?.ls_engine_enabled;
  const state = engine?.ls_engine_state ?? {};
  const totals = (status?.sites ?? []).reduce(
    (acc, s) => ({ staged: acc.staged + s.counts.staged, galleryPending: acc.galleryPending + s.counts.galleryPending }),
    { staged: 0, galleryPending: 0 }
  );
  const lastRun = status?.runs[0];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Listings</h2>
          <p className="text-muted">This area manages the MLS listings of our various sites.</p>
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
              <Toggle
                on={updatesOn}
                label="Listing Updates"
                action={updatesOn ? "Pause Listing Updates" : "Resume Listing Updates"}
                disabled={busy !== null}
                onChange={toggleEngine}
              />
              <span className="text-muted text-sm">
                {updatesOn
                  ? "Incremental every hour, full verify daily after 03:00 UTC."
                  : "Listing updates are off: the hourly pull and the daily verify are skipped; runs happen only from the buttons here."}
              </span>
              <span className="text-muted text-sm">
                Last run {ago(state.lastRunAt)}
                {state.lastMode ? ` (${state.lastMode}, ${state.lastStatus ?? "?"})` : ""}
                {state.lastFullDate ? ` · last full ${state.lastFullDate}` : ""}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => runNow("incremental")}>
                {busy === "run:incremental" ? "Running…" : "Run Incremental"}
              </button>
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => runNow("full")}>
                {busy === "run:full" ? "Running…" : "Run Full"}
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
              <div className="stat-sub">live active listings across all sites</div>
            </div>
            <Link className="stat-card" href="/dashboard/listings/staging" title="See what is in the staging area">
              <div className="stat-label">In Staging</div>
              <div className="stat-value">{totals.staged}</div>
              <div className="stat-sub">waiting in the staging area, across all sites →</div>
            </Link>
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
            const colors = siteColors(site.domain);
            const siteUpdatesOn = site.write_mode !== "paused";
            const live = site.write_mode === "live";
            const liveUrl = wixCollectionUrl(site.wix_site_id, site.target_collection_id);
            return (
              <div
                className="card"
                key={site.id}
                style={{ marginBottom: 16, ...(colors ? { background: colors.tint, borderLeft: `3px solid ${colors.accent}` } : {}) }}
              >
                <div className="card-header" style={{ flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <strong style={colors ? { color: colors.solid } : undefined}>{site.name}</strong> <span className={mode.cls}>{mode.label}</span>
                    {!site.wix_site_id && <span className="badge badge-danger" style={{ marginLeft: 6 }}>no Wix site id</span>}
                    <div className="text-muted text-sm">
                      market {site.market_cities.join(", ") || "—"} · {site.activeVillages} of {site.villages} neighborhoods active
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {site.counts.pendingRemovals > 0 && (
                      <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={applyHeldRemovals}>
                        {busy === "held" ? "Applying…" : `Apply ${site.counts.pendingRemovals} held removal(s)`}
                      </button>
                    )}
                    <Toggle
                      size="sm"
                      on={siteUpdatesOn}
                      label="Listing Updates"
                      action={
                        live
                          ? "A live site is cut over or rolled back by editing ls_sites, not from here"
                          : siteUpdatesOn
                            ? "Pause Listing Updates"
                            : "Resume Listing Updates"
                      }
                      disabled={busy !== null || live}
                      onChange={(on) => toggleSiteUpdates(site, on)}
                    />
                    <Link href={`/dashboard/listings/neighborhoods?siteId=${encodeURIComponent(site.id)}`} className="btn btn-secondary btn-sm">
                      Neighborhoods
                    </Link>
                  </div>
                </div>
                <div className="stats-grid" style={{ marginBottom: 0 }}>
                  <SiteStat
                    label="Live"
                    value={site.counts.live}
                    sub={liveUrl ? "see this live data in Wix" : "no Wix site id to link to"}
                    href={liveUrl}
                    external
                    title={liveUrl ? `Open ${site.target_collection_id} in the Wix CMS` : undefined}
                  />
                  <SiteStat
                    label="In Progress"
                    value={site.counts.staged}
                    sub="in the staging area"
                    href={`/dashboard/listings/staging?siteId=${encodeURIComponent(site.id)}`}
                    title="See what each in-progress listing is waiting on"
                  />
                </div>
              </div>
            );
          })}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>Recent runs</h3>
              <Link href="/dashboard/listings/change-log" className="text-sm">
                Change log →
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
                      <th>New/Updated/Removed</th>
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
                            <Link href={`/dashboard/listings/change-log?listingId=${encodeURIComponent(e.listing_id)}`}>{e.listing_id}</Link>
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
