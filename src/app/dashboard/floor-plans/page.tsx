"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { groupChanges, type ChangeGroup } from "@/lib/floorplans/group-changes";
import { approvalBlocker } from "@/lib/floorplans/approval";
import { troubledConnections, type TroubledConnection } from "@/lib/floorplans/health";
import { HOME_TYPES } from "@/lib/floorplans/standardize";
import { siteColors } from "@/app/dashboard/listings/format";
import FloorPlanTabs from "./tabs";

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
  /** The builder's own picture sets, kept beside the edited ones so a picture removed by mistake can be brought back. */
  scrapedGalleryImages?: string[];
  scrapedBlueprintImages?: string[];
  galleryMeta?: Record<string, GalleryMeta>;
  description?: string | null;
  virtualTourUrl?: string | null;
  /** Quick move-ins: the base plan; base plans: whether any quick move-in of theirs is on offer. */
  relatedPlanName?: string | null;
  relatedPlanMatch?: "extractor" | "plan-id" | "plan-name" | "plan-page" | "plan-facts" | "unmatched";
  hasQuickMoveIns?: boolean;
  /** A plan built from the quick move-ins named here, because the builder no longer lists it (stand-ins.ts). */
  standInFor?: string[] | null;
  /** The quick move-in whose price this plan carries, the builder having given it none. */
  priceFromHome?: string | null;
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

const idsAt = (g: Group, status: string) => g.rows.filter((r) => r.status === status).map((r) => r.id);
const pendingIds = (g: Group) => idsAt(g, "pending");
const isQuickMoveIn = (g: Group) => g.lead.proposed_record?.quickMoveIn === true;

