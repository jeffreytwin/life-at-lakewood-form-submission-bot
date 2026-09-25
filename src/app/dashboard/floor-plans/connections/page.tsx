"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { HOME_TYPES } from "@/lib/floorplans/standardize";
import { runGoing } from "@/lib/floorplans/run-state";
import FloorPlanTabs from "../tabs";

interface Connection {
  id: string;
  active: boolean;
  /** Set while a run of this connection is going, wherever it was started (runs.ts). */
  run_started_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_plan_count: number | null;
  consecutive_failures: number;
  /**
   * url: the community's own page. listUrls: the pages its plans are
   * listed on, where those are not the community page. quickMoveInUrl: a
   * separate page of homes for sale, where the builder keeps one.
   */
  extractor_params: { url?: string; listUrls?: string[]; quickMoveInUrl?: string } | null;
  fp_communities: { name: string; fp_sites: { domain: string } | null } | null;
}

interface Builder {
  id: string;
  name: string;
  base_url: string | null;
  extraction_method: string | null;
  audit_notes: string | null;
  active: boolean;
  /** The builder's own settings; homeType is what every plan of this builder is. */
  engine_config: { homeType?: string } | null;
  fp_builder_communities: Connection[];
}

/** The engines that read any builder's pages; the rest are one builder's own. */
const GENERIC_METHODS = new Set(["fetch_claude", "render_claude"]);

const METHOD_LABEL: Record<string, string> = {
  json_api: "JSON API",
  fetch_claude: "HTML + Claude",
  render_claude: "Render + Claude",
};

interface SyncSettings {
  fp_nightly_enabled: boolean;
  fp_nightly_hour: number;
  fp_digest_phone: string | null;
  fp_nightly_state: {
    cycleDate?: string;
    startedAt?: string;
    completedAt?: string;
    ran?: number;
    failed?: number;
    manual?: boolean;
  } | null;
  /** While a sync is going: the connections it still owes a run. */
  fp_sync_owed?: number | null;
}

/** How often the page looks again while a run or a sync is going. */
const FOLLOW_MS = 5_000;

interface FlagEntry {
  id?: string;
  plan_name: string | null;
  village: string | null;
  builder: string | null;
  action: string;
  detail: string | null;
  created_at: string;
  fp_sites: { name: string | null } | null;
}

/** What the quick move-in flag check has done (qmi-flags.ts). */
interface FlagLog {
  checked: { site_id: string; detail: string | null; created_at: string; fp_sites: { name: string | null } | null }[];
  fixes: FlagEntry[];
  problems: FlagEntry[];
  days: number;
}

