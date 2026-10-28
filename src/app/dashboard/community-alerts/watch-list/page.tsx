"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import CommunityAlertTabs from "../tabs";
import { SiteTag, siteStyle, when } from "../alert-card";
import type { WatchEntry } from "@/lib/community-alerts/watch-list";

const SITES = ["lifeatlakewood.com", "lifeinwellenpark.com", "lifeatparrish.com"];

/**
 * "Coming soon" neighborhoods being waited on (Jeff, 2026-10-17). The daily
 * scan looks for homes in each, on the community's home finder and the
 * MLS; the day it finds one, it raises a new-neighborhood alert.
 */
export default function WatchListPage() {
  const [watching, setWatching] = useState<WatchEntry[]>([]);
  const [found, setFound] = useState<WatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ site: SITES[0], name: "", note: "", sourceUrl: "" });
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/internal/community-alerts/watch")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.watching)) {
          setWatching(data.watching);
          setFound(data.found ?? []);
          setError(null);
        } else setError(data?.error ?? "Failed to load");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setBusy(true);
    setProblem(null);
    const res = await fetch("/api/internal/community-alerts/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) setForm({ ...form, name: "", note: "", sourceUrl: "" });
    else setProblem((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
    setBusy(false);
    load();
  }

  async function stop(id: string) {
    setBusy(true);
    const res = await fetch(`/api/internal/community-alerts/watch/${id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
    setBusy(false);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">
            &ldquo;Coming soon&rdquo; neighborhoods you&apos;re waiting on. Every day the Hub looks for homes for sale in each,
            on the community&apos;s home finder and the MLS; the day it finds one, a New Neighborhoods alert appears with the
            to-do list for adding it.
          </p>
        </div>
      </div>
      <CommunityAlertTabs />

      <div className="card" style={{ marginBottom: 16 }}>
        <strong>Watch a neighborhood</strong>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <select className="form-input" style={{ width: 200 }} value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })}>
            {SITES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Neighborhood name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Note (optional)"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Link to the announcement (optional)"
            value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
          />
          <button className="btn btn-primary" disabled={busy || !form.name.trim()} onClick={add}>
            Watch
          </button>
        </div>
        {problem && (
          <div className="text-sm" style={{ marginTop: 6, color: "var(--danger)" }}>
            {problem}
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : (
        <>
          {watching.length === 0 ? (
            <div className="empty-state">Nothing watched. Watch an announcement, or add one above.</div>
          ) : (
            <div className="card table-wrapper" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Watching</th>
                    <th>Site</th>
                    <th>Note</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {watching.map((w) => (
                    <tr key={w.id} style={{ background: siteStyle(w.site).background }}>
                      <td style={{ borderLeft: siteStyle(w.site).borderLeft }}>
                        <strong>{w.name}</strong>
                        {w.sourceUrl && (
                          <div className="text-sm">
                            <a href={w.sourceUrl} target="_blank" rel="noreferrer">
                              announcement ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td className="text-sm">
                        <SiteTag domain={w.site} />
                      </td>
                      <td className="text-sm">{w.note ?? <span className="text-muted">—</span>}</td>
                      <td className="text-sm">{when(w.createdAt)}</td>
                      <td>
                        <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => stop(w.id)}>
                          Stop watching
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {found.length > 0 && (
            <div className="card">
              <strong>Found lately</strong>
              {found.map((w) => (
                <div key={w.id} className="text-sm" style={{ marginTop: 6 }}>
                  {w.name} <SiteTag domain={w.site} /> <span className="text-muted">· {when(w.foundAt)}</span>
                  {w.alertId ? (
                    <>
                      {" "}
                      · <Link href="/dashboard/community-alerts/new-neighborhoods">see its alert</Link>
                    </>
                  ) : (
                    <span className="text-muted"> · already in an engine</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