/** 1 to 10 as the freelancers used it; 11 for a plan that must come first on the site (Jeff, 2026-09-21). */
const SCORES = Array.from({ length: 11 }, (_, i) => i + 1);
/** The bulk route takes this many rows per request. */
const MAX_IDS_PER_REQUEST = 200;

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
  const [builderFilter, setBuilderFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<"all" | "plans" | "qmi">("all");
  const [troubled, setTroubled] = useState<TroubledConnection[]>([]);
  const coarse = useCoarsePointer();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Seconds the run is waiting out a Wix throttle, so the buttons say so instead of looking stuck. */
  const [throttleWait, setThrottleWait] = useState(0);
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
  const [restoring, setRestoring] = useState(false);
  const [sorting, setSorting] = useState(false);
  /** What the last sort managed to place, so the overlay can say so. */
  const [sorted, setSorted] = useState<{ placed: number; of: number } | null>(null);
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

  /** Hides the named connections from the banner until a newer run of theirs fails (Jeff, 2026-09-21). */
  async function dismissAttention(ids: string[]) {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/internal/floorplans/connections/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dismissAttention: true }),
        })
      )
    );
    fetchHealth();
  }

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
  // The builders with something in the queue, so a run of one builder can
  // be worked through on its own (Jeff, 2026-09-21).
  const builders = useMemo(
    () => [...new Set(changes.map((c) => c.fp_builders?.name).filter(Boolean))].sort() as string[],
    [changes]
  );
  // One row per plan: the queue holds one row per changed field.
  const siteGroups = useMemo(
    () =>
      groupChanges(
        changes.filter(
          (c) =>
            (siteFilter === "all" || c.fp_sites?.domain === siteFilter) &&
            (builderFilter === "all" || c.fp_builders?.name === builderFilter)
        )
      ),
    [changes, siteFilter, builderFilter]
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
  // Plans the server is writing right now; each leaves the list as its write finishes.
  const approvingCount = useMemo(() => siteGroups.filter((g) => g.status === "approving").length, [siteGroups]);
  // Wix refuses a client that asks too often, and a full run asks far
  // more than it allows, so the run waits it out rather than dropping
  // plans (Jeff, 2026-09-22). The button says which it is doing.
  const busyLabel = throttleWait ? `Wix is busy; waiting ${throttleWait}s…` : "Approving…";
  const approvingInView = useMemo(() => changes.some((c) => c.status === "approving"), [changes]);
  // The writes run on the server (Jeff, 2026-09-21), so the queue is
  // re-read while any row is being written: after Approve All here, and
  // again when the page is opened while a write started elsewhere still runs.
  useEffect(() => {
    if (!approvingInView || bulkBusy) return;
    const timer = setInterval(fetchChanges, 5000);
    return () => clearInterval(timer);
  }, [approvingInView, bulkBusy, fetchChanges]);

  /**
   * Approves or rejects every pending row of a plan, or puts a rejected
   * plan back in the queue; reports a failed write instead of hiding it in
   * the Failed filter.
   */
  async function act(group: Group, action: "approve" | "reject" | "restore", quiet = false): Promise<boolean> {
    const ids = action === "restore" ? idsAt(group, "rejected") : pendingIds(group);
    if (!ids.length) return true;
    const starred = group.lead.fp_floor_plans?.starred;
    if (
      !quiet &&
      action === "approve" &&
      starred &&
      (group.kind === "remove" || group.kind === "update") &&
      !confirm(`⭐ This plan is in the email drip campaign. Approving this ${group.kind} raises a campaign alert and texts the frontlines agent to update the marketing. Continue?`)
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
        const what = action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Restore";
        if (!quiet) alert(`${what} failed for ${group.lead.proposed_record?.name ?? group.lead.plan_key}: ${detail}`);
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
    setSorted(null);
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
   * Brings back every picture the builder gave (Jeff, 2026-09-21: "in case
   * the user accidentally removes an image"): the queue's PATCH route puts
   * the builder's sets back on every pending row of the plan and drops the
   * gallery override marks, and the overlay shows them at once.
   */
  async function restorePictures() {
    if (!editing) return;
    setRestoring(true);
    try {
      let restored: ProposedRecord | null = null;
      for (const id of pendingIds(editing)) {
        const res = await fetch(`/api/internal/floorplans/changes/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ record: { restorePictures: true } }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(`Could not restore the pictures: ${data?.error ?? `HTTP ${res.status}`}`);
          return;
        }
        if (!restored) restored = (data?.proposed_record as ProposedRecord | null) ?? null;
      }
      if (restored) {
        setEditGallery(restored.galleryImages?.length ? restored.galleryImages : restored.primaryImage ? [restored.primaryImage] : []);
        setEditBlueprints(restored.blueprintImages ?? []);
      }
    } finally {
      setRestoring(false);
      fetchChanges();
    }
  }

  /**
   * Puts the photos in the order the sites show them, from what the
   * pictures themselves show: the front of the house leads, the rooms
   * follow, the other outside views go last. Plenty of builders name a
   * picture nothing a room can be read from — "4638-8-scaled-1.webp", a
   * media store's UUID — and those galleries arrived in page order for a
   * person to arrange (Jeff, 2026-09-22). The new order lands in the
   * overlay for a look; it is saved with the rest on Save.
   */
  async function sortPhotos() {
    if (!editing) return;
    setSorting(true);
    setSorted(null);
    try {
      const res = await fetch(`/api/internal/floorplans/changes/${editing.lead.id}/sort-photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryImages: editGallery }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data?.galleryImages)) {
        alert(`Could not sort the photos: ${data?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setEditGallery(data.galleryImages as string[]);
      setSorted({ placed: typeof data.placed === "number" ? data.placed : 0, of: editGallery.length });
    } finally {
      setSorting(false);
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

  /**
   * Approves a set of plans: every visible plan, or every quick move-in.
   * One request carries them all (whole plans per request, up to the bulk
   * route's cap); the server locks their rows as "approving" and writes the
   * plans one after another whether or not this page stays open (Jeff,
   * 2026-09-21), and the list is re-read as it runs so each plan leaves as
   * it is written. What did not fit in the server's time budget comes back
   * as `remaining` and is sent again from here.
   */
  async function approveGroups(list: Group[], what: string) {
    if (!confirm(`Approve ${list.length} ${what}? Approved plans are written to Wix as published items.`)) return;
    const names = new Map<string, string>();
    const blocked = new Set<string>();
    const slices: string[][] = [];
    for (const g of list) {
      const name = g.lead.proposed_record?.name ?? g.lead.plan_key;
      names.set(g.lead.plan_key, name);
      if (approvalBlocker(g.kind, g.lead.proposed_record)) blocked.add(name);
      else if (pendingIds(g).length) slices.push(pendingIds(g));
    }
    setBulkBusy(true);
    const poll = setInterval(fetchChanges, 3000);
    const failed = new Set<string>();
    let requestError: string | null = null;
    try {
      while (slices.length) {
        // Whole plans per request, so no plan's rows are split across two.
        const ids: string[] = [];
        while (slices.length && ids.length + slices[0].length <= MAX_IDS_PER_REQUEST) ids.push(...slices.shift()!);
        if (!ids.length) ids.push(...slices.shift()!);
        const res = await fetch("/api/internal/floorplans/changes/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve", ids }),
        });
        const data = await res.json().catch(() => ({}));
        if (!Array.isArray(data?.results)) {
          requestError = data?.error ?? `HTTP ${res.status}`;
          break;
        }
        for (const r of data.results as { planKey: string; status: string; error: string | null }[]) {
          if (r.status === "failed") failed.add(names.get(r.planKey) ?? r.planKey);
          else if (r.status === "blocked") blocked.add(names.get(r.planKey) ?? r.planKey);
        }
        const remaining = (Array.isArray(data.remaining) ? data.remaining : []).filter((x: unknown): x is string => typeof x === "string");
        // Wix throttles this app at a few hundred calls a minute and a
        // full run imports far more, so the server stops and says how long
        // to leave it rather than dropping plans (Jeff, 2026-09-22). That
        // is progress, not a stall.
        const retryAfterMs = typeof data.retryAfterMs === "number" ? Math.min(data.retryAfterMs, 120_000) : 0;
        if (!retryAfterMs && remaining.length >= ids.length) {
          requestError = "the server made no progress";
          break;
        }
        if (remaining.length) slices.unshift(remaining);
        if (retryAfterMs) {
          setThrottleWait(Math.ceil(retryAfterMs / 1000));
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          setThrottleWait(0);
        }
      }
    } catch (e) {
      requestError = e instanceof Error ? e.message : String(e);
    } finally {
      clearInterval(poll);
      setThrottleWait(0);
      setBulkBusy(false);
      fetchChanges();
      const notes: string[] = [];
      if (blocked.size) notes.push(`${blocked.size} plan(s) still need something (a score, price, bedrooms, bathrooms, square feet, garages, home type, or a floor plan for a quick move-in) and were left pending: ${[...blocked].join(", ")}.`);
      if (failed.size) notes.push(`${failed.size} plan(s) could not be written to Wix: ${[...failed].join(", ")}. See the Failed filter for details.`);
      if (requestError) notes.push(`The approval request failed (${requestError}). Plans the server had started are still being written and leave the list as they finish; whatever is still pending can be approved again.`);
      if (notes.length) alert(notes.join("\n"));
    }
  }

  // Whether the plan in the overlay has builder pictures to bring back.
  const editRec = editing?.lead.proposed_record ?? null;
  const restorable =
    (editRec?.scrapedGalleryImages ?? editRec?.galleryImages ?? []).length +
      (editRec?.scrapedBlueprintImages ?? editRec?.blueprintImages ?? []).length >
    0;

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
          </p>
        </div>
        {statusFilter === "pending" && (approvingCount > 0 || pendingGroups.length > 0 || pendingQuickMoveIns.length > 0) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {approvingCount > 0 && (
              <span
                className="text-sm"
                style={{ color: "var(--warning, #b45309)" }}
                title="The writes run on the server; leaving this page does not stop them. Each plan leaves the list as its write finishes."
              >
                Writing {approvingCount} plan{approvingCount === 1 ? "" : "s"} to Wix…
              </span>
            )}
            {pendingQuickMoveIns.length > 0 && (
              <button
                className="btn btn-secondary"
                onClick={() => approveGroups(pendingQuickMoveIns, "quick move-ins")}
                disabled={bulkBusy}
                title="Every pending quick move-in the site and builder filters allow, whatever the view shows"
              >
                {bulkBusy ? busyLabel : `Approve all Quick Move-Ins (${pendingQuickMoveIns.length})`}
              </button>
            )}
            {pendingGroups.length > 0 && (
              <button className="btn btn-primary" onClick={() => approveGroups(pendingGroups, "visible plans")} disabled={bulkBusy}>
                {bulkBusy ? busyLabel : `Approve All (${pendingGroups.length})`}
              </button>
            )}
          </div>
        )}
      </div>
      <FloorPlanTabs />

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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
          Builder{" "}
          <select
            value={builderFilter}
            onChange={(e) => setBuilderFilter(e.target.value)}
            className="form-input"
            style={{ width: "auto", display: "inline-block" }}
          >
            <option value="all">All builders</option>
            {builders.map((b) => (
              <option key={b} value={b}>{b}</option>
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ flex: 1 }}>⚠ Builder sites needing attention</strong>
            {troubled.length > 1 && (
              <button
                className="btn btn-secondary"
                style={{ padding: "2px 10px" }}
                onClick={() => dismissAttention(troubled.map((t) => t.id))}
                title="Hides all of these until a newer run of theirs fails"
              >
                Dismiss all
              </button>
            )}
          </div>
          <p className="text-muted text-sm" style={{ margin: "4px 0 0" }}>
            These connections failed their last run: an error, no plans at all, or far fewer plans than last time.
            Nothing is removed from a site on such a run. Open the builder&apos;s page to see what changed, then Run again
            from Builder Connections; a fixed page clears this on its next good run. Dismiss hides one until a newer run of it fails.
          </p>
          {troubled.map((t) => (
            <div key={t.id} className="text-sm" style={{ marginTop: 8, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <strong>{t.builder} · {t.community}</strong>
                <span className="text-muted">
                  {" "}· {t.domain} · {t.failures} run{t.failures === 1 ? "" : "s"} in a row
                  {t.lastRunAt ? ` · ${new Date(t.lastRunAt).toLocaleString()}` : ""}
                </span>
                <div className="text-muted">{t.status}</div>
              </div>
              <button
                className="btn btn-secondary"
                style={{ padding: "2px 10px" }}
                onClick={() => dismissAttention([t.id])}
                title="Hides this until a newer run of it fails"
              >
                Dismiss
              </button>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <a href="/dashboard/floor-plans/connections" className="text-sm">Builder Connections →</a>
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid #f59e0b" }}>
          <strong>⚑ Email campaign alerts</strong>
          <span className="text-muted text-sm"> · tracked floor plans that changed on a site, listed under Email Campaign.</span>
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
                  // Each row wears its site's colour, as the Listings section does (Jeff, 2026-09-21).
                  const colors = siteColors(c.fp_sites?.domain);
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
                      style={{ ...(isPending ? { cursor: "pointer" } : {}), ...(colors ? { background: colors.tint } : {}) }}
                      title={isPending ? "Click to edit this plan before approving" : undefined}
                    >
                      <td style={{ width: 92, ...(colors ? { borderLeft: `3px solid ${colors.accent}` } : {}) }}>
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
                            {photoCount > 1 && !rec?.quickMoveIn && <div className="text-muted" style={{ fontSize: 10 }}>{photoCount} photos</div>}
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
                        {g.status === "approving" ? (
                          <div
                            className="text-sm"
                            style={{ color: "var(--warning, #b45309)" }}
                            title="Being written to Wix on the server; it leaves the list when done, wherever you go in the Hub."
                          >
                            Approving…
                          </div>
                        ) : g.status !== "pending" && (
                          <div className="text-muted text-sm">{g.status}</div>
                        )}
                      </td>
                      <td>
                        <strong>{rec?.name ?? c.plan_key}</strong>
                        {c.fp_floor_plans && (
                          <button
                            title={c.fp_floor_plans.starred ? "In the email drip campaign — click to stop tracking it" : "Track this plan in the email drip campaign"}
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
                          </div>
                        )}
                        {!rec?.quickMoveIn && rec?.hasQuickMoveIns && (
                          <div className="text-muted text-sm">Has quick move-ins</div>
                        )}
                        {rec?.priceFromHome && (
                          <div className="text-muted text-sm" title="The builder gives this plan no price; it carries its cheapest quick move-in's until one arrives.">
                            Price from {rec.priceFromHome}
                          </div>
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
                        {rec?.quickMoveIn && rec.relatedPlanMatch === "unmatched" && !blocker && (
                          <div
                            className="text-sm"
                            style={{ color: "var(--warning, #b45309)" }}
                            title="No base plan by this name in the run. Set it in the overlay, or create the plan from this home there."
                          >
                            ⚠ base plan not found
                          </div>
                        )}
                        {blocker && (
                          <div className="text-sm" style={{ color: "var(--warning, #b45309)" }}>⚠ {blocker}</div>
                        )}
                      </td>
                      <td className="text-sm">
                        <span style={colors ? { color: colors.solid } : undefined}>{c.fp_sites?.domain}</span>
                        <div className="text-muted">
                          {c.fp_communities?.name} · {c.fp_builders?.name}
                        </div>
                      </td>
                      <td className="text-muted text-sm">
                        {new Date(g.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        {/* A rejection sticks — the sync core will not queue
                            the same change again — so a reject clicked by
                            accident needs a way back (Jeff, 2026-09-22). */}
                        {g.status === "rejected" && (
                          <button
                            className="btn btn-secondary"
                            disabled={busy.has(g.key)}
                            title="Put this back in the queue. Rejecting it stopped the sync from ever raising it again; this lifts that too."
                            onClick={() => act(g, "restore")}
                          >
                            {busy.has(g.key) ? "…" : "Restore"}
                          </button>
                        )}
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
            {editing.lead.proposed_record?.quickMoveIn ? (
              // A quick move-in's row shows one picture (Jeff, 2026-09-20); the
              // rest of what the builder gave stays with the home, for a floor
              // plan created from it.
              <div className="form-group">
                <label>Primary image (the one picture a quick move-in shows)</label>
                {editGallery[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={editGallery[0]} alt="" style={{ maxWidth: 320, maxHeight: 220, borderRadius: 6, display: "block", objectFit: "cover" }} />
                ) : (
                  <span className="text-muted text-sm">no image</span>
                )}
                {editGallery.length + editBlueprints.length > 1 && (
                  <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                    {editGallery.length + editBlueprints.length - 1} more picture(s) stay with the home, for a floor plan created from it.
                  </div>
                )}
              </div>
            ) : (
              <>
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
                {editGallery.length > 1 && (
                  <div className="form-group">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={sorting || savingEdit || restoring}
                      onClick={sortPhotos}
                      title="Claude looks at each photo and puts them in the site's order: the front of the house first, then kitchen, living, dining, outdoor, and the other exterior shots last."
                    >
                      {sorting ? "Looking at the photos…" : "✨ Sort the photos"}
                    </button>
                    <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                      {sorted
                        ? sorted.placed === sorted.of
                          ? `Placed all ${sorted.of} photos. Drag any that are wrong, then Save.`
                          : `Placed ${sorted.placed} of ${sorted.of} photos; the rest kept their order. Drag any that are wrong, then Save.`
                        : "Claude looks at each picture and orders them the way the sites do. Nothing is saved until you press Save."}
                    </div>
                  </div>
                )}
                {restorable && (
                  <div className="form-group">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={restoring || savingEdit || sorting}
                      onClick={restorePictures}
                      title="Every photo and drawing the builder gave comes back, in the builder's order, saved at once."
                    >
                      {restoring ? "Restoring…" : "↻ Restore the builder's pictures"}
                    </button>
                    <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                      For a picture removed by mistake: brings back everything the builder gave, saved at once.
                    </div>
                  </div>
                )}
                {/* Last, under the pictures: the score is a judgement on what
                    the plan looks like, so it is asked for after the gallery
                    and the drawings rather than before them (Jeff, 2026-09-22). */}
                <div className="form-group">
                  <label>Score (required before approval; the sites list high scores first: 1 to 10 as the freelancers used it, 11 for a plan that must come first)</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {SCORES.map((n) => {
                      const chosen = editForm.score === String(n);
                      return (
                        <button
                          key={n}
                          type="button"
                          className={`btn ${chosen ? "btn-primary" : "btn-secondary"}`}
                          style={{ minWidth: 40, padding: "4px 0", textAlign: "center", justifyContent: "center" }}
                          aria-pressed={chosen}
                          title={n === 11 ? "Puts this plan first on the site" : `Score ${n}`}
                          onClick={() => setEditForm((f) => ({ ...f, score: chosen ? "" : String(n) }))}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                    {editForm.score ? `Score ${editForm.score}. Click it again to clear it.` : "No score yet."}
                  </div>
                </div>
              </>
            )}
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
