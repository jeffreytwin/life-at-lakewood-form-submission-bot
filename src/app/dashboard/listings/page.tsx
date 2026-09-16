"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ListingsTabs from "./tabs";
import Toggle from "./toggle";
import RunTags from "./run-tags";
import { ago, duration, fmtDateTime, humanizeMessage, megabytes, modeLabel, responseError, runOutcome, siteColors, triggerLabel, wixCollectionUrl, writeModeBadge } from "./format";

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
  property_types?: string[];
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
  images_downloaded: number;
  images_imported: number;
  images_failed: number;
  error_message: string | null;
}

interface EngineEvent {
  id: string;
  run_key: string | null;
  site_id: string | null;
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
  /** Error events nobody has dismissed, newest first (the newest 50). */
  errors: EngineEvent[];
  /** How many open errors there are in total. */
  openErrors: number;
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
  photos?: { listings: number; downloaded: number; imported: number; failed: number; truncated: boolean } | null;
  discover?: { scannedTotal: number; expectedCount: number | null; foundTotal: number; found: number; pulled: number; complete: boolean } | null;
  error: string | null;
}

interface AuditReport {
  generatedAt: string;
  clean: boolean;
  site: { media_folder_name: string | null };
  folder: {
    configured: boolean;
    resolved: boolean;
    filesInFolder: number;
    listingTruncated: boolean;
    engineFiles: number;
    engineFilesInFolder: number;
    outsideFolder: string[];
    outsideFolderCount: number;
    unknownInFolder: number;
  };
  collections: Array<{
    collectionId: string;
    role: string;
    deletable: boolean;
    items: number;
    owned: number;
    stale: Array<{ id: string; address: string | null; status: string | null }>;
    staleCount: number;
    missing: number;
    galleryItems: number;
    galleryOutsideFolder: number | null;
    galleryNotWixImage: number;
  }>;
}

interface StaleDeleteResult {
  collectionId: string;
  requested: number;
  deleted: number;
  failed: number;
  errors: string[];
}