export default function BuildersSettingsPage() {
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [switching, setSwitching] = useState<Set<string>>(new Set());
  const [sync, setSync] = useState<SyncSettings | null>(null);
  const [savingSync, setSavingSync] = useState(false);
  const [startingSync, setStartingSync] = useState(false);
  const [flags, setFlags] = useState<FlagLog | null>(null);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [checkingFlags, setCheckingFlags] = useState(false);

  const fetchSync = useCallback(() => {
    fetch("/api/internal/floorplans/sync-settings")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) setSync(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchSync();
  }, [fetchSync]);

  const fetchFlags = useCallback(() => {
    fetch("/api/internal/floorplans/qmi-flags")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) setFlags(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  /** Checks every site's flags now; the page looks again as the check goes. */
  async function checkFlagsNow() {
    setCheckingFlags(true);
    try {
      await fetch("/api/internal/floorplans/qmi-flags", { method: "POST" });
      for (const wait of [15_000, 30_000, 60_000]) {
        await new Promise((done) => setTimeout(done, wait));
        fetchFlags();
      }
    } finally {
      setCheckingFlags(false);
    }
  }

  async function saveSync(updates: Partial<SyncSettings>) {
    if (!sync) return;
    setSavingSync(true);
    try {
      const res = await fetch("/api/internal/floorplans/sync-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data && !data.error) setSync((was) => ({ ...data, fp_sync_owed: was?.fp_sync_owed ?? null }));
    } finally {
      setSavingSync(false);
    }
  }

  /**
   * Runs every onboarded connection now, as the nightly sync does (Jeff,
   * 2026-09-25). It goes on without this page; the page follows it.
   */
  async function syncNow() {
    setStartingSync(true);
    try {
      const res = await fetch("/api/internal/floorplans/sync-now", { method: "POST" });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "The sync could not start");
      }
    } finally {
      setStartingSync(false);
      fetchSync();
      fetchBuilders();
    }
  }

  const fetchBuilders = useCallback(() => {
    fetch("/api/internal/floorplans/builders")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBuilders(data);
        else setError(data.error ?? "Failed to load");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchBuilders();
  }, [fetchBuilders]);

  /** Opens or closes a builder's communities. */
  const toggleExpanded = useCallback((builderId: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(builderId)) next.delete(builderId);
      else next.add(builderId);
      return next;
    });
  }, []);

  /** Switches a builder between reading its pages and rendering them. */
  const setMethod = useCallback(
    async (b: Builder, method: "fetch_claude" | "render_claude") => {
      setSwitching((s) => new Set(s).add(b.id));
      try {
        const res = await fetch(`/api/internal/floorplans/builders/${b.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extractionMethod: method }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? "Failed to change how this builder is read");
        }
      } finally {
        setSwitching((s) => {
          const next = new Set(s);
          next.delete(b.id);
          return next;
        });
        fetchBuilders();
      }
    },
    [fetchBuilders]
  );

  /** Sets the pages a connection's plans are listed on; blank clears them. */
  const editPlanPages = useCallback(
    async (c: Connection) => {
      const given = window.prompt(
        "Pages this community's plans are listed on, one per line. Leave blank to read them off the source page itself.",
        (c.extractor_params?.listUrls ?? []).join("\n")
      );
      if (given === null) return;
      const res = await fetch(`/api/internal/floorplans/connections/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listUrls: given }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to save the pages");
      }
      fetchBuilders();
    },
    [fetchBuilders]
  );

  /** Sets one of a connection's page addresses; blank clears it. */
  const editConnectionUrl = useCallback(
    async (c: Connection, field: "url" | "quickMoveInUrl", ask: string) => {
      const url = window.prompt(ask, c.extractor_params?.[field] ?? "");
      if (url === null) return;
      const res = await fetch(`/api/internal/floorplans/connections/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: url }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to save the URL");
      }
      fetchBuilders();
    },
    [fetchBuilders]
  );

  async function toggleBuilder(b: Builder) {
    await fetch(`/api/internal/floorplans/builders/${b.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !b.active }),
    });
    fetchBuilders();
  }

  /**
   * What every plan of this builder is, whatever its pages say. Stock
   * Luxury Homes builds single-family homes and nothing else, and its
   * pages name no type at all (Jeff, 2026-09-22). Blank leaves it to the
   * pages, as before.
   */
  async function setHomeType(b: Builder, homeType: string) {
    await fetch(`/api/internal/floorplans/builders/${b.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ homeType: homeType || null }),
    });
    fetchBuilders();
  }

  async function toggleConnection(c: Connection) {
    await fetch(`/api/internal/floorplans/connections/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    fetchBuilders();
  }

  /**
   * Starts a run and leaves it to go on by itself: it keeps going if this
   * page is closed, and the page follows it from the connection's mark
   * (Jeff, 2026-09-25: "even if I leave the site").
   */
  async function runConnection(c: Connection) {
    setRunning((s) => new Set(s).add(c.id));
    try {
      const res = await fetch(`/api/internal/floorplans/connections/${c.id}/run`, { method: "POST" });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => null);
        alert(`Run could not start: ${body?.error ?? res.status}`);
      }
    } finally {
      setRunning((s) => {
        const next = new Set(s);
        next.delete(c.id);
        return next;
      });
      fetchBuilders();
    }
  }

  /** A run of this connection is going, started here or anywhere else. */
  const isRunning = (c: Connection) => runGoing(c.run_started_at);
  const syncGoing = Boolean(sync?.fp_nightly_state?.startedAt && !sync.fp_nightly_state.completedAt);
  const anyRunning = builders.some((b) => b.fp_builder_communities.some(isRunning));

  // While anything is going, look again every few seconds.
  useEffect(() => {
    if (!anyRunning && !syncGoing) return;
    const timer = setInterval(() => {
      fetchBuilders();
      fetchSync();
    }, FOLLOW_MS);
    return () => clearInterval(timer);
  }, [anyRunning, syncGoing, fetchBuilders, fetchSync]);

  /**
   * Deletes a connection for good, the way a sold-out neighborhood leaves
   * (Jeff, 2026-09-21): its plans leave the site and the Hub, then the
   * connection itself. It asks for the word, as Reset does.
   */
  async function removeConnection(b: Builder, c: Connection) {
    const where = `${b.name} at ${c.fp_communities?.name ?? "this community"}`;
    const typed = prompt(
      `Remove ${where}?\n\nThis removes every plan the pipeline holds for this connection from the site's Floor Plans V2 collection and its imported pictures from the site's Media Manager, clears everything the Hub knows about these plans (queued changes, follow-ups, scores, photo records), and deletes the connection itself. Nothing is kept and it cannot be undone; this is how a sold-out neighborhood leaves.\n\nType REMOVE to confirm.`
    );
    if (typed !== "REMOVE") return;
    setRunning((s) => new Set(s).add(c.id));
    try {
      const res = await fetch(`/api/internal/floorplans/connections/${c.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(`Remove failed: ${data.error ?? res.status}`);
      else
        alert(
          `Removed ${where}: ${data.plans ?? 0} plans removed (${data.wixRemoved ?? 0} from Wix), ${data.changes ?? 0} queued changes cleared, ${data.photos ?? 0} pictures removed from the Media Manager` +
            (data.photosFailed ? ` (${data.photosFailed} could not be removed; see the log)` : "") +
            `.`
        );
    } finally {
      setRunning((s) => {
        const next = new Set(s);
        next.delete(c.id);
        return next;
      });
      fetchBuilders();
    }
  }

  async function resetConnection(b: Builder, c: Connection) {
    const where = `${b.name} at ${c.fp_communities?.name ?? "this community"}`;
    // A Reset is a click away from Run and Remove and cannot be undone, so
    // it asks for the word (Jeff hit it by accident on 2026-09-20).
    const typed = prompt(
      `Reset ${where}?\n\nThis removes every plan the pipeline holds for this connection from the site's Floor Plans V2 collection, its imported pictures from the site's Media Manager, and everything the Hub knows about these plans: queued changes, follow-ups, scores, photo records. Nothing is kept. The next Run starts from nothing and tests the whole path from the builder's site.\n\nType RESET to confirm.`
    );
    if (typed !== "RESET") return;
    setRunning((s) => new Set(s).add(c.id));
    try {
      const res = await fetch(`/api/internal/floorplans/connections/${c.id}/reset`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(`Reset failed: ${data.error ?? res.status}`);
      else
        alert(
          `Reset ${where}: ${data.plans ?? 0} plans removed (${data.wixRemoved ?? 0} from Wix), ${data.changes ?? 0} queued changes cleared, ${data.photos ?? 0} pictures removed from the Media Manager` +
            (data.photosFailed ? ` (${data.photosFailed} could not be removed; see the log)` : "") +
            `.`
        );
    } finally {
      setRunning((s) => {
        const next = new Set(s);
        next.delete(c.id);
        return next;
      });
      fetchBuilders();
    }
  }

  function health(b: Builder) {
    if (!b.active) return { label: "Paused", cls: "badge-muted" };
    if (!b.extraction_method) return { label: "Needs setup", cls: "badge-warning" };
    const going = b.fp_builder_communities.filter(isRunning).length;
    if (going) return { label: going === 1 ? "Running…" : `${going} running…`, cls: "badge-info" };
    const fails = b.fp_builder_communities.reduce((m, c) => Math.max(m, c.consecutive_failures), 0);
    if (fails >= 2) return { label: `${fails} failures`, cls: "badge-danger" };
    const ran = b.fp_builder_communities.some((c) => c.last_run_at);
    return ran ? { label: "Healthy", cls: "badge-success" } : { label: "Not run yet", cls: "badge-info" };
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Builder Connections</h2>
          <p className="text-muted">
            Every builder the floor plan pipeline scrapes, and the communities each covers.
            Pausing is safe: a paused connection is skipped entirely — no scrape, no diff,
            and no removals can be triggered by its absence.
          </p>
        </div>
      </div>
      <FloorPlanTabs />

      {sync && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={sync.fp_nightly_enabled}
                disabled={savingSync}
                onChange={(e) => saveSync({ fp_nightly_enabled: e.target.checked })}
              />
              <strong>Nightly sync {sync.fp_nightly_enabled ? "on" : "off"}</strong>
            </label>
            <label>
              Run at{" "}
              <select
                className="form-input"
                style={{ width: "auto", display: "inline-block" }}
                value={sync.fp_nightly_hour}
                disabled={savingSync}
                onChange={(e) => saveSync({ fp_nightly_hour: parseInt(e.target.value, 10) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {((h % 12) || 12)}:00 {h < 12 ? "AM" : "PM"} ET
                  </option>
                ))}
              </select>
            </label>
            <label>
              Digest SMS to{" "}
              <input
                className="form-input"
                style={{ width: 160, display: "inline-block" }}
                placeholder="+1…  (optional)"
                defaultValue={sync.fp_digest_phone ?? ""}
                disabled={savingSync}
                onBlur={(e) => {
                  if ((e.target.value.trim() || null) !== (sync.fp_digest_phone ?? null)) {
                    saveSync({ fp_digest_phone: e.target.value });
                  }
                }}
              />
            </label>
            <button
              className="btn btn-primary"
              style={{ padding: "4px 14px" }}
              disabled={startingSync || syncGoing}
              onClick={syncNow}
              title="Run every onboarded connection now, as the nightly sync does. It keeps going if you leave this page."
            >
              {startingSync ? "Starting…" : syncGoing ? "Syncing…" : "Sync now"}
            </button>
            {syncGoing ? (
              <span className="text-muted text-sm">
                {sync.fp_nightly_state?.manual ? "Sync started " : "Nightly sync started "}
                {new Date(sync.fp_nightly_state!.startedAt!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}: ran{" "}
                {sync.fp_nightly_state?.ran ?? 0}
                {sync.fp_nightly_state?.failed ? ` (${sync.fp_nightly_state.failed} failed)` : ""}
                {sync.fp_sync_owed != null ? `, ${sync.fp_sync_owed} to go` : ""}
              </span>
            ) : (
              sync.fp_nightly_state?.cycleDate && (
                <span className="text-muted text-sm">
                  Last {sync.fp_nightly_state.manual ? "sync" : "cycle"} {sync.fp_nightly_state.cycleDate}: ran{" "}
                  {sync.fp_nightly_state.ran ?? 0}
                  {sync.fp_nightly_state.failed ? `, ${sync.fp_nightly_state.failed} failed` : ""} ✓
                </span>
              )
            )}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>
            The nightly sync and Sync now cover the connections that have completed at least
            one successful manual Run — onboard each builder by hand first. A sync or a Run
            keeps going if you leave this page.
          </p>
        </div>
      )}

      {flags && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <strong>Quick move-in flags</strong>
            <span className="text-muted text-sm">
              {flags.checked.length
                ? `Last checked ${new Date(
                    flags.checked.map((c) => c.created_at).sort().pop()!
                  ).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                : "Not checked yet"}
              {" · "}
              {flags.fixes.length} fixed in the last {flags.days} days
              {" · "}
              {flags.problems.length} to look at
            </span>
            <button className="btn btn-secondary" style={{ padding: "2px 10px" }} disabled={checkingFlags} onClick={checkFlagsNow}>
              {checkingFlags ? "Checking…" : "Check now"}
            </button>
            {(flags.fixes.length > 0 || flags.problems.length > 0) && (
              <button className="btn btn-secondary" style={{ padding: "2px 10px" }} onClick={() => setFlagsOpen((o) => !o)}>
                {flagsOpen ? "Hide details" : "Show details"}
              </button>
            )}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>
            A floor plan&apos;s &quot;quick move-ins available&quot; flag, banner, badge and dot are set from the
            published quick move-ins filed under it in Wix — right after every approved change, and four times a
            day for every row — without a review.
          </p>
          {flagsOpen && (
            <div style={{ marginTop: 12 }}>
              {flags.problems.length > 0 && (
                <>
                  <div className="text-sm" style={{ fontWeight: 600, marginBottom: 4 }}>To look at</div>
                  <ul className="text-sm" style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                    {flags.problems.map((p, i) => (
                      <li key={p.id ?? i}>
                        {p.fp_sites?.name} · {p.builder} · {p.village} · <strong>{p.plan_name}</strong>: {p.detail}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {flags.fixes.length > 0 && (
                <>
                  <div className="text-sm" style={{ fontWeight: 600, marginBottom: 4 }}>Fixed</div>
                  <ul className="text-sm" style={{ margin: 0, paddingLeft: 18 }}>
                    {flags.fixes.map((f, i) => (
                      <li key={f.id ?? i}>
                        {new Date(f.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{" "}
                        · {f.fp_sites?.name} · {f.builder} · {f.village} · <strong>{f.plan_name}</strong>:{" "}
                        {f.action === "set" ? "now shows quick move-ins" : "no longer shows quick move-ins"} ({f.detail})
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Builder</th>
                  <th>Method</th>
                  <th title="What every plan of this builder is, whatever its pages say. Blank leaves it to the pages.">Home type</th>
                  <th>Health</th>
                  <th>Last run</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {builders.map((b) => {
                  const h = health(b);
                  const isOpen = expanded.has(b.id);
                  const lastRun = b.fp_builder_communities
                    .map((c) => c.last_run_at)
                    .filter(Boolean)
                    .sort()
                    .pop();
                  return (
                    <Fragment key={b.id}>
                      <tr
                        style={{ opacity: b.active ? 1 : 0.55, cursor: "pointer" }}
                        onClick={(e) => {
                          // Anywhere on the row opens it, except the things
                          // that do something of their own (Jeff, 2026-09-22),
                          // and except when someone was only selecting text.
                          if ((e.target as HTMLElement).closest("button, a, select, input, label")) return;
                          if (window.getSelection()?.toString()) return;
                          toggleExpanded(b.id);
                        }}
                      >
                        <td style={{ width: 28, paddingRight: 0 }}>
                          <button
                            className="row-caret"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} ${b.name}'s communities`}
                            title={`${b.fp_builder_communities.length} ${b.fp_builder_communities.length === 1 ? "community" : "communities"}`}
                            onClick={() => toggleExpanded(b.id)}
                          >
                            {isOpen ? "▾" : "▸"}
                          </button>
                        </td>
                        <td>
                          <strong>{b.name}</strong>
                          <span className="text-muted text-sm">
                            {" "}· {b.fp_builder_communities.length}{" "}
                            {b.fp_builder_communities.length === 1 ? "community" : "communities"}
                          </span>
                          {b.base_url && (
                            <div>
                              <a href={b.base_url} target="_blank" rel="noreferrer" className="text-muted text-sm">
                                {b.base_url.replace(/^https?:\/\/(www\.)?/, "")} ↗
                              </a>
                            </div>
                          )}
                        </td>
                        <td>
                          {b.extraction_method ? (
                            <span className="badge badge-info">{METHOD_LABEL[b.extraction_method] ?? b.extraction_method}</span>
                          ) : (
                            <span className="text-muted text-sm">{b.audit_notes?.slice(0, 60) ?? "—"}</span>
                          )}
                          {/* Some builders draw their plans only after the
                              page loads, and carry nothing a plain fetch can
                              read (Richmond American's, 2026-09-22). Reading
                              those takes a browser, which is slower, so it is
                              off unless a builder needs it. */}
                          {GENERIC_METHODS.has(b.extraction_method ?? "") && (
                            <div>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: "0 6px", fontSize: 11, marginTop: 4 }}
                                disabled={switching.has(b.id)}
                                onClick={() => setMethod(b, b.extraction_method === "render_claude" ? "fetch_claude" : "render_claude")}
                                title={
                                  b.extraction_method === "render_claude"
                                    ? "Go back to reading the page as it arrives — faster, and enough for most builders"
                                    : "Open the pages in a browser and wait for them to fill in — for builders whose pages are empty without it"
                                }
                              >
                                {switching.has(b.id)
                                  ? "saving…"
                                  : b.extraction_method === "render_claude"
                                    ? "stop using a browser"
                                    : "use a browser"}
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <select
                            className="form-input"
                            style={{ padding: "2px 6px", minWidth: 150 }}
                            value={b.engine_config?.homeType ?? ""}
                            onChange={(e) => setHomeType(b, e.target.value)}
                            title="What every plan of this builder is, whatever its pages say. Blank leaves it to the pages."
                          >
                            <option value="">From the page</option>
                            {HOME_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className={`badge ${h.cls}`}>{h.label}</span>
                        </td>
                        <td className="text-muted text-sm">
                          {lastRun ? new Date(lastRun).toLocaleString() : "never"}
                        </td>
                        <td>
                          <button className="btn btn-secondary" onClick={() => toggleBuilder(b)}>
                            {b.active ? "Pause" : "Resume"}
                          </button>
                        </td>
                      </tr>
                      {isOpen &&
                        b.fp_builder_communities.map((c) => (
                          <tr key={c.id} style={{ opacity: b.active && c.active ? 1 : 0.55 }}>
                            <td style={{ width: 28 }}></td>
                            <td className="text-sm">
                              ↳ {c.fp_communities?.name}
                              <span className="text-muted"> · {c.fp_communities?.fp_sites?.domain}</span>
                              <div>
                                {c.extractor_params?.url ? (
                                  <a href={c.extractor_params.url} target="_blank" rel="noreferrer" className="text-muted text-sm">
                                    source page ↗
                                  </a>
                                ) : (
                                  <span className="text-muted text-sm">URL auto-discovers on first run</span>
                                )}{" "}
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: "0 6px", fontSize: 11 }}
                                  onClick={() =>
                                    editConnectionUrl(
                                      c,
                                      "url",
                                      "Builder page URL for this community (blank = re-discover on next run):"
                                    )
                                  }
                                >
                                  edit URL
                                </button>
                              </div>
                              {/* Builders that split a community into parts
                                  and list the homes under each (Perry, by lot
                                  width). The community page is still the
                                  connection's address; these are where the
                                  plans are read from. */}
                              {GENERIC_METHODS.has(b.extraction_method ?? "") && (
                                <div>
                                  {c.extractor_params?.listUrls?.length ? (
                                    <span className="text-muted text-sm">
                                      plans read from {c.extractor_params.listUrls.length} page
                                      {c.extractor_params.listUrls.length === 1 ? "" : "s"}
                                    </span>
                                  ) : (
                                    <span className="text-muted text-sm">plans read from the source page</span>
                                  )}{" "}
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: "0 6px", fontSize: 11 }}
                                    onClick={() => editPlanPages(c)}
                                    title="For a community split into parts, each with its own list of homes"
                                  >
                                    edit plan pages
                                  </button>
                                </div>
                              )}
                              {/* Builders that keep their homes for sale on a
                                  page of their own (Stock's /inventory/). Only
                                  the generic Claude engine reads a second page;
                                  the bespoke ones get homes from their API. */}
                              {GENERIC_METHODS.has(b.extraction_method ?? "") && (
                                <div>
                                  {c.extractor_params?.quickMoveInUrl ? (
                                    <a
                                      href={c.extractor_params.quickMoveInUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-muted text-sm"
                                    >
                                      move-ins page ↗
                                    </a>
                                  ) : (
                                    <span className="text-muted text-sm">move-ins come off the source page</span>
                                  )}{" "}
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: "0 6px", fontSize: 11 }}
                                    onClick={() =>
                                      editConnectionUrl(
                                        c,
                                        "quickMoveInUrl",
                                        "Quick move-in page URL, where this builder lists its homes for sale away from its plans (blank = read them off the source page):"
                                      )
                                    }
                                  >
                                    edit move-ins URL
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="text-muted text-sm">
                              {c.last_plan_count != null ? `${c.last_plan_count} plans` : "—"}
                            </td>
                            <td className="text-muted text-sm">
                              {isRunning(c)
                                ? `running since ${new Date(c.run_started_at!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                                : c.consecutive_failures > 0
                                  ? `${c.consecutive_failures} consecutive failures`
                                  : c.last_run_status ?? "—"}
                            </td>
                            <td></td>
                            <td className="text-muted text-sm">
                              {c.last_run_at ? new Date(c.last_run_at).toLocaleString() : "never"}
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  className="btn btn-primary"
                                  style={{ padding: "2px 10px" }}
                                  onClick={() => runConnection(c)}
                                  disabled={!b.active || !c.active || running.has(c.id) || isRunning(c)}
                                >
                                  {running.has(c.id) || isRunning(c) ? "Running…" : "Run"}
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: "2px 10px" }}
                                  onClick={() => toggleConnection(c)}
                                  disabled={!b.active}
                                >
                                  {c.active ? "Pause" : "Resume"}
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: "2px 10px" }}
                                  title="Remove every plan this connection has put in Floor Plans V2 and the Hub, and start over"
                                  onClick={() => resetConnection(b, c)}
                                  disabled={running.has(c.id) || isRunning(c)}
                                >
                                  Reset
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: "2px 10px" }}
                                  title="Remove this connection for good: its plans leave the site and the Hub, then the connection goes (a sold-out neighborhood)"
                                  onClick={() => removeConnection(b, c)}
                                  disabled={running.has(c.id) || isRunning(c)}
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
