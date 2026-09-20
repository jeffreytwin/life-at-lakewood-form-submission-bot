"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { groupChanges, type ChangeGroup } from "@/lib/floorplans/group-changes";
import { approvalBlocker } from "@/lib/floorplans/approval";
import { troubledConnections, type TroubledConnection } from "@/lib/floorplans/health";
import { HOME_TYPES } from "@/lib/floorplans/standardize";

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
  /** Quick move-ins: the base plan; base plans: whether any quick move-in of theirs is on offer. */
  relatedPlanName?: string | null;
  relatedPlanMatch?: "extractor" | "plan-id" | "plan-name" | "unmatched";
  hasQuickMoveIns?: boolean;
  /** A plan built from the quick move-ins named here, because the builder no longer lists it (stand-ins.ts). */
  standInFor?: string[] | null;
  /** Set here in the Hub; the sites list high scores first. Required before a base plan is approved. */
  score?: number | null;
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
const isQuickMoveIn = (g: Group) => g.lead.proposed_record?.quickMoveIn === true;

/**
 * Phones and tablets: there is no hover, and a press-and-hold starts a
 * drag, so the hover preview and drag-and-drop are switched off there
 * (Jeff, 2026-09-19); the arrows do the reordering.
 */
const COARSE_POINTER = "(hover: none), (pointer: coarse)";
function subscribeToPointer(onChange: () => void) {
  const mq = window.matchMedia(COARSE_POINTER);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false
  );
}

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
  const coarse = useCoarsePointer();
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
        {coarse ? "Use the arrows to move a picture." : "Drag a picture to where it belongs, or use the arrows. Hover to see it large."}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {list.map((url, i) => {
          const m = meta?.[url];
          return (
            <div
              key={url}
              draggable={!coarse}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== i) setList(reorder(list, dragIndex, i));
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              onMouseEnter={() => {
                if (!coarse) onPreview({ src: url, caption: m?.caption });
              }}
              onMouseLeave={() => onPreview(null)}
              style={{ position: "relative", textAlign: "center", cursor: coarse ? "default" : "grab", opacity: dragIndex === i ? 0.4 : 1 }}
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
  const [kindFilter, setKindFilter] = useState<"all" | "plans" | "qmi">("all");
  const [troubled, setTroubled] = useState<TroubledConnection[]>([]);
  const coarse = useCoarsePointer();
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
    relatedPlanName: "",
    score: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
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

  // Builder connections whose last run failed, for the banner.
  const fetchHealth = useCallback(() => {
    fetch("/api/internal/floorplans/builders")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTroubled(troubledConnections(data));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

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
  const siteGroups = useMemo(
    () => groupChanges(changes.filter((c) => siteFilter === "all" || c.fp_sites?.domain === siteFilter)),
    [changes, siteFilter]
  );
  // Floor plans only, quick move-ins only, or both (Jeff, 2026-09-19).
  const groups = useMemo(
    () => siteGroups.filter((g) => (kindFilter === "all" ? true : kindFilter === "qmi" ? isQuickMoveIn(g) : !isQuickMoveIn(g))),
    [siteGroups, kindFilter]
  );
  const pendingGroups = useMemo(() => groups.filter((g) => pendingIds(g).length > 0), [groups]);
  const pendingQuickMoveIns = useMemo(
    () => siteGroups.filter((g) => pendingIds(g).length > 0 && isQuickMoveIn(g)),
    [siteGroups]
  );

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
      relatedPlanName: rec.relatedPlanName ?? "",
      score: rec.score == null ? "" : String(rec.score),
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

  /** Writes the form onto every pending row of the plan, so whichever row is approved carries the edits. */
  async function persistEdits(group: Group) {
    const record = { ...editForm, galleryImages: editGallery, blueprintImages: editBlueprints };
    await Promise.all(
      pendingIds(group).map((id) =>
        fetch(`/api/internal/floorplans/changes/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ record }),
        })
      )
    );
  }

  /** Saves the edits and closes the overlay. */
  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await persistEdits(editing);
    } finally {
      setSavingEdit(false);
      setEditing(null);
      setPreview(null);
      fetchChanges();
    }
  }

  /**
   * Creates the floor plan this quick move-in is built from, when the
   * builder no longer lists it (Jeff, 2026-09-20): the edits are saved
   * first so the plan takes the name typed here, then the plan is built from
   * the home's page and queued as a new plan needing a score.
   */
  async function createStandIn() {
    if (!editing) return;
    const planName = editForm.relatedPlanName.trim();
    if (!planName) return;
    setCreatingPlan(true);
    try {
      await persistEdits(editing);
      const res = await fetch(`/api/internal/floorplans/changes/${editing.lead.id}/stand-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Could not create the floor plan: ${data?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      alert(
        `Floor plan "${data.name}" is in the queue as a new plan (${data.photos} photos, ${data.drawings} drawings, built from ${(data.homes ?? []).join(", ")}). Give it a score, then approve it.`
      );
      setEditing(null);
      setPreview(null);
    } finally {
      setCreatingPlan(false);
      fetchChanges();
    }
  }

  /** Approves a set of plans one after another: every visible plan, or every quick move-in. */
  async function approveGroups(list: Group[], what: string) {
    if (!confirm(`Approve ${list.length} ${what}? Approved plans are written to Wix as published items.`)) return;
    setBulkBusy(true);
    const failed: string[] = [];
    const blocked: string[] = [];
    try {
      for (const g of list) {
        const name = g.lead.proposed_record?.name ?? g.lead.plan_key;
        if (approvalBlocker(g.kind, g.lead.proposed_record)) {
          blocked.push(name);
          continue;
        }
        if (!(await act(g, "approve", true))) failed.push(name);
      }
    } finally {
      setBulkBusy(false);
      fetchChanges();
      const notes: string[] = [];
      if (blocked.length) notes.push(`${blocked.length} plan(s) still need something (a score, price, bedrooms, bathrooms, square feet, garages or home type) and were left pending: ${blocked.join(", ")}.`);
      if (failed.length) notes.push(`${failed.length} plan(s) could not be written to Wix: ${failed.join(", ")}. See the Failed filter for details.`);
      if (notes.length) alert(notes.join("\n"));
    }
  }

  const detailLine = (rec: ProposedRecord | null) =>
    `${rec?.priceDisplay ?? "—"}${rec?.beds ? ` · ${rec.beds} bd` : ""}${rec?.baths ? ` · ${rec.baths} ba` : ""}${rec?.sqft ? ` · ${rec.sqft.toLocaleString("en-US")} sqft` : ""}${typeof rec?.score === "number" ? ` · score ${rec.score}` : ""}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Floor Plan Changes</h2>
          <p className="text-muted">
            Detected changes from builder websites, one row per plan. Approved plans are written to the
            Floor Plans V2 collection as published items.
            {" "}<a href="/dashboard/floor-plans/cutover">Cutover report →</a>
          </p>
        </div>
        {statusFilter === "pending" && (pendingGroups.length > 0 || pendingQuickMoveIns.length > 0) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pendingQuickMoveIns.length > 0 && (
              <button
                className="btn btn-secondary"
                onClick={() => approveGroups(pendingQuickMoveIns, "quick move-ins")}
                disabled={bulkBusy}
                title="Every pending quick move-in on the selected site(s), whatever the view shows"
              >
                {bulkBusy ? "Approving…" : `Approve all Quick Move-Ins (${pendingQuickMoveIns.length})`}
              </button>
            )}
            {pendingGroups.length > 0 && (
              <button className="btn btn-primary" onClick={() => approveGroups(pendingGroups, "visible plans")} disabled={bulkBusy}>
                {bulkBusy ? "Approving…" : `Approve All (${pendingGroups.length})`}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <label>
          Status{" "}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="pending">Pending</option>
            <option value="synced_draft">Synced (older drafts in Wix)</option>
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
        <label>
          Show{" "}
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as "all" | "plans" | "qmi")}
            className="form-input"
            style={{ width: "auto", display: "inline-block" }}
          >
            <option value="all">Floor plans and quick move-ins</option>
            <option value="plans">Floor plans only</option>
            <option value="qmi">Quick move-ins only</option>
          </select>
        </label>
      </div>

      {troubled.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid #ef4444" }}>
          <strong>⚠ Builder sites needing attention</strong>
          <p className="text-muted text-sm" style={{ margin: "4px 0 0" }}>
            These connections failed their last run: an error, no plans at all, or far fewer plans than last time.
            Nothing is removed from a site on such a run. Open the builder&apos;s page to see what changed, then Run again
            from Builder Connections; a fixed page clears this on its next good run.
          </p>
          {troubled.map((t) => (
            <div key={t.id} className="text-sm" style={{ marginTop: 8 }}>
              <strong>{t.builder} · {t.community}</strong>
              <span className="text-muted">
                {" "}· {t.domain} · {t.failures} run{t.failures === 1 ? "" : "s"} in a row
                {t.lastRunAt ? ` · ${new Date(t.lastRunAt).toLocaleString()}` : ""}
              </span>
              <div className="text-muted">{t.status}</div>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <a href="/dashboard/settings/builders" className="text-sm">Builder Connections →</a>
          </div>
        </div>
      )}

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
                  // A base plan waits for its score before Approve is offered (approval.ts).
                  const blocker = isPending ? approvalBlocker(g.kind, rec) : null;
                  return (
                    <tr
                      key={g.key}
                      onClick={(e) => {
                        // The whole row opens the overlay (Jeff, 2026-09-19); the
                        // 3D tour and builder page links and every button keep their own job.
                        if (!isPending) return;
                        if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
                        openEdit(g);
                      }}
                      style={isPending ? { cursor: "pointer" } : undefined}
                      title={isPending ? "Click to edit this plan before approving" : undefined}
                    >
                      <td style={{ width: 92 }}>
                        {thumb ? (
                          <button
                            type="button"
                            title={isPending ? "Edit this plan before approving" : `${photoCount} photos`}
                            onClick={() => (isPending ? openEdit(g) : window.open(thumb, "_blank", "noopener"))}
                            onMouseEnter={() => {
                              if (!coarse) setPreview({ src: thumb, caption: rec?.galleryMeta?.[thumb]?.caption });
                            }}
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
                        {rec?.quickMoveIn && (
                          <div className="text-muted text-sm">
                            Quick move-in{rec.relatedPlanName ? ` of ${rec.relatedPlanName}` : ""}
                            {rec.relatedPlanMatch === "unmatched" && (
                              <span
                                style={{ color: "var(--warning)" }}
                                title="No base plan by this name in the run. Set it in the overlay, or create the plan from this home there."
                              >
                                {" "}· ⚠ base plan not found
                              </span>
                            )}
                          </div>
                        )}
                        {!rec?.quickMoveIn && rec?.hasQuickMoveIns && (
                          <div className="text-muted text-sm">Has quick move-ins</div>
                        )}
                        {(rec?.standInFor?.length ?? 0) > 0 && (
                          <div className="text-muted text-sm" title="The builder no longer lists this plan; it is built from the home(s) named here and lasts as long as one is on offer.">
                            Created from {rec?.standInFor?.join(", ")}
                          </div>
                        )}
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
                        {blocker && (
                          <div className="text-sm" style={{ color: "var(--warning, #b45309)" }}>⚠ {blocker}</div>
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
                              disabled={busy.has(g.key) || Boolean(blocker)}
                              title={blocker ?? undefined}
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
                {field === "homeType" ? (
                  <select
                    className="form-input"
                    value={editForm.homeType}
                    onChange={(e) => setEditForm((f) => ({ ...f, homeType: e.target.value }))}
                  >
                    <option value="">(not set)</option>
                    {HOME_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="form-input"
                    value={editForm[field]}
                    onChange={(e) => setEditForm((f) => ({ ...f, [field]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            {!editing.lead.proposed_record?.quickMoveIn && (
              <div className="form-group">
                <label>Score (required before approval; the sites list high scores first; 1 to 10 as the freelancers used it)</label>
                <input
                  className="form-input"
                  type="number"
                  step={1}
                  value={editForm.score}
                  onChange={(e) => setEditForm((f) => ({ ...f, score: e.target.value }))}
                />
              </div>
            )}
            {editing.lead.proposed_record?.quickMoveIn && (
              <div className="form-group">
                <label>Base plan (the floor plan this quick move-in is built from; the site files it under that plan)</label>
                <input
                  className="form-input"
                  value={editForm.relatedPlanName}
                  onChange={(e) => setEditForm((f) => ({ ...f, relatedPlanName: e.target.value }))}
                />
                {editing.lead.proposed_record.relatedPlanMatch === "unmatched" && (
                  <div className="text-sm" style={{ marginTop: 8 }}>
                    <div style={{ color: "var(--warning)" }}>
                      ⚠ No floor plan by this name in the run, so the site has nowhere to show this home.
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: 6 }}
                      disabled={creatingPlan || savingEdit || !editForm.relatedPlanName.trim()}
                      onClick={createStandIn}
                      title="Builds the floor plan from this home's page: every photo, the drawings, the description, the price. It lands in the queue as a new plan needing a score, and stays as long as a home of it is on offer."
                    >
                      {creatingPlan
                        ? "Creating…"
                        : `Create floor plan "${editForm.relatedPlanName.trim() || "…"}" from this home`}
                    </button>
                    <div className="text-muted" style={{ marginTop: 4 }}>
                      Name the base plan above first if the builder gave none. The new plan needs a score before approval and leaves when the last home of it sells.
                    </div>
                  </div>
                )}
              </div>
            )}
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