function summarize(r: RunSummary, siteName: (domain: string) => string): string {
  const parts = [
    `${modeLabel(r.mode)} run ${r.status}${r.stage ? ` at ${r.stage}` : ""}${r.truncated ? " (truncated)" : ""}`,
    `fetched ${r.fetched}, relevant ${r.relevant}, missing ${r.missing}`,
    `inserted ${r.counts.inserted}, updated ${r.counts.updated}, deleted ${r.counts.deleted}, unstaged ${r.counts.unstaged}, held ${r.counts.deletesSkipped}, failed ${r.counts.writesFailed}`,
    `MLSGrid ${r.mlsgrid.requests} req (${megabytes(r.mlsgrid.bytes)}), Wix ${r.counts.wixRequests} req`,
  ];
  for (const s of r.sites) {
    if (s.skipped) parts.push(`${siteName(s.domain)}: skipped (${s.skipped})`);
    else if (s.waitingForPhotos) parts.push(`${siteName(s.domain)}: ${s.waitingForPhotos} waiting for photos`);
  }
  if (r.photos) parts.push(`photos: ${r.photos.downloaded} downloaded, ${r.photos.imported} imported, ${r.photos.failed} failed${r.photos.truncated ? " (more next run)" : ""}`);
  if (r.discover) {
    const d = r.discover;
    parts.push(`discovery: scanned ${d.scannedTotal}${d.expectedCount ? ` of ${d.expectedCount}` : ""} Active listings, ${d.foundTotal} new in a location's market (${d.pulled} pulled with photos this run)${d.complete ? " · scan complete" : " · continues on the next tick"}`);
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

const runHref = (runKey: string) => `/dashboard/listings/change-log?runKey=${encodeURIComponent(runKey)}`;

/** Where an error's details are: its run in the Change Log, with the entry highlighted. */
function errorHref(e: EngineEvent): string {
  if (e.run_key) return `${runHref(e.run_key)}&eventId=${encodeURIComponent(e.id)}`;
  if (e.listing_id) return `/dashboard/listings/change-log?listingId=${encodeURIComponent(e.listing_id)}`;
  return "/dashboard/listings/change-log";
}

export default function ListingsOverviewPage() {
  const router = useRouter();
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

  const [audits, setAudits] = useState<Record<string, AuditReport>>({});
  const [staleResults, setStaleResults] = useState<Record<string, string>>({});

  function runAudit(site: Site) {
    call(`audit:${site.id}`, `/api/internal/listings/sites/${encodeURIComponent(site.id)}/audit`, { method: "GET" }, (body) =>
      setAudits((prev) => ({ ...prev, [site.id]: body as AuditReport }))
    );
  }

  function deleteStale(site: Site, collectionId: string, count: number) {
    if (!confirm(`Delete ${count} row(s) from ${collectionId} that the engine does not own? Their photos stay in the Media Manager for the folder purge.`)) return;
    call(
      `stale:${site.id}`,
      `/api/internal/listings/sites/${encodeURIComponent(site.id)}/audit`,
      { method: "POST", body: JSON.stringify({ deleteStale: true, collectionId }) },
      (body) => {
        const r = body as StaleDeleteResult;
        setStaleResults((prev) => ({ ...prev, [site.id]: `${r.deleted} of ${r.requested} row(s) deleted from ${r.collectionId}${r.failed ? `, ${r.failed} failed: ${r.errors.join("; ")}` : ""}` }));
        runAudit(site);
      }
    );
  }

  const siteName = (domain: string) => status?.sites.find((s) => s.domain === domain)?.name ?? domain;
  const siteById = (id: string | null) => status?.sites.find((s) => s.id === id)?.name ?? "";

  function toggleEngine(enabled: boolean) {
    if (
      enabled &&
      !confirm("Turn listing updates on? Listings then update every hour, with a full verify once a day, writing each location's listings to Wix.")
    ) {
      return;
    }
    call("engine", "/api/internal/listings/engine", { method: "POST", body: JSON.stringify({ enabled }) });
  }

  function runNow(mode: "incremental" | "full" | "discover") {
    const question =
      mode === "full"
        ? "Run a full verify of every held listing now?"
        : mode === "discover"
          ? "Scan every Active listing on the MLS for homes in a location's market that the engine does not hold yet? A scan the 4-minute budget cuts short continues on the next idle tick."
          : "Run the hourly update now?";
    if (!confirm(question)) return;
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
      ? `Resume listing updates for ${site.name}? The next run writes everything due for it.`
      : `Pause listing updates for ${site.name}? Runs keep pulling and classifying for it, but nothing is written to Wix for it until updates are resumed.`;
    if (!confirm(what)) return;
    call(`site:${site.id}`, `/api/internal/listings/sites/${site.id}`, { method: "PATCH", body: JSON.stringify({ write_mode: on ? "shadow" : "paused" }) });
  }

  function dismissErrors(body: { ids?: string[]; all?: boolean }) {
    if (body.all && !confirm(`Dismiss all ${status?.openErrors ?? ""} open error(s)? They stay in the Change Log, marked dismissed.`)) return;
    call(body.all ? "dismiss:all" : `dismiss:${body.ids?.[0] ?? ""}`, "/api/internal/listings/errors", { method: "POST", body: JSON.stringify(body) });
  }

  const engine = status?.engine;
  const updatesOn = !!engine?.ls_engine_enabled;
  const state = engine?.ls_engine_state ?? {};
  const totals = (status?.sites ?? []).reduce(
    (acc, s) => ({ live: acc.live + s.counts.live, staged: acc.staged + s.counts.staged, galleryPending: acc.galleryPending + s.counts.galleryPending }),
    { live: 0, staged: 0, galleryPending: 0 }
  );
  // The feed holds every listing pulled for our markets; the sites carry only the eligible ones.
  const notEligible = Math.max(0, (status?.listingsInFeed ?? 0) - totals.live - totals.staged);
  const lastRun = status?.runs[0];
  const lastOutcome = lastRun ? runOutcome(lastRun) : null;

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
          {status.errors.length > 0 && (
            <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--danger)" }}>
              <div className="card-header" style={{ flexWrap: "wrap", gap: 12 }}>
                <h3>
                  Errors{" "}
                  <span className="badge badge-danger" style={{ marginLeft: 4 }}>
                    {status.openErrors}
                  </span>
                </h3>
                <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => dismissErrors({ all: true })}>
                  {busy === "dismiss:all" ? "Dismissing…" : "Dismiss all"}
                </button>
              </div>
              <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
                Each error stays here until it is dismissed. Details opens its run in the Change Log, where the full history stays.
              </p>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Kind</th>
                      <th>Listing</th>
                      <th>Message</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.errors.map((e) => (
                      <tr key={e.id}>
                        <td className="text-sm" style={{ whiteSpace: "nowrap" }}>
                          {fmtDateTime(e.at)}
                          {e.site_id && <div className="text-muted">{siteById(e.site_id)}</div>}
                        </td>
                        <td className="text-sm">{e.kind}</td>
                        <td className="text-sm">
                          {e.listing_id ? (
                            <Link href={`/dashboard/listings/change-log?listingId=${encodeURIComponent(e.listing_id)}`} title="Everything that happened to this listing">
                              {e.listing_id}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {e.address && <div className="text-muted">{e.address}</div>}
                        </td>
                        <td className="text-sm">{humanizeMessage(e.message, status.sites)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <Link href={errorHref(e)} className="btn btn-secondary btn-sm" style={{ marginRight: 6 }}>
                            Details
                          </Link>
                          <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => dismissErrors({ ids: [e.id] })}>
                            {busy === `dismiss:${e.id}` ? "…" : "Dismiss"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {status.openErrors > status.errors.length && (
                <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>
                  Showing the newest {status.errors.length} of {status.openErrors} open errors.
                </p>
              )}
            </div>
          )}

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
                  ? "Updated every hour."
                  : "Listing updates are off: the hourly pull and the daily verify are skipped; runs happen only from the buttons here."}
              </span>
              <span className="text-muted text-sm">
                Last run {ago(state.lastRunAt)}
                {state.lastMode ? ` (${modeLabel(state.lastMode)}, ${state.lastStatus ?? "?"})` : ""}
                {state.lastFullDate ? ` · last full ${state.lastFullDate}` : ""}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => runNow("incremental")}>
                {busy === "run:incremental" ? "Running…" : "Run Hourly"}
              </button>
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => runNow("full")}>
                {busy === "run:full" ? "Running…" : "Run Full"}
              </button>
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => runNow("discover")} title="Find Active listings in a location's market that the engine does not hold yet (a new location's starting inventory)">
                {busy === "run:discover" ? "Running…" : "Run Discovery"}
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
              <div className="stat-value">{totals.live + totals.staged}</div>
              <div className="stat-sub">
                live and in progress across all locations
                {notEligible > 0 ? ` · ${notEligible} more in the MLS feed are not eligible (sold, pending, withdrawn or rentals)` : ""}
              </div>
            </div>
            <Link className="stat-card" href="/dashboard/listings/staging" title="See what is in the staging area">
              <div className="stat-label">In Staging</div>
              <div className="stat-value">{totals.staged}</div>
              <div className="stat-sub">waiting in the staging area, across all locations →</div>
            </Link>
            <div className="stat-card">
              <div className="stat-label">Last run</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {lastRun && lastOutcome ? (
                  <span className={lastOutcome.cls} title={lastOutcome.title}>
                    {lastOutcome.label}
                  </span>
                ) : (
                  "—"
                )}
              </div>
              <div className="stat-sub">
                {lastRun ? `${modeLabel(lastRun.mode)} · ${ago(lastRun.started_at)} · ${lastRun.warnings} warnings, ${lastRun.errors} errors` : "no runs yet"}
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
                      market {site.market_cities.join(", ") || "—"} · shows {(site.property_types ?? ["Residential", "Land"]).join(" + ")} · {site.activeVillages} of {site.villages} neighborhoods active
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
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy !== null || !site.wix_site_id}
                      onClick={() => runAudit(site)}
                      title="Check that every photo the engine wrote is in the site's Media Manager folder, and list collection rows the engine does not own"
                    >
                      {busy === `audit:${site.id}` ? "Auditing…" : "Audit photos & rows"}
                    </button>
                  </div>
                </div>
                <div className="stats-grid" style={{ marginBottom: 0 }}>
                  <SiteStat
                    label="Live"
                    value={site.counts.live}
                    sub={liveUrl ? "see this live data in Wix" : "no Wix site id to link to"}
                    href={liveUrl}
                    external
                    title={liveUrl ? `Open ${site.name}'s listings in the Wix CMS` : undefined}
                  />
                  <SiteStat
                    label="In Progress"
                    value={site.counts.staged}
                    sub="in the staging area"
                    href={`/dashboard/listings/staging?siteId=${encodeURIComponent(site.id)}`}
                    title="See what each in-progress listing is waiting on"
                  />
                </div>
                {audits[site.id] && (() => {
                  const a = audits[site.id];
                  const f = a.folder;
                  return (
                    <div className="text-sm" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
                      <div style={{ marginBottom: 6 }}>
                        <strong>Audit</strong> {fmtDateTime(a.generatedAt)} ·{" "}
                        {a.clean ? <span className="badge badge-success">clean</span> : <span className="badge badge-warning">needs attention</span>}
                      </div>
                      <div>
                        Photo folder:{" "}
                        {!f.configured
                          ? "none configured (imports go to Wix's default location)"
                          : !f.resolved
                            ? `"${a.site.media_folder_name}" not resolved yet (no import has run for this location)`
                            : `"${a.site.media_folder_name}" holds ${f.filesInFolder} file(s)${f.listingTruncated ? " (listing cut short)" : ""}; the engine holds ${f.engineFiles} photo(s), ${f.engineFilesInFolder} in the folder, ${f.outsideFolderCount} outside${f.outsideFolder.length ? ` (${f.outsideFolder.slice(0, 5).join(", ")}${f.outsideFolderCount > 5 ? ", …" : ""})` : ""}; ${f.unknownInFolder} file(s) in the folder are not the engine's`}
                      </div>
                      {a.collections.map((c) => (
                        <div key={c.collectionId} style={{ marginTop: 6 }}>
                          <code>{c.collectionId}</code> ({c.role}): {c.items} row(s), {c.owned} owned by the engine, <strong>{c.staleCount} stale</strong>
                          {c.missing ? `, ${c.missing} engine row(s) missing from the collection` : ""}; galleries: {c.galleryItems} item(s),{" "}
                          {c.galleryOutsideFolder === null ? "folder unresolved" : `${c.galleryOutsideFolder} outside the folder`}
                          {c.galleryNotWixImage ? `, ${c.galleryNotWixImage} not Wix images` : ""}
                          {c.staleCount > 0 && (
                            <ul style={{ margin: "4px 0 0 18px" }}>
                              {c.stale.map((s) => (
                                <li key={s.id}>
                                  <code>{s.id}</code> {s.address ?? ""} {s.status ? `(${s.status})` : ""}
                                </li>
                              ))}
                              {c.staleCount > c.stale.length && <li>…and {c.staleCount - c.stale.length} more</li>}
                            </ul>
                          )}
                          {c.staleCount > 0 && c.deletable && (
                            <button className="btn btn-danger btn-sm" style={{ marginTop: 6 }} disabled={busy !== null} onClick={() => deleteStale(site, c.collectionId, c.staleCount)}>
                              {busy === `stale:${site.id}` ? "Deleting…" : `Delete ${c.staleCount} stale row(s) from ${c.collectionId}`}
                            </button>
                          )}
                          {c.staleCount > 0 && !c.deletable && <div className="text-muted">Stale rows in the live collection are deleted after cutover, when it is the target.</div>}
                        </div>
                      ))}
                      {staleResults[site.id] && <div style={{ marginTop: 6 }}><strong>Deleted:</strong> {staleResults[site.id]}</div>}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          <div className="card">
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
                      <th>Warnings &amp; Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.runs.map((run) => {
                      const outcome = runOutcome(run);
                      const trigger = triggerLabel(run.trigger);
                      const href = runHref(run.run_key);
                      return (
                        <tr key={run.id} onClick={() => router.push(href)} style={{ cursor: "pointer" }} title="Open this run in the Change Log">
                          <td className="text-sm">
                            <Link href={href} onClick={(ev) => ev.stopPropagation()}>
                              {fmtDateTime(run.started_at)}
                            </Link>
                            <div className="text-muted" title={trigger.title}>
                              {trigger.label}
                            </div>
                          </td>
                          <td>{modeLabel(run.mode)}</td>
                          <td>
                            <span className={outcome.cls} title={outcome.title}>
                              {outcome.label}
                            </span>
                            <div className="text-muted text-sm">{run.stage ?? ""}</div>
                            {run.error_message && <div className="text-sm" style={{ color: "var(--danger)" }}>{run.error_message}</div>}
                          </td>
                          <td className="text-sm">{duration(run.duration_ms)}</td>
                          <td className="text-sm">
                            {run.mode === "photos" ? (
                              <span title="Photos downloaded from MLSGrid / imported into Wix">
                                {run.images_downloaded} downloaded · {run.images_imported} imported
                              </span>
                            ) : (
                              <>
                                +{run.inserted} / ~{run.updated} / −{run.deleted}
                                {run.unstaged ? ` / ${run.unstaged} unstaged` : ""}
                                {run.images_imported ? ` · ${run.images_imported} photos` : ""}
                              </>
                            )}
                          </td>
                          <td className="text-sm">{run.deletes_skipped || ""}</td>
                          <td className="text-sm" style={run.writes_failed || run.images_failed ? { color: "var(--danger)" } : undefined}>
                            {run.mode === "photos" ? run.images_failed || "" : run.writes_failed || ""}
                          </td>
                          <td className="text-sm">
                            {run.mlsgrid_request_count} req · {megabytes(run.mlsgrid_bytes)}
                          </td>
                          <td className="text-sm">{run.wix_requests} req</td>
                          <td>
                            <RunTags warnings={run.warnings} errors={run.errors} />
                          </td>
                        </tr>
                      );
                    })}
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
