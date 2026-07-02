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
    garages?: string | null;
    homeType?: string | null;
    quickMoveIn?: boolean;
    sourceUrl?: string | null;
    primaryImage?: string | null;
    galleryImages?: string[];
    blueprintImages?: string[];
    userEditedFields?: string[];
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
  const [editing, setEditing] = useState<PendingChange | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    priceDisplay: "",
    beds: "",
    baths: "",
    sqft: "",
    garages: "",
    homeType: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editGallery, setEditGallery] = useState<string[]>([]);
  const [editBlueprints, setEditBlueprints] = useState<string[]>([]);

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

  function openEdit(c: PendingChange) {
    const rec = c.proposed_record ?? {};
    setEditForm({
      name: rec.name ?? "",
      priceDisplay: rec.priceDisplay ?? "",
      beds: rec.beds ?? "",
      baths: rec.baths ?? "",
      sqft: rec.sqft != null ? String(rec.sqft) : "",
      garages: rec.garages ?? "",
      homeType: rec.homeType ?? "",
    });
    const gallery = rec.galleryImages?.length
      ? rec.galleryImages
      : rec.primaryImage
        ? [rec.primaryImage]
        : [];
    setEditGallery(gallery);
    setEditBlueprints(rec.blueprintImages ?? []);
    setEditing(c);
  }

  function moveImage(list: string[], setList: (v: string[]) => void, index: number, dir: -1 | 1) {
    const next = [...list];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setList(next);
  }

  async function saveEdit(approveAfter: boolean) {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/internal/floorplans/changes/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          record: { ...editForm, galleryImages: editGallery, blueprintImages: editBlueprints },
        }),
      });
      if (res.ok && approveAfter) {
        await fetch(`/api/internal/floorplans/changes/${editing.id}/approve`, { method: "POST" });
      }
    } finally {
      setSavingEdit(false);
      setEditing(null);
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
                  <th></th>
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
                      <td style={{ width: 92 }}>
                        {rec?.primaryImage ? (
                          <a href={rec.primaryImage} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={rec.primaryImage}
                              alt={rec?.name ?? c.plan_key}
                              style={{ width: 84, height: 56, objectFit: "cover", borderRadius: 6, display: "block" }}
                            />
                          </a>
                        ) : (
                          <span className="text-muted text-sm">no image</span>
                        )}
                      </td>
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
                        {(rec?.userEditedFields?.length ?? 0) > 0 && (
                          <div className="text-muted text-sm">✎ edited: {rec?.userEditedFields?.join(", ")}</div>
                        )}
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
                              onClick={() => openEdit(c)}
                            >
                              Edit
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

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit before approving</h3>
            <p className="text-muted text-sm">
              Edited fields are marked as manual overrides — future scrapes will not
              propose reverting them to the builder&apos;s values.
            </p>
            {(
              [
                ["name", "Plan name"],
                ["priceDisplay", "Price (e.g. $807,995)"],
                ["beds", "Bedrooms"],
                ["baths", "Bathrooms"],
                ["sqft", "Square feet"],
                ["garages", "Garages (e.g. 3 car)"],
                ["homeType", "Home type"],
              ] as const
            ).map(([field, label]) => (
              <div className="form-group" key={field}>
                <label>{label}</label>
                <input
                  className="form-input"
                  value={editForm[field]}
                  onChange={(e) => setEditForm((f) => ({ ...f, [field]: e.target.value }))}
                />
              </div>
            ))}
            {(
              [
                ["Photo gallery (first image is the main image)", editGallery, setEditGallery],
                ["Blueprints", editBlueprints, setEditBlueprints],
              ] as const
            ).map(([label, list, setList]) =>
              list.length === 0 ? null : (
                <div className="form-group" key={label}>
                  <label>{label}</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {list.map((url, i) => (
                      <div key={url} style={{ position: "relative", textAlign: "center" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt=""
                          style={{
                            width: 96, height: 64, objectFit: "cover", borderRadius: 6,
                            border: i === 0 && list === editGallery ? "2px solid var(--accent, #2563eb)" : "1px solid #ccc",
                            display: "block",
                          }}
                        />
                        {i === 0 && list === editGallery && (
                          <span className="text-sm" style={{ position: "absolute", top: 2, left: 4, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 4, padding: "0 4px" }}>
                            main
                          </span>
                        )}
                        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 2 }}>
                          <button className="btn btn-secondary" style={{ padding: "0 6px" }} onClick={() => moveImage(list, setList, i, -1)} disabled={i === 0}>←</button>
                          <button className="btn btn-secondary" style={{ padding: "0 6px" }} onClick={() => setList(list.filter((u) => u !== url))}>✕</button>
                          <button className="btn btn-secondary" style={{ padding: "0 6px" }} onClick={() => moveImage(list, setList, i, 1)} disabled={i === list.length - 1}>→</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={savingEdit}>
                Cancel
              </button>
              <button className="btn btn-secondary" onClick={() => saveEdit(false)} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save"}
              </button>
              <button className="btn btn-primary" onClick={() => saveEdit(true)} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save & Approve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
