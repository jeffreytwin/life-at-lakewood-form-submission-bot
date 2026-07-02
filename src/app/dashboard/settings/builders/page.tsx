"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

interface Connection {
  id: string;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_plan_count: number | null;
  consecutive_failures: number;
  fp_communities: { name: string; fp_sites: { domain: string } | null } | null;
}

interface Builder {
  id: string;
  name: string;
  base_url: string | null;
  extraction_method: string | null;
  audit_notes: string | null;
  active: boolean;
  fp_builder_communities: Connection[];
}

const METHOD_LABEL: Record<string, string> = {
  json_api: "JSON API",
  fetch_claude: "HTML + Claude",
  render_claude: "Render + Claude",
};

export default function BuildersSettingsPage() {
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<Set<string>>(new Set());

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

  async function toggleBuilder(b: Builder) {
    await fetch(`/api/internal/floorplans/builders/${b.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !b.active }),
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

  async function runConnection(c: Connection) {
    setRunning((s) => new Set(s).add(c.id));
    try {
      await fetch(`/api/internal/floorplans/connections/${c.id}/run`, { method: "POST" });
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
                  <th>Builder</th>
                  <th>Method</th>
                  <th>Health</th>
                  <th>Communities</th>
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
                      <tr style={{ opacity: b.active ? 1 : 0.55 }}>
                        <td>
                          <strong>{b.name}</strong>
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
                        </td>
                        <td>
                          <span className={`badge ${h.cls}`}>{h.label}</span>
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: "2px 10px" }}
                            onClick={() =>
                              setExpanded((s) => {
                                const next = new Set(s);
                                if (next.has(b.id)) next.delete(b.id);
                                else next.add(b.id);
                                return next;
                              })
                            }
                          >
                            {b.fp_builder_communities.length} {isOpen ? "▴" : "▾"}
                          </button>
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
                            <td className="text-sm" style={{ paddingLeft: 28 }}>
                              ↳ {c.fp_communities?.name}
                              <span className="text-muted"> · {c.fp_communities?.fp_sites?.domain}</span>
                            </td>
                            <td className="text-muted text-sm">
                              {c.last_plan_count != null ? `${c.last_plan_count} plans` : "—"}
                            </td>
                            <td className="text-muted text-sm">
                              {c.consecutive_failures > 0 ? `${c.consecutive_failures} consecutive failures` : c.last_run_status ?? "—"}
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
                                  disabled={!b.active || !c.active || running.has(c.id)}
                                >
                                  {running.has(c.id) ? "Running…" : "Run"}
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: "2px 10px" }}
                                  onClick={() => toggleConnection(c)}
                                  disabled={!b.active}
                                >
                                  {c.active ? "Pause" : "Resume"}
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
