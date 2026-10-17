"use client";

import { useCallback, useEffect, useState } from "react";
import CommunityAlertTabs from "../tabs";
import { when } from "../alert-card";
import type { IgnoredNeighborhood } from "@/lib/community-alerts/alerts";

/** The neighborhoods no scan raises; un-ignoring one lets the next scan that finds homes there raise it again. */
export default function IgnoredNeighborhoodsPage() {
  const [ignored, setIgnored] = useState<IgnoredNeighborhood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/internal/community-alerts/ignored")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.ignored)) {
          setIgnored(data.ignored);
          setError(null);
        } else setError(data?.error ?? "Failed to load");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function unignore(id: string) {
    setBusy(id);
    const res = await fetch(`/api/internal/community-alerts/ignored/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? `Could not un-ignore (HTTP ${res.status})`);
    }
    setBusy(null);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">
            Neighborhoods you&apos;ve said never to raise. Un-ignore one and the next scan that finds homes there raises
            it again.
          </p>
        </div>
      </div>
      <CommunityAlertTabs />
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : ignored.length === 0 ? (
        <div className="empty-state">Nothing ignored.</div>
      ) : (
        <div className="card table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Neighborhood</th>
                <th>Site</th>
                <th>Why</th>
                <th>Ignored</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ignored.map((n) => (
                <tr key={n.id}>
                  <td>
                    <strong>{n.name}</strong>
                  </td>
                  <td className="text-sm">{n.site ?? "—"}</td>
                  <td className="text-sm">{n.reason ?? <span className="text-muted">—</span>}</td>
                  <td className="text-sm">{when(n.createdAt)}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" disabled={busy === n.id} onClick={() => unignore(n.id)}>
                      Un-ignore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
