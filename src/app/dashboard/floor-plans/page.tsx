"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { groupChanges, type ChangeGroup } from "@/lib/floorplans/group-changes";

interface GalleryMeta {
  caption?: string | null;
  room?: string | null;
  kind?: string;
}

interface ProposedRecord {
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
  galleryMeta?: Record<string, GalleryMeta>;
  description?: string | null;
  virtualTourUrl?: string | null;
  userEditedFields?: string[];
}

interface PendingChange {
  id: string;
  site_id: string;
  community_id: string;
  builder_id: string;
  change_type: "add" | "update" | "remove";
  plan_key: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  status: string;
  error_detail: string | null;
  created_at: string;
  updated_at: string | null;
  proposed_record: ProposedRecord | null;
  fp_sites: { domain: string; name: string } | null;
  fp_communities: { name: string } | null;
  fp_builders: { name: string } | null;
  fp_floor_plans: { id: string; starred: boolean } | null;
}

type Group = ChangeGroup<PendingChange>;

interface FollowUpTask {
  id: string;
  task_type: string;
  detail: string | null;
  created_at: string;
  fp_floor_plans: { name: string; fp_sites: { domain: string } | null } | null;
}

interface Preview {
  src: string;
  caption?: string | null;
}

const CHANGE_LABEL: Record<PendingChange["change_type"], string> = {
  add: "New Plan",
  update: "Update",
  remove: "Remove",
};

