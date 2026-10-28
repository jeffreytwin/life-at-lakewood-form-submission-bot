"use client";

import { useCallback, useEffect, useState } from "react";
import CommunityAlertTabs from "../tabs";
import type { AlertView } from "@/lib/community-alerts/alerts";
import { SiteTag, siteStyle } from "../alert-card";

const KIND_LABEL: Record<string, string> = {
  sold_out: "sold out",
  new_neighborhood: "new neighborhood",
  announcement: "announcement",
  school_zones: "school zones",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

/** Finished and dismissed Community Alerts, most recently closed first; any of them can be reopened. */
export default function CommunityAlertHistoryPage() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/internal/community-alerts?scope=closed")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.alerts)) {
          setAlerts(data.alerts);
          setError(null);
        } else setError(data?.error ?? "Failed to load");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reopen(id: string) {
    setBusy(id);
    const res = await fetch(`/api/internal/community-alerts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reopen: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? `Could not reopen (HTTP ${res.status})`);
    }
    setBusy(null);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">Alerts that were finished or dismissed. Reopen one to pick its list back up.</p>
        </div>
      </div>
      <CommunityAlertTabs />

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state">Nothing closed yet.</div>
      ) : (
        <div className="card table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Neighborhood</th>
                <th>Alert</th>
                <th>Outcome</th>
                <th>Raised</th>
                <th>Closed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} style={{ background: siteStyle(String(a.detail?.site ?? "")).background }}>
                  <td style={{ borderLeft: siteStyle(String(a.detail?.site ?? "")).borderLeft }}>
                    <strong>{a.name}</strong>
                    <div style={{ marginTop: 2 }}>
                      <SiteTag domain={String(a.detail?.site ?? "")} />
                    </div>
                  </td>
                  <td>{KIND_LABEL[a.kind] ?? a.kind}</td>
                  <td>
                    {a.status === "done" ? (
                      <span className="badge badge-success">completed</span>
                    ) : (
                      <>
                        <span className="badge badge-muted">dismissed</span>
                        {a.dismissedReason && <div className="text-muted text-sm">{a.dismissedReason}</div>}
                      </>
                    )}
                    {a.progress.total > 0 && (
                      <div className="text-muted text-sm">
                        {a.progress.settled} of {a.progress.total} items done
                      </div>
                    )}
                  </td>
                  <td className="text-sm">{when(a.createdAt)}</td>
                  <td className="text-sm">{when(a.resolvedAt)}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" disabled={busy === a.id} onClick={() => reopen(a.id)}>
                      Reopen
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
