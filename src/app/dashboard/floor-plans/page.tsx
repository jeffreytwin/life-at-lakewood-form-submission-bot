"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface PendingChange {
  id: string;
  change_type: "add" | "update" | "remove";
  plan_key: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  status: string;
  error_detail: string | null;
  created_at: string;
  proposed_record: {
    name?: string;
    priceDisplay?: string | null;
    beds?: string;
    baths?: string;
    sqft?: number | null;
    quickMoveIn?: boolean;
    sourceUrl?: string | null;
  } | null;
  fp_sites: { domain: string; name: string } | null;
  fp_communities: { name: string } | null;
  fp_builders: { name: string } | null;
}

const CHANGE_LABEL: Record<PendingChange["change_type"], string> = {
  add: "New Plan",
  update: "Update",
  remove: "Remove",
};

export default function FloorPlansPage() {
  const [changes, setChanges] = useState<PendingChange[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [siteFilter, setSiteFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const fetchChanges = useCallback(() => {
    fetch(`/api/internal/floorplans/changes?status=${statusFilter}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setChanges(data);
        else setError(data.error ?? "Failed to load");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchChanges();
  }, [fetchChanges]);

  const sites = useMemo(
    () => [...new Set(changes.map((c) => c.fp_sites?.domain).filter(Boolean))] as string[],
    [changes]
  );
  const visible = useMemo(
    () => changes.filter((c) => siteFilter === "all" || c.fp_sites?.domain === siteFilter),
    [changes, siteFilter]
  );

  async function act(id: string, action: "approve" | "reject") {
    setBusy((b) => new Set(b).add(id));
    try {
      await fetch(`/api/internal/floorplans/changes/${id}/${action}`, { method: "POST" });
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
      fetchChanges();
    }
  }

  async function bulkApprove() {
    if (!confirm(`Approve all ${visible.length} visible changes? Approved adds are written to Wix as drafts.`)) return;
    setBulkBusy(true);
    try {
      for (const c of visible) {
        if (c.status !== "pending") continue;
        await fetch(`/api/internal/floorplans/changes/${c.id}/approve`, { method: "POST" });
      }
    } finally {
      setBulkBusy(false);
      fetchChanges();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Floor Plan Changes</h2>
          <p className="text-muted">
            Detected changes from builder websites. Approved new plans are written to the
            Floor Plans V2 collection as drafts — publish them in the Wix CMS to make them live.
          </p>
        </div>
        {statusFilter === "pending" && visible.some((c) => c.status === "pending") && (
          <button className="btn btn-primary" onClick={bulkApprove} disabled={bulkBusy}>
            {bulkBusy ? "Approving…" : `Approve All (${visible.filter((c) => c.status === "pending").length})`}
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <label>
          Status{" "}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="pending">Pending</option>
            <option value="synced_draft">Synced (draft in Wix)</option>
            <option value="synced">Synced</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Site{" "}
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          No {statusFilter === "all" ? "" : statusFilter} floor plan changes.
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Plan</th>
                  <th>Details</th>
                  <th>Site / Community / Builder</th>
                  <th>Detected</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const rec = c.proposed_record;
                  return (
                    <tr key={c.id}>
                      <td>
                        <span className={`badge ${c.change_type === "remove" ? "badge-danger" : c.change_type === "add" ? "badge-success" : "badge-warning"}`}>
                          {CHANGE_LABEL[c.change_type]}
                        </span>
                        {c.status !== "pending" && (
                          <div className="text-muted text-sm">{c.status}</div>
                        )}
                      </td>
                      <td>
                        <strong>{rec?.name ?? c.plan_key}</strong>
                        {rec?.quickMoveIn && <div className="text-muted text-sm">Quick Move-In</div>}
                        {rec?.sourceUrl && (
                          <div>
                            <a href={rec.sourceUrl} target="_blank" rel="noreferrer" className="text-sm">
                              builder page ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td>
                        {c.change_type === "update" && c.field_changed ? (
                          <span>
                            {c.field_changed}: <s className="text-muted">{c.old_value}</s> → <strong>{c.new_value}</strong>
                          </span>
                        ) : (
                          <span>
                            {rec?.priceDisplay ?? "—"}
                            {rec?.beds ? ` · ${rec.beds} bd` : ""}
                            {rec?.baths ? ` · ${rec.baths} ba` : ""}
                            {rec?.sqft ? ` · ${rec.sqft.toLocaleString()} sqft` : ""}
                          </span>
                        )}
                        {c.status === "failed" && c.error_detail && (
                          <div className="text-muted text-sm">⚠ {c.error_detail}</div>
                        )}
                      </td>
                      <td className="text-sm">
                        {c.fp_sites?.domain}
                        <div className="text-muted">
                          {c.fp_communities?.name} · {c.fp_builders?.name}
                        </div>
                      </td>
                      <td className="text-muted text-sm">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        {c.status === "pending" && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn btn-primary"
                              disabled={busy.has(c.id)}
                              onClick={() => act(c.id, "approve")}
                            >
                              {busy.has(c.id) ? "…" : "Approve"}
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busy.has(c.id)}
                              onClick={() => act(c.id, "reject")}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
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