/** "3908" reads as 3,908 wherever the queue shows square feet (rows queued before the diff formatted them). */
function formatValue(field: string | null, value: string | null): string {
  if (value == null) return "";
  if (field === "sqft" && /^\d+$/.test(value)) return Number(value).toLocaleString("en-US");
  return value;
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const pendingIds = (g: Group) => g.rows.filter((r) => r.status === "pending").map((r) => r.id);

/**
 * One gallery in the edit overlay. Photos move by drag and drop or by the
 * arrows; hovering shows the picture large (Jeff, 2026-09-19).
 */
function GalleryEditor({
  label,
  list,
  setList,
  meta,
  isPhotos,
  onPreview,
}: {
  label: string;
  list: string[];
  setList: (v: string[]) => void;
  meta?: Record<string, GalleryMeta>;
  isPhotos: boolean;
  onPreview: (p: Preview | null) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  if (list.length === 0) return null;
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    setList(reorder(list, index, target));
  };
  return (
    <div className="form-group">
      <label>{label}</label>
      <p className="text-muted" style={{ fontSize: 11, margin: "0 0 6px" }}>
        Drag a picture to where it belongs, or use the arrows. Hover to see it large.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {list.map((url, i) => {
          const m = meta?.[url];
          return (
            <div
              key={url}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== i) setList(reorder(list, dragIndex, i));
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              onMouseEnter={() => onPreview({ src: url, caption: m?.caption })}
              onMouseLeave={() => onPreview(null)}
              style={{ position: "relative", textAlign: "center", cursor: "grab", opacity: dragIndex === i ? 0.4 : 1 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                style={{
                  width: 96, height: 64, objectFit: "cover", borderRadius: 6,
                  border: i === 0 && isPhotos ? "2px solid var(--accent, #2563eb)" : "1px solid #ccc",
                  display: "block",
                }}
              />
              {i === 0 && isPhotos && (
                <span className="text-sm" style={{ position: "absolute", top: 2, left: 4, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 4, padding: "0 4px" }}>
                  main
                </span>
              )}
              <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 2 }}>
                <button className="btn btn-secondary" style={{ padding: "0 6px" }} onClick={() => move(i, -1)} disabled={i === 0}>←</button>
                <button className="btn btn-secondary" style={{ padding: "0 6px" }} onClick={() => setList(list.filter((u) => u !== url))}>✕</button>
                <button className="btn btn-secondary" style={{ padding: "0 6px" }} onClick={() => move(i, 1)} disabled={i === list.length - 1}>→</button>
              </div>
              {isPhotos && m && (
                <div
                  className="text-muted"
                  title={m.caption ?? ""}
                  style={{ fontSize: 10, width: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {m.room ?? "?"}
                  {m.caption ? ` · ${m.caption}` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FloorPlansPage() {
  const [changes, setChanges] = useState<PendingChange[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [siteFilter, setSiteFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    priceDisplay: "",
    beds: "",
    baths: "",
    sqft: "",
    garages: "",
    homeType: "",
    virtualTourUrl: "",
    description: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editGallery, setEditGallery] = useState<string[]>([]);
  const [editBlueprints, setEditBlueprints] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const [tasks, setTasks] = useState<FollowUpTask[]>([]);

  const fetchTasks = useCallback(() => {
    fetch("/api/internal/floorplans/tasks")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTasks(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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
  // One row per plan: the queue holds one row per changed field.
  const groups = useMemo(
    () => groupChanges(changes.filter((c) => siteFilter === "all" || c.fp_sites?.domain === siteFilter)),
    [changes, siteFilter]
  );
  const pendingGroups = useMemo(() => groups.filter((g) => pendingIds(g).length > 0), [groups]);

  /** Approves or rejects every pending row of a plan; reports a failed write instead of hiding it in the Failed filter. */
  async function act(group: Group, action: "approve" | "reject", quiet = false): Promise<boolean> {
    const ids = pendingIds(group);
    if (!ids.length) return true;
    const starred = group.lead.fp_floor_plans?.starred;
    if (
      !quiet &&
      action === "approve" &&
      starred &&
      (group.kind === "remove" || group.kind === "update") &&
      !confirm(`⭐ This plan is used in a brand email. Approving this ${group.kind} will create a follow-up task to update the email. Continue?`)
    ) {
      return false;
    }
    setBusy((b) => new Set(b).add(group.key));
    try {
      const res = await fetch("/api/internal/floorplans/changes/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.results?.find((r: { error?: string | null }) => r.error)?.error ?? data?.error ?? `HTTP ${res.status}`;
        if (!quiet) alert(`${action === "approve" ? "Approve" : "Reject"} failed for ${group.lead.proposed_record?.name ?? group.lead.plan_key}: ${detail}`);
        return false;
      }
      return true;
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(group.key);
        return next;
      });
      if (!quiet) fetchChanges();
    }
  }

  function openEdit(group: Group) {
    const rec = group.lead.proposed_record ?? {};
    setEditForm({
      name: rec.name ?? "",
      priceDisplay: rec.priceDisplay ?? "",
      beds: rec.beds ?? "",
      baths: rec.baths ?? "",
      sqft: rec.sqft != null ? rec.sqft.toLocaleString("en-US") : "",
      garages: rec.garages ?? "",
      homeType: rec.homeType ?? "",
      virtualTourUrl: rec.virtualTourUrl ?? "",
      description: rec.description ?? "",
    });
    const gallery = rec.galleryImages?.length
      ? rec.galleryImages
      : rec.primaryImage
        ? [rec.primaryImage]
        : [];
    setEditGallery(gallery);
    setEditBlueprints(rec.blueprintImages ?? []);
    setPreview(null);
    setEditing(group);
  }

  /** Saves the edits onto every pending row of the plan, so whichever row is approved carries them. */
  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const record = { ...editForm, galleryImages: editGallery, blueprintImages: editBlueprints };
      await Promise.all(
        pendingIds(editing).map((id) =>
          fetch(`/api/internal/floorplans/changes/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ record }),
          })
        )
      );
    } finally {
      setSavingEdit(false);
      setEditing(null);
      setPreview(null);
      fetchChanges();
    }
  }

  async function bulkApprove() {
    if (!confirm(`Approve all ${pendingGroups.length} visible plans? Approved new plans are written to Wix as drafts.`)) return;
    setBulkBusy(true);
    const failed: string[] = [];
    try {
      for (const g of pendingGroups) {
        if (!(await act(g, "approve", true))) failed.push(g.lead.proposed_record?.name ?? g.lead.plan_key);
      }
    } finally {
      setBulkBusy(false);
      fetchChanges();
      if (failed.length) alert(`${failed.length} plan(s) could not be written to Wix: ${failed.join(", ")}. See the Failed filter for details.`);
    }
  }

  const detailLine = (rec: ProposedRecord | null) =>
    `${rec?.priceDisplay ?? "—"}${rec?.beds ? ` · ${rec.beds} bd` : ""}${rec?.baths ? ` · ${rec.baths} ba` : ""}${rec?.sqft ? ` · ${rec.sqft.toLocaleString("en-US")} sqft` : ""}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Floor Plan Changes</h2>
          <p className="text-muted">
            Detected changes from builder websites, one row per plan. Approved new plans are written to the
            Floor Plans V2 collection as drafts — publish them in the Wix CMS to make them live.
            {" "}<a href="/dashboard/floor-plans/cutover">Cutover report →</a>
          </p>
        </div>
        {statusFilter === "pending" && pendingGroups.length > 0 && (
          <button className="btn btn-primary" onClick={bulkApprove} disabled={bulkBusy}>
            {bulkBusy ? "Approving…" : `Approve All (${pendingGroups.length})`}
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

      {tasks.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid #f59e0b" }}>
          <strong>⭐ Brand email follow-ups</strong>
          {tasks.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span className="text-sm" style={{ flex: 1 }}>
                {t.detail ?? t.task_type}
                <span className="text-muted"> · {t.fp_floor_plans?.fp_sites?.domain}</span>
              </span>
              <button
                className="btn btn-secondary"
                style={{ padding: "2px 10px" }}
                onClick={async () => {
                  await fetch(`/api/internal/floorplans/tasks/${t.id}/done`, { method: "POST" });
                  fetchTasks();
                }}
              >
                Done
              </button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : groups.length === 0 ? (
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
                {groups.map((g) => {
                  const c = g.lead;
                  const rec = c.proposed_record;
                  // The main image is the gallery's first photo; primaryImage is the first slice's field.
                  const thumb = rec?.galleryImages?.[0] ?? rec?.primaryImage ?? null;
                  const photoCount = rec?.galleryImages?.length ?? 0;
                  const isPending = pendingIds(g).length > 0;
                  const fieldRows = g.rows.filter((r) => r.change_type === "update" && r.field_changed);
                  const failedRow = g.rows.find((r) => r.status === "failed" && r.error_detail);
                  return (
                    <tr key={g.key}>
                      <td style={{ width: 92 }}>
                        {thumb ? (
                          <button
                            type="button"
                            title={isPending ? "Edit this plan before approving" : `${photoCount} photos`}
                            onClick={() => (isPending ? openEdit(g) : window.open(thumb, "_blank", "noopener"))}
                            onMouseEnter={() => setPreview({ src: thumb, caption: rec?.galleryMeta?.[thumb]?.caption })}
                            onMouseLeave={() => setPreview(null)}
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={thumb}
                              alt={rec?.name ?? c.plan_key}
                              style={{ width: 84, height: 56, objectFit: "cover", borderRadius: 6, display: "block" }}
                            />
                            {photoCount > 1 && <div className="text-muted" style={{ fontSize: 10 }}>{photoCount} photos</div>}
                          </button>
                        ) : (
                          <span className="text-muted text-sm">no image</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${g.kind === "remove" ? "badge-danger" : g.kind === "add" ? "badge-success" : "badge-warning"}`}>
                          {CHANGE_LABEL[g.kind]}
                        </span>
                        {g.kind === "update" && fieldRows.length > 0 && (
                          <div className="text-muted text-sm">{fieldRows.length} field{fieldRows.length === 1 ? "" : "s"}</div>
                        )}
                        {g.status !== "pending" && (
                          <div className="text-muted text-sm">{g.status}</div>
                        )}
                      </td>
                      <td>
                        <strong>{rec?.name ?? c.plan_key}</strong>
                        {c.fp_floor_plans && (
                          <button
                            title={c.fp_floor_plans.starred ? "Used in brand email — click to unstar" : "Star: mark as used in a brand email"}
                            onClick={async () => {
                              await fetch(`/api/internal/floorplans/plans/${c.fp_floor_plans!.id}/star`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ starred: !c.fp_floor_plans!.starred }),
                              });
                              fetchChanges();
                            }}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, marginLeft: 4, opacity: c.fp_floor_plans.starred ? 1 : 0.35 }}
                          >
                            ⭐
                          </button>
                        )}
                        {(rec?.userEditedFields?.length ?? 0) > 0 && (
                          <div className="text-muted text-sm">✎ edited: {rec?.userEditedFields?.join(", ")}</div>
                        )}
                        {rec?.quickMoveIn && <div className="text-muted text-sm">Quick Move-In</div>}
                        {rec?.virtualTourUrl && (
                          <div>
                            <a href={rec.virtualTourUrl} target="_blank" rel="noreferrer" className="text-sm">
                              3D tour ↗
                            </a>
                          </div>
                        )}
                        {rec?.sourceUrl && (
                          <div>
                            <a href={rec.sourceUrl} target="_blank" rel="noreferrer" className="text-sm">
                              builder page ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td>
                        {g.kind === "update" && fieldRows.length > 0 ? (
                          <div className="text-sm">
                            {fieldRows.map((r) => (
                              <div key={r.id}>
                                {r.field_changed}: <s className="text-muted">{formatValue(r.field_changed, r.old_value)}</s> → <strong>{formatValue(r.field_changed, r.new_value)}</strong>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span>{detailLine(rec)}</span>
                        )}
                        {failedRow && (
                          <div className="text-muted text-sm">⚠ {failedRow.error_detail}</div>
                        )}
                      </td>
                      <td className="text-sm">
                        {c.fp_sites?.domain}
                        <div className="text-muted">
                          {c.fp_communities?.name} · {c.fp_builders?.name}
                        </div>
                      </td>
                      <td className="text-muted text-sm">
                        {new Date(g.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        {isPending && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn btn-primary"
                              disabled={busy.has(g.key)}
                              onClick={() => act(g, "approve")}
                            >
                              {busy.has(g.key) ? "…" : "Approve"}
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busy.has(g.key)}
                              onClick={() => openEdit(g)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busy.has(g.key)}
                              onClick={() => act(g, "reject")}
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
        <div className="modal-overlay" onClick={() => { setEditing(null); setPreview(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit before approving</h3>
            <p className="text-muted text-sm">
              Edited fields are marked as manual overrides — future scrapes will not
              propose reverting them to the builder&apos;s values. Save here, then approve from the list.
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
                ["virtualTourUrl", "Virtual tour link"],
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
            <div className="form-group">
              <label>Description</label>
              <textarea
                className="form-input"
                rows={4}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <GalleryEditor
              label="Photo gallery (first image is the main image; blueprints follow the photos on the site)"
              list={editGallery}
              setList={setEditGallery}
              meta={editing.lead.proposed_record?.galleryMeta}
              isPhotos
              onPreview={setPreview}
            />
            <GalleryEditor
              label="Blueprints"
              list={editBlueprints}
              setList={setEditBlueprints}
              isPhotos={false}
              onPreview={setPreview}
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setEditing(null); setPreview(null); }} disabled={savingEdit}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div
          style={{
            position: "fixed", right: 24, top: 80, zIndex: 3000, pointerEvents: "none",
            background: "var(--bg-card, #16161a)", padding: 8, borderRadius: 10,
            boxShadow: "0 10px 40px rgba(0,0,0,0.55)", maxWidth: 560,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.src} alt="" style={{ maxWidth: 540, maxHeight: 420, display: "block", borderRadius: 6, objectFit: "contain" }} />
          {preview.caption && <div className="text-sm" style={{ marginTop: 6 }}>{preview.caption}</div>}
        </div>
      )}
    </div>
  );
}
