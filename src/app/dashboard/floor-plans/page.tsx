"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { groupChanges, groupKeyOf, type ChangeGroup } from "@/lib/floorplans/group-changes";
import { TOUR_REVIEW_LABEL } from "@/lib/floorplans/tour-review-label";
import { approvalBlocker } from "@/lib/floorplans/approval";
import { troubledConnections, type TroubledConnection } from "@/lib/floorplans/health";
import { HOME_TYPES, standardGarages } from "@/lib/floorplans/standardize";
import { siteColors } from "@/app/dashboard/listings/format";
import { FIRST_DIRECTION, priceOf, sortChanges, type ChangeSort, type ChangeSortKey } from "@/lib/floorplans/sort-changes";
import {
  addToTally,
  batchDelay,
  clearedIn,
  countWritten,
  easternDay,
  exitDuration,
  foldDuration,
  isWritten,
  progressOf,
  readTally,
  tallyLine,
  takeFromTally,
  withHeld,
  writeSettled,
  type CountedExit,
  type Exit,
  type Tally,
} from "@/lib/floorplans/leaving-rows";
import { emitLeadEvent } from "@/lib/lead-events";
import { FLOOR_PLAN_SOUNDS, playSound } from "@/lib/notification-sounds";
import { prefersReducedMotion } from "@/lib/pixel-effects";
import { playExit } from "./exit-effects";
import FloorPlanTabs from "./tabs";

interface GalleryMeta {
  caption?: string | null;
  room?: string | null;
  kind?: string;
}

interface ProposedRecord {
  name?: string;
  price?: number | null;
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
  /** Every photo looked at and the gallery put in order in the background (sort-queue.ts). */
  photosSorted?: boolean;
  /** Why the weekly tour review put this plan's tour to a person (tour-review.ts). */
  tourReview?: { reason?: string } | null;
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

/** What each sortable column orders a plan by (sort-changes.ts). */
const sortFacts = (g: Group) => ({
  kind: g.kind,
  quickMoveIn: isQuickMoveIn(g),
  name: g.lead.proposed_record?.name ?? g.lead.plan_key,
  price: priceOf(g.lead.proposed_record?.price, g.lead.proposed_record?.priceDisplay),
  site: g.lead.fp_sites?.domain ?? "",
  community: g.lead.fp_communities?.name ?? "",
  builder: g.lead.fp_builders?.name ?? "",
  detected: g.createdAt,
});

/** The sortable columns, in the table's order. */
const SORT_COLUMNS: { key: ChangeSortKey; label: string; hint: string }[] = [
  { key: "type", label: "Type", hint: "new plans, then updates, then removals" },
  { key: "plan", label: "Plan", hint: "by name" },
  { key: "details", label: "Details", hint: "by price" },
  { key: "where", label: "Site / Community / Builder", hint: "by site, then community, then builder" },
  { key: "detected", label: "Detected", hint: "by when it was found" },
];

/** The table's columns: the tick, the picture, the sortable ones and the buttons. */
const COLUMN_COUNT = SORT_COLUMNS.length + 3;

/** Plans shown on one page of the queue (Jeff, 2026-09-26: the whole queue at once was slow). */
const PAGE_SIZE = 50;

/** Where this browser keeps the day's tally of plans cleared from the queue. */
const TALLY_STORAGE_KEY = "floor-plans-cleared-today";
/** A batch throws pixels from its first few rows only, not a page of fifty. */
const MAX_BURSTS = 6;

/** A plan on its way out of the list (leaving-rows.ts). */
interface LeavingRow {
  exit: Exit;
  /** ms before it starts, for a batch going out as a wave. */
  delay: number;
  /** ms its own animation runs. */
  ms: number;
  /** ms it takes to fold away once played. */
  fold: number;
  /** Once it has played: the height it folds away from. */
  foldFrom: number | null;
}

/** Where this browser remembers the column the queue was last sorted by. */
const SORT_STORAGE_KEY = "floor-plans-changes-sort";

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

/** The mark of a picture a change adds to the live plan. */
const NEW_PICTURE = "#16a34a";
/** The mark of a live picture a change takes away. */
const REMOVED_PICTURE = "#dc2626";

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
  added,
  removed,
}: {
  label: string;
  list: string[];
  setList: (v: string[]) => void;
  meta?: Record<string, GalleryMeta>;
  isPhotos: boolean;
  onPreview: (p: Preview | null) => void;
  /** Pictures the change adds to the live plan, marked so a reviewer sees what changed (Jeff, 2026-09-28). */
  added?: Set<string>;
  /** The live plan's pictures the change takes away, shown after the list in red with a way to keep them (Jeff, 2026-09-29). */
  removed?: string[];
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const coarse = useCoarsePointer();
  const gone = (removed ?? []).filter((url) => !list.includes(url));
  if (list.length === 0 && gone.length === 0) return null;
  const newCount = added ? list.filter((url) => added.has(url)).length : 0;
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
        {newCount > 0 && (
          <span style={{ color: NEW_PICTURE, fontWeight: 600 }}>
            {" "}
            {newCount} new {isPhotos ? `photo${newCount === 1 ? "" : "s"}` : `drawing${newCount === 1 ? "" : "s"}`} outlined in green.
          </span>
        )}
        {gone.length > 0 && (
          <span style={{ color: REMOVED_PICTURE, fontWeight: 600 }}>
            {" "}
            {gone.length} {isPhotos ? `photo${gone.length === 1 ? "" : "s"}` : `drawing${gone.length === 1 ? "" : "s"}`} removed, outlined in red; Keep puts one back.
          </span>
        )}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {list.map((url, i) => {
          const m = meta?.[url];
          const isNew = added?.has(url) === true;
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
                  ...(isNew ? { outline: `3px solid ${NEW_PICTURE}`, outlineOffset: 1 } : {}),
                }}
              />
              {isNew && (
                <span
                  className="text-sm"
                  title="Not on the live plan: this change adds it"
                  style={{ position: "absolute", top: 2, right: 4, background: NEW_PICTURE, color: "#fff", borderRadius: 4, padding: "0 4px", fontWeight: 600 }}
                >
                  new
                </span>
              )}
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
        {gone.map((url) => (
          <div
            key={`removed-${url}`}
            onMouseEnter={() => {
              if (!coarse) onPreview({ src: url, caption: "Removed by this change" });
            }}
            onMouseLeave={() => onPreview(null)}
            style={{ position: "relative", textAlign: "center" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              style={{
                width: 96, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid #ccc", display: "block",
                opacity: 0.5, outline: `3px solid ${REMOVED_PICTURE}`, outlineOffset: 1,
              }}
            />
            <span
              className="text-sm"
              title="On the live plan: this change takes it away"
              style={{ position: "absolute", top: 2, right: 4, background: REMOVED_PICTURE, color: "#fff", borderRadius: 4, padding: "0 4px", fontWeight: 600 }}
            >
              removed
            </span>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 2 }}>
              <button
                className="btn btn-secondary"
                style={{ padding: "0 6px" }}
                title="Keep this picture: put it back at the end"
                onClick={() => setList([...list, url])}
              >
                Keep
              </button>
            </div>
          </div>
        ))}
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
  // The column the queue is sorted by, or the queue's own order (Jeff, 2026-09-26).
  const [sort, setSort] = useState<ChangeSort | null>(null);
  const [troubled, setTroubled] = useState<TroubledConnection[]>([]);
  const coarse = useCoarsePointer();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Plans ticked in the list, by group key, and the row the last tick was
  // on, so a shift-click ticks everything between (Jeff, 2026-09-24).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastPicked, setLastPicked] = useState<string | null>(null);
  const [rejectingSelected, setRejectingSelected] = useState(false);
  const [sortingSelected, setSortingSelected] = useState(false);
  /** Seconds the run is waiting out a Wix throttle, so the buttons say so instead of looking stuck. */
  const [throttleWait, setThrottleWait] = useState(0);
  const [editing, setEditing] = useState<Group | null>(null);
  // The plan in the overlay, whole: the list leaves out its captions and the
  // builder's own picture sets (changes/route.ts), which the overlay reads.
  const [editWhole, setEditWhole] = useState<ProposedRecord | null>(null);
  const [editAdded, setEditAdded] = useState<Set<string>>(new Set());
  const [editRemoved, setEditRemoved] = useState<{ photos: string[]; drawings: string[] }>({ photos: [], drawings: [] });
  // A quick move-in's picture on the site, where the change shows another in its place.
  const [editReplaced, setEditReplaced] = useState<string | null>(null);
  const openKey = useRef<string | null>(null);
  // The page of the queue shown, from 0.
  const [page, setPage] = useState(0);
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
  const [sorted, setSorted] = useState<{ placed: number; of: number; removed: number; checked: boolean } | null>(null);
  const [editGallery, setEditGallery] = useState<string[]>([]);
  const [editBlueprints, setEditBlueprints] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  // Plans on their way out of the list, each the way it went (Jeff, 2026-09-29).
  const [leaving, setLeaving] = useState<Map<string, LeavingRow>>(() => new Map());
  // For the reads of the queue: the plans playing their way out, and those
  // whose action is still in flight, keep their rows until they have gone.
  const leavingKeys = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  // Plans an Approve All run is writing, and those gone from the list whose
  // write the page is asking about, held on screen until the answer comes.
  const bulkApproving = useRef(new Set<string>());
  const checking = useRef(new Set<string>());
  // The same, for the rows: asked about, a row takes no clicks and is not counted as waiting.
  const [asking, setAsking] = useState<Set<string>>(() => new Set());
  // The rows on screen now, by plan: only a row in view plays its exit.
  const rowEls = useRef(new Map<string, HTMLTableRowElement>());
  const exitTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // The same timers by plan, so a row played out ahead of its answer can be called back.
  const rowTimers = useRef(new Map<string, Set<ReturnType<typeof setTimeout>>>());
  // Plans whose Approve, Reject or Remove played on the click, the answer
  // still awaited (Jeff, 2026-10-01): a read meanwhile does not list them.
  const ahead = useRef(new Set<string>());
  // The queue as last taken, and the status it was read for.
  const changesRef = useRef<{ status: string; rows: PendingChange[] }>({ status: "", rows: [] });
  // Reads of the queue are numbered, so the answer to an older one never
  // overwrites a newer, nor brings back a plan an action has just cleared.
  const fetchSeq = useRef(0);
  const freshFrom = useRef(0);
  // What this browser has cleared today, and whether the person here has
  // cleared anything since the page opened: an emptied queue is only
  // celebrated when they emptied it, not when a sync did.
  const [tally, setTally] = useState<Tally | null>(null);
  const armed = useRef(false);

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

  /** A plan that has played its way out leaves the list for good; the next read agrees. */
  const finish = useCallback((key: string) => {
    leavingKeys.current.delete(key);
    rowTimers.current.delete(key);
    setLeaving((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    const rows = changesRef.current.rows.filter((r) => groupKeyOf(r) !== key);
    if (rows.length === changesRef.current.rows.length) return;
    changesRef.current = { ...changesRef.current, rows };
    setChanges(rows);
  }, []);

  /**
   * Sends plans out of the list, each row the way it went (Jeff,
   * 2026-09-29): a batch goes row after row (batchDelay), each with its
   * own sound as it starts (Jeff, 2026-09-30), and once a row has played
   * it folds away so the list closes up. Only rows on screen play; a plan
   * on another page simply goes.
   */
  const startLeaving = useCallback(
    (list: Group[], exit: Exit) => {
      const onScreen = list.filter((g) => rowEls.current.has(g.key) && !leavingKeys.current.has(g.key));
      if (!onScreen.length) return;
      const sound = exit === "leave" ? null : FLOOR_PLAN_SOUNDS[exit];
      const reduced = prefersReducedMotion();
      const ms = exitDuration(exit, reduced);
      const fold = foldDuration(reduced);
      const later = (key: string, wait: number, fn: () => void) => {
        const timer = setTimeout(() => {
          exitTimers.current.delete(timer);
          rowTimers.current.get(key)?.delete(timer);
          fn();
        }, wait);
        exitTimers.current.add(timer);
        const mine = rowTimers.current.get(key) ?? new Set();
        mine.add(timer);
        rowTimers.current.set(key, mine);
      };
      for (const g of onScreen) leavingKeys.current.add(g.key);
      setLeaving((prev) => {
        const next = new Map(prev);
        onScreen.forEach((g, i) => next.set(g.key, { exit, delay: batchDelay(exit, i, onScreen.length), ms, fold, foldFrom: null }));
        return next;
      });
      onScreen.forEach((g, i) => {
        const delay = batchDelay(exit, i, onScreen.length);
        if (sound) {
          if (delay) later(g.key, delay, () => playSound(sound));
          else playSound(sound);
        }
        playExit(() => rowEls.current.get(g.key), {
          exit,
          delay,
          duration: ms,
          stampFor: ms + fold + 120,
          particles: i < MAX_BURSTS,
          lead: i === 0,
        });
        later(g.key, delay + ms, () => {
          // Folded from the height it stands at now.
          const height = rowEls.current.get(g.key)?.offsetHeight ?? 0;
          setLeaving((prev) => {
            const row = prev.get(g.key);
            if (!row) return prev;
            const next = new Map(prev);
            next.set(g.key, { ...row, foldFrom: height });
            return next;
          });
        });
        later(g.key, delay + ms + fold, () => finish(g.key));
      });
    },
    [finish]
  );

  /**
   * Brings back a plan that played its way out on the click when the
   * answer did not bear it out (Jeff, 2026-10-01): its exit is stopped
   * wherever it had got to, its rows go back in their places if it had
   * already folded away, and it comes off the day's tally. The read that
   * follows has the last word on where it stands.
   */
  const callBack = useCallback((group: Group, exit: CountedExit, n: number, view: string) => {
    ahead.current.delete(group.key);
    rowTimers.current.get(group.key)?.forEach((timer) => {
      clearTimeout(timer);
      exitTimers.current.delete(timer);
    });
    rowTimers.current.delete(group.key);
    leavingKeys.current.delete(group.key);
    setLeaving((prev) => {
      if (!prev.has(group.key)) return prev;
      const next = new Map(prev);
      next.delete(group.key);
      return next;
    });
    // Only into the list it left: one switched to another filter since gets its own read.
    if (changesRef.current.status === view) {
      const rows = withHeld(changesRef.current.rows, group.rows);
      if (rows !== changesRef.current.rows) {
        changesRef.current = { ...changesRef.current, rows };
        setChanges(rows);
      }
    }
    setTally((t) => takeFromTally(t, exit, n, easternDay(new Date())));
  }, []);

  /**
   * Asks how the writes of plans gone from the list ended, and plays each
   * its way out accordingly: written, it is approved like any other, sound
   * and all (Jeff, 2026-09-30); failed, it only fades, as the run's closing
   * message names it. A plan still being written is asked about again;
   * one put back in the queue stays. No answer at all, and it fades.
   */
  const confirmWritten = useCallback(
    (list: Group[]) => {
      for (const g of list) {
        checking.current.add(g.key);
        bulkApproving.current.delete(g.key);
      }
      setAsking(new Set(checking.current));
      function ask(waiting: Group[], tries: number) {
        const ids = waiting.map((g) => g.lead.id).join(",");
        fetch(`/api/internal/floorplans/changes?status=all&ids=${encodeURIComponent(ids)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((data) => {
            const answered = Array.isArray(data);
            const statusOf = new Map<string, string>(
              (answered ? (data as { id: string; status: string }[]) : []).map((r) => [r.id, r.status])
            );
            const writing = waiting.filter((g) => answered && !writeSettled(statusOf.get(g.lead.id)) && tries < 10);
            const settled = waiting.filter((g) => !writing.includes(g));
            for (const g of settled) checking.current.delete(g.key);
            setAsking(new Set(checking.current));
            const status = (g: Group) => statusOf.get(g.lead.id);
            startLeaving(settled.filter((g) => isWritten(status(g))), "approve");
            // Back in the queue (Wix asked for a wait): the next read lists it again.
            startLeaving(settled.filter((g) => !isWritten(status(g)) && status(g) !== "pending"), "leave");
            if (!writing.length) return;
            const timer = setTimeout(() => {
              exitTimers.current.delete(timer);
              ask(writing, tries + 1);
            }, 1500);
            exitTimers.current.add(timer);
          });
      }
      ask(list, 0);
    },
    [startLeaving]
  );

  /**
   * Takes a read of the queue. A plan the read no longer lists keeps its
   * rows while it plays its way out, while the action on it is still in
   * flight (its exit starts when the answer comes), or while the page asks
   * how its Approve All write went. One that simply went, acted on in
   * another tab, fades out from where it stood, if it was on screen.
   */
  const take = useCallback(
    (read: PendingChange[], status: string) => {
      // A plan played out on the click stays gone while its answer is
      // awaited, though the server still lists it, being written.
      const fresh = ahead.current.size ? read.filter((r) => !ahead.current.has(groupKeyOf(r))) : read;
      const before = changesRef.current.status === status ? changesRef.current.rows : [];
      const listed = new Set(fresh.map(groupKeyOf));
      const kept = new Set<string>();
      const gone = new Set<string>();
      for (const r of before) {
        const key = groupKeyOf(r);
        if (listed.has(key)) continue;
        if (leavingKeys.current.has(key) || inFlight.current.has(key) || checking.current.has(key)) kept.add(key);
        else if (rowEls.current.has(key)) gone.add(key);
      }
      const held = before.filter((r) => kept.has(groupKeyOf(r)) || gone.has(groupKeyOf(r)));
      const rows = withHeld(fresh, held);
      changesRef.current = { status, rows };
      setChanges(rows);
      if (!gone.size) return;
      // A plan an Approve All run was writing: asked about before it plays.
      const went = groupChanges(held.filter((r) => gone.has(groupKeyOf(r))));
      const written = went.filter((g) => bulkApproving.current.has(g.key) || g.rows.some((r) => r.status === "approving"));
      if (written.length) confirmWritten(written);
      startLeaving(went.filter((g) => !written.includes(g)), "leave");
    },
    [startLeaving, confirmWritten]
  );

  const fetchChanges = useCallback(() => {
    const seq = ++fetchSeq.current;
    const status = statusFilter;
    fetch(`/api/internal/floorplans/changes?status=${status}`)
      .then((r) => r.json())
      .then((data) => {
        if (seq < freshFrom.current) return;
        freshFrom.current = seq;
        if (Array.isArray(data)) take(data, status);
        else setError(data.error ?? "Failed to load");
        setLoading(false);
      })
      .catch((e) => {
        if (seq < freshFrom.current) return;
        setError(e.message);
        setLoading(false);
      });
  }, [statusFilter, take]);

  /** Reads already on their way predate the action just taken, and would bring its plan back: only newer ones count. */
  function dropStaleReads() {
    freshFrom.current = fetchSeq.current + 1;
  }

  // Timers of rows still playing stop with the page.
  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // The day's tally, as this browser kept it; then kept as it grows.
  useEffect(() => {
    let kept: string | null = null;
    try {
      kept = window.localStorage.getItem(TALLY_STORAGE_KEY);
    } catch {
      // storage refused: counted for this visit only
    }
    setTally(readTally(kept, easternDay(new Date())));
  }, []);
  useEffect(() => {
    if (!tally) return;
    try {
      window.localStorage.setItem(TALLY_STORAGE_KEY, JSON.stringify(tally));
    } catch {
      // counted for this visit only
    }
  }, [tally]);

  /** Counts plans cleared toward the day's tally, and arms the celebration for when the queue runs out. */
  const count = useCallback((exit: CountedExit, n: number) => {
    if (n <= 0) return;
    armed.current = true;
    const day = easternDay(new Date());
    setTally((t) => addToTally(t, exit, n, day));
  }, []);

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
  // Floor plans only, quick move-ins only, or both (Jeff, 2026-09-19),
  // in the order of the column chosen. Shift-click ticks every plan between
  // two in this order, as shown.
  const groups = useMemo(
    () =>
      sortChanges(
        siteGroups.filter((g) => (kindFilter === "all" ? true : kindFilter === "qmi" ? isQuickMoveIn(g) : !isQuickMoveIn(g))),
        sort,
        sortFacts
      ),
    [siteGroups, kindFilter, sort]
  );
  // The last column chosen in this browser, once the page is showing.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SORT_STORAGE_KEY) ?? "null") as ChangeSort | null;
      if (saved && SORT_COLUMNS.some((c) => c.key === saved.key) && (saved.dir === "asc" || saved.dir === "desc")) setSort(saved);
    } catch {
      // nothing remembered, or storage refused: the queue's own order
    }
  }, []);
  // A column clicked once sorts by it, again turns it around, and a third
  // time goes back to the queue's own order.
  const sortBy = useCallback((key: ChangeSortKey) => {
    setSort((now) => {
      const next: ChangeSort | null =
        now?.key !== key ? { key, dir: FIRST_DIRECTION[key] } : now.dir === FIRST_DIRECTION[key] ? { key, dir: now.dir === "asc" ? "desc" : "asc" } : null;
      try {
        if (next) window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next));
        else window.localStorage.removeItem(SORT_STORAGE_KEY);
      } catch {
        // remembered for this visit only
      }
      return next;
    });
  }, []);
  // A plan on its way out is no longer waiting: not counted, ticked or sent again.
  const pendingGroups = useMemo(() => groups.filter((g) => pendingIds(g).length > 0 && !leaving.has(g.key) && !asking.has(g.key)), [groups, leaving, asking]);
  // One page of the list. A filter or a sort starts again from the first
  // page; a page emptied by approvals falls back to the last one left.
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const shownPage = Math.min(page, pages - 1);
  const offset = shownPage * PAGE_SIZE;
  const pageGroups = useMemo(() => groups.slice(offset, offset + PAGE_SIZE), [groups, offset]);
  const pagePending = useMemo(() => pageGroups.filter((g) => pendingIds(g).length > 0 && !leaving.has(g.key) && !asking.has(g.key)), [pageGroups, leaving, asking]);
  useEffect(() => setPage(0), [statusFilter, siteFilter, builderFilter, kindFilter, sort]);
  const pendingQuickMoveIns = useMemo(
    () => siteGroups.filter((g) => pendingIds(g).length > 0 && isQuickMoveIn(g) && !leaving.has(g.key) && !asking.has(g.key)),
    [siteGroups, leaving, asking]
  );
  // Plans still waiting in the whole queue, whatever the filters show.
  const queueLeft = useMemo(
    () => (statusFilter === "pending" ? groupChanges(changes).filter((g) => !leaving.has(g.key)).length : 0),
    [changes, leaving, statusFilter]
  );
  const cleared = clearedIn(tally);
  // The ticked plans still pending in this view: a plan approved, rejected
  // or filtered out of view is never acted on by a tick left behind.
  const selectedGroups = useMemo(() => pendingGroups.filter((g) => selected.has(g.key)), [pendingGroups, selected]);
  // The box atop the table ticks the plans on this page; ticks on other pages stay.
  const allSelected = pagePending.length > 0 && pagePending.every((g) => selected.has(g.key));
  const selectedBlocked = useMemo(
    () => selectedGroups.filter((g) => approvalBlocker(g.kind, g.lead.proposed_record)).length,
    [selectedGroups]
  );

  /**
   * Ticks or unticks one plan, or with shift every pending plan between it
   * and the last one ticked — on this page only, so no plan out of sight is
   * ticked by it.
   */
  function pick(index: number, shift: boolean) {
    const on = !selected.has(groups[index]?.key);
    // The last tick by its plan, not its row, so a list re-read or filtered since still finds it.
    const anchor = shift && lastPicked != null ? groups.findIndex((g) => g.key === lastPicked) : -1;
    const [from, to] =
      anchor >= 0
        ? [Math.max(offset, Math.min(anchor, index)), Math.min(offset + PAGE_SIZE - 1, Math.max(anchor, index))]
        : [index, index];
    setSelected((prev) => {
      const next = new Set(prev);
      for (let i = from; i <= to; i++) {
        const g = groups[i];
        if (!g || pendingIds(g).length === 0) continue;
        if (on) next.add(g.key);
        else next.delete(g.key);
      }
      return next;
    });
    setLastPicked(groups[index]?.key ?? null);
  }

  function pickAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const g of pagePending) {
        if (allSelected) next.delete(g.key);
        else next.add(g.key);
      }
      return next;
    });
    setLastPicked(null);
  }

  // Plans the server is writing right now; each leaves the list as its write finishes.
  const approvingCount = useMemo(
    () => siteGroups.filter((g) => g.status === "approving" && !leaving.has(g.key)).length,
    [siteGroups, leaving]
  );
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

  // The last pending plan dealt with by the person here: fireworks, the
  // character celebrates and says so, and the victory plays (Jeff,
  // 2026-09-29). Only once the last row has played its own way out.
  useEffect(() => {
    if (statusFilter !== "pending" || loading || error || !armed.current) return;
    if (queueLeft > 0 || leaving.size > 0 || busy.size > 0 || bulkBusy || rejectingSelected) return;
    armed.current = false;
    if (FLOOR_PLAN_SOUNDS.cleared) playSound(FLOOR_PLAN_SOUNDS.cleared);
    emitLeadEvent({ type: "floorplans_cleared", leadName: "" });
  }, [statusFilter, loading, error, queueLeft, leaving, busy, bulkBusy, rejectingSelected]);

  /**
   * Approves or rejects every pending row of a plan, or puts a rejected
   * plan back in the queue; reports a failed write instead of hiding it in
   * the Failed filter.
   *
   * Approve and Reject play the plan's way out on the click, not on the
   * answer, so the queue feels quick (Jeff, 2026-10-01). The answer must
   * bear it out: an approval written to Wix, not one Wix deferred; a
   * rejection that took. One that does not brings the row back, and says
   * why when something went wrong.
   */
  async function act(group: Group, action: "approve" | "reject" | "restore"): Promise<boolean> {
    const ids = action === "restore" ? idsAt(group, "rejected") : pendingIds(group);
    if (!ids.length) return true;
    const starred = group.lead.fp_floor_plans?.starred;
    if (
      action === "approve" &&
      starred &&
      (group.kind === "remove" || group.kind === "update") &&
      !confirm(`⭐ This plan is in the email drip campaign. Approving this ${group.kind} raises a campaign alert and texts the frontlines agent to update the marketing. Continue?`)
    ) {
      return false;
    }
    const what = action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Restore";
    const name = group.lead.proposed_record?.name ?? group.lead.plan_key;
    const exit: CountedExit | null = action === "restore" ? null : action;
    const view = changesRef.current.status;
    setBusy((b) => new Set(b).add(group.key));
    inFlight.current.add(group.key);
    if (exit) {
      ahead.current.add(group.key);
      startLeaving([group], exit);
      count(exit, 1);
    }
    try {
      const res = await fetch("/api/internal/floorplans/changes/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (exit) callBack(group, exit, 1, view);
        const detail = data?.results?.find((r: { error?: string | null }) => r.error)?.error ?? data?.error ?? `HTTP ${res.status}`;
        alert(`${what} failed for ${name}: ${detail}`);
        return false;
      }
      const took =
        action === "approve" ? countWritten(data?.results) > 0 : action === "reject" ? Number(data?.rejected) > 0 : true;
      if (exit && !took) {
        callBack(group, exit, 1, view);
        // Wix asked for a wait and the plan went back to the queue. A
        // reject that found nothing pending was acted on elsewhere; the
        // read below shows where it went.
        if (action === "approve") {
          const wait = Number(data?.retryAfterMs);
          const status = data?.results?.[0]?.status;
          alert(
            Array.isArray(data?.remaining) && data.remaining.length
              ? `${name} was not approved: Wix is busy${wait > 0 ? ` for about ${Math.ceil(wait / 1000)}s` : ""}. It is back in the queue; approve it again in a moment.`
              : `${name} was not approved${status ? ` (${status})` : ""}. It may have been acted on elsewhere; the list has been refreshed.`
          );
        }
        return false;
      }
      if (exit) dropStaleReads();
      return true;
    } catch (e) {
      if (exit) callBack(group, exit, 1, view);
      alert(`${what} failed for ${name}: ${e instanceof Error ? e.message : String(e)}. The list has been refreshed to show where it stands.`);
      return false;
    } finally {
      ahead.current.delete(group.key);
      inFlight.current.delete(group.key);
      setBusy((b) => {
        const next = new Set(b);
        next.delete(group.key);
        return next;
      });
      fetchChanges();
    }
  }

  /**
   * Takes a plan off the site from the queue, with the quick move-ins built
   * from it: a community that sold out while the builder still lists the
   * plan with no price (The Towns at Firethorn's Marigold, Jeff 2026-09-29).
   * The plan goes up on the click (Jeff, 2026-10-01), the quick move-ins it
   * took with it once the server names them; if the plan itself did not
   * come off it comes back, and the alert says whatever stayed.
   */
  async function removePlan(group: Group) {
    const rec = group.lead.proposed_record;
    const name = rec?.name ?? group.lead.plan_key;
    const what = rec?.quickMoveIn
      ? `Remove ${name} from the site now?`
      : `Remove ${name} from the site now, with every quick move-in built from it?`;
    if (!confirm(`${what}\n\nIt comes off Wix right away and its queued changes are withdrawn. The sync will not offer it back unless the builder prices it again; Restore under Rejected brings it back sooner.`)) return;
    const view = changesRef.current.status;
    setBusy((b) => new Set(b).add(group.key));
    inFlight.current.add(group.key);
    ahead.current.add(group.key);
    startLeaving([group], "remove");
    count("remove", 1);
    try {
      const res = await fetch(`/api/internal/floorplans/changes/${group.lead.id}/remove-plan`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      const removed = (data?.removed ?? []) as { planKey: string; name: string; quickMoveIn: boolean; status: string; error: string | null }[];
      // The quick move-ins it took off the site follow it up, one after another.
      const homes = new Set(removed.filter((r) => r.status === "synced").map((r) => groupKeyOf({ ...group.lead, plan_key: r.planKey })));
      const planOff = homes.delete(group.key);
      const chained = groupChanges(changesRef.current.rows).filter((g) => homes.has(g.key));
      if (planOff || chained.length) dropStaleReads();
      if (!planOff) callBack(group, "remove", 1, view);
      startLeaving(chained, "remove");
      count("remove", chained.length);
      if (!res.ok || removed.some((r) => r.status !== "synced")) {
        const lines = removed.map((r) => `${r.name}: ${r.status === "synced" ? "removed" : r.status}${r.error ? ` (${r.error})` : ""}`);
        alert(`Remove ${name}: ${data?.error ?? "not everything came off"}${lines.length ? `\n\n${lines.join("\n")}` : ""}`);
      }
    } catch (e) {
      callBack(group, "remove", 1, view);
      alert(`Remove ${name} failed: ${e instanceof Error ? e.message : String(e)}. Check the site before trying again.`);
    } finally {
      ahead.current.delete(group.key);
      inFlight.current.delete(group.key);
      setBusy((b) => {
        const next = new Set(b);
        next.delete(group.key);
        return next;
      });
      fetchChanges();
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
    setEditWhole(null);
    setEditAdded(new Set());
    setEditRemoved({ photos: [], drawings: [] });
    setEditReplaced(null);
    setEditing(group);
    openKey.current = group.key;
    fetch(`/api/internal/floorplans/changes/${group.lead.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const whole = (data?.proposed_record ?? null) as ProposedRecord | null;
        // Only while this plan is still the one open.
        if (whole && openKey.current === group.key) {
          setEditWhole(whole);
          const added = Array.isArray(data?.addedPictures) ? (data.addedPictures as unknown[]).filter((u): u is string => typeof u === "string") : [];
          setEditAdded(new Set(added));
          const urls = (v: unknown) => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : []);
          setEditRemoved({ photos: urls(data?.removedPictures?.photos), drawings: urls(data?.removedPictures?.drawings) });
          setEditReplaced(typeof data?.replacedPrimary === "string" ? data.replacedPrimary : null);
        }
      })
      .catch(() => {});
  }

  /** Writes the form onto every pending row of the plan, so whichever row is approved carries the edits. */
  /**
   * Writes the form onto every pending row of the plan, so whichever row is
   * approved carries the edits. Says why when the route refuses, rather
   * than closing as if saved: a plan being approved, or already approved,
   * takes no more edits (Jeff, 2026-09-30).
   */
  async function persistEdits(group: Group): Promise<string | null> {
    const record = { ...editForm, galleryImages: editGallery, blueprintImages: editBlueprints };
    const refusals = await Promise.all(
      pendingIds(group).map(async (id) => {
        try {
          const res = await fetch(`/api/internal/floorplans/changes/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ record }),
          });
          if (res.ok) return null;
          const data = await res.json().catch(() => ({}));
          return (data?.error as string | undefined) ?? `HTTP ${res.status}`;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      })
    );
    return refusals.find((r) => r !== null) ?? null;
  }

  /** Saves the edits and closes the overlay; a refused save keeps it open and says why. */
  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    let refused: string | null = null;
    try {
      refused = await persistEdits(editing);
    } finally {
      setSavingEdit(false);
      if (refused) {
        alert(`Your edits were not saved: ${refused}.\n\nThe plan may be being approved, or have been approved or rejected, since you opened it. Cancel to close.`);
      } else {
        setEditing(null);
        setPreview(null);
      }
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
   * person to arrange (Jeff, 2026-09-22). A photograph filed twice, at
   * another size or crop, is shown once (Jeff, 2026-09-23). The new order
   * lands in the overlay for a look; it is saved with the rest on Save.
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
      setSorted({
        placed: typeof data.placed === "number" ? data.placed : 0,
        of: data.galleryImages.length,
        removed: Array.isArray(data.removed) ? data.removed.length : 0,
        checked: data.duplicatesChecked !== false,
      });
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
      const refused = await persistEdits(editing);
      if (refused) {
        alert(`Could not save the edits before creating the floor plan: ${refused}.`);
        return;
      }
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
  async function approveGroups(list: Group[], what: string): Promise<boolean> {
    if (!confirm(`Approve ${list.length} ${what}? Approved plans are written to Wix as published items.`)) return false;
    const names = new Map<string, string>();
    const blocked = new Set<string>();
    const slices: string[][] = [];
    for (const g of list) {
      const name = g.lead.proposed_record?.name ?? g.lead.plan_key;
      names.set(g.lead.plan_key, name);
      if (approvalBlocker(g.kind, g.lead.proposed_record)) blocked.add(name);
      else if (pendingIds(g).length) {
        slices.push(pendingIds(g));
        // Each plays Approve's way out as its write lands (Jeff, 2026-09-30), once the page has asked how it went.
        bulkApproving.current.add(g.key);
      }
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
        // Each plan leaves the list as its write lands, read by read; the tally counts them as the answers come.
        count("approve", countWritten(data.results));
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
    return true;
  }

  /** Approves the ticked plans, as Approve All does, and clears the ticks once they are sent. */
  async function approveSelected() {
    if (await approveGroups(selectedGroups, `selected plan${selectedGroups.length === 1 ? "" : "s"}`)) setSelected(new Set());
  }

  /**
   * Sorts the photos of the ticked plans, as the Sort button in the edit
   * overlay sorts one: each photograph once, then the front of the house,
   * the rooms, the other outside views (Jeff, 2026-09-28: faster than
   * opening every plan). Written straight to the queue, not as a hand
   * edit, so a later run may still bring the builder's new photos. The
   * ticks stay, for an approval after a look.
   */
  async function sortSelected() {
    const list = selectedGroups;
    const slices = list.map((g) => pendingIds(g)).filter((ids) => ids.length);
    setSortingSelected(true);
    let sorted = 0;
    let removed = 0;
    let skipped = 0;
    const failed: string[] = [];
    let problem: string | null = null;
    try {
      while (slices.length) {
        // Whole plans per request, so no plan's rows are split across two.
        const ids: string[] = [];
        while (slices.length && ids.length + slices[0].length <= MAX_IDS_PER_REQUEST) ids.push(...slices.shift()!);
        if (!ids.length) ids.push(...slices.shift()!);
        const res = await fetch("/api/internal/floorplans/changes/sort-photos", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data?.results)) {
          problem = data?.error ?? `HTTP ${res.status}`;
          break;
        }
        for (const r of data.results as { planKey: string; status: string; removed: number }[]) {
          if (r.status === "sorted") {
            sorted += 1;
            removed += r.removed;
          } else if (r.status === "skipped") skipped += 1;
          else failed.push(r.planKey);
        }
        const remaining = (Array.isArray(data.remaining) ? data.remaining : []).filter((x: unknown): x is string => typeof x === "string");
        if (remaining.length >= ids.length) {
          problem = "the server made no progress";
          break;
        }
        if (remaining.length) slices.unshift(remaining);
        fetchChanges();
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      setSortingSelected(false);
      fetchChanges();
      const notes = [`Sorted the photos of ${sorted} plan${sorted === 1 ? "" : "s"}${removed ? `, taking out ${removed} duplicate photo${removed === 1 ? "" : "s"}` : ""}.`];
      if (skipped) notes.push(`${skipped} had fewer than two photos and were left as they are.`);
      if (failed.length) notes.push(`${failed.length} could not be sorted: ${failed.join(", ")}. Try again, or use Sort in the plan's edit window.`);
      if (problem) notes.push(`Sorting stopped part way (${problem}); the plans not reached can be sorted again.`);
      alert(notes.join("\n"));
    }
  }

  /**
   * Rejects the ticked plans. A rejection sticks, so each can be brought
   * back one by one with Restore under the Rejected filter.
   */
  async function rejectSelected() {
    const list = selectedGroups;
    if (!confirm(`Reject ${list.length} selected plan${list.length === 1 ? "" : "s"}? A rejected change is not raised again; Restore under the Rejected filter brings one back.`)) return;
    const ids = list.flatMap((g) => pendingIds(g));
    setRejectingSelected(true);
    let problem: string | null = null;
    try {
      for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
        const res = await fetch("/api/internal/floorplans/changes/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reject", ids: ids.slice(i, i + MAX_IDS_PER_REQUEST) }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          problem = data?.error ?? `HTTP ${res.status}`;
          break;
        }
      }
      if (!problem) {
        setSelected(new Set());
        dropStaleReads();
        startLeaving(list, "reject");
        count("reject", list.length);
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      setRejectingSelected(false);
      fetchChanges();
      if (problem) alert(`Rejecting the selected plans stopped part way (${problem}). Whatever is still pending can be rejected again.`);
    }
  }

  // Whether the plan in the overlay has builder pictures to bring back.
  const editRec = editing ? (editWhole ?? editing.lead.proposed_record ?? null) : null;
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
                disabled={bulkBusy || rejectingSelected || sortingSelected}
                title="Every pending quick move-in the site and builder filters allow, whatever the view shows"
              >
                {bulkBusy ? busyLabel : `Approve all Quick Move-Ins (${pendingQuickMoveIns.length})`}
              </button>
            )}
            {pendingGroups.length > 0 && (
              <button className="btn btn-primary" onClick={() => approveGroups(pendingGroups, "visible plans")} disabled={bulkBusy || rejectingSelected || sortingSelected}>
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
        statusFilter === "pending" && queueLeft === 0 ? (
          // The whole queue empty (Jeff, 2026-09-29), whoever emptied it and
          // whenever (Jeff, 2026-09-30); with the day's tally when this
          // browser cleared some of it.
          <div className="card mission-complete">
            <div className="mission-complete-title">MISSION COMPLETE</div>
            <p>Every pending floor plan has been dealt with.</p>
            {tally && cleared > 0 && <p className="mission-complete-tally">Today: {tallyLine(tally)}</p>}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            No {statusFilter === "all" ? "" : statusFilter} floor plan changes.
          </div>
        )
      ) : (
        <div className="card has-selection-bar">
          {(pendingGroups.length > 0 || leaving.size > 0) && (
            <div className="selection-bar">
              {selectedGroups.length === 0 ? (
                <span className="text-muted text-sm">
                  Tick plans to approve, reject or sort the photos of several at once. Shift-click ticks every plan between two.
                </span>
              ) : (
                <>
                  <strong className="text-sm">{selectedGroups.length} selected</strong>
                  <button className="btn btn-primary" onClick={approveSelected} disabled={bulkBusy || rejectingSelected || sortingSelected}>
                    {bulkBusy ? busyLabel : `Approve selected (${selectedGroups.length})`}
                  </button>
                  <button className="btn btn-secondary" onClick={rejectSelected} disabled={bulkBusy || rejectingSelected || sortingSelected}>
                    {rejectingSelected ? "Rejecting…" : `Reject selected (${selectedGroups.length})`}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={sortSelected}
                    disabled={bulkBusy || rejectingSelected || sortingSelected}
                    title="Show each photo once and put the front of the house first, then the rooms, as Sort does in the edit window"
                  >
                    {sortingSelected ? "Sorting photos…" : `Sort photos (${selectedGroups.length})`}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setSelected(new Set())} disabled={bulkBusy || rejectingSelected || sortingSelected}>
                    Clear
                  </button>
                  {selectedBlocked > 0 && (
                    <span className="text-sm" style={{ color: "var(--warning, #b45309)" }}>
                      {selectedBlocked} still need{selectedBlocked === 1 ? "s" : ""} something (see the ⚠ under each) and will stay pending
                    </span>
                  )}
                </>
              )}
              {/* The day's clears against what still waits, filling toward an empty queue (Jeff, 2026-09-29). */}
              {statusFilter === "pending" && tally && (
                <span
                  className="fp-progress"
                  title="Plans approved, rejected or removed from this browser today, against every plan still waiting in the queue, whatever the filters show"
                >
                  <span>
                    {cleared} cleared today · {queueLeft} to go
                  </span>
                  <span
                    className="fp-progress-track"
                    role="progressbar"
                    aria-label="Today's progress through the queue"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progressOf(cleared, queueLeft) * 100)}
                  >
                    <span className="fp-progress-fill" style={{ width: `${Math.round(progressOf(cleared, queueLeft) * 100)}%` }} />
                  </span>
                </span>
              )}
            </div>
          )}
          {pages > 1 && (
            <Pager page={shownPage} pages={pages} offset={offset} shown={pageGroups.length} total={groups.length} onPage={setPage} />
          )}
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    {pendingGroups.length > 0 && (
                      <input
                        type="checkbox"
                        aria-label="Select every pending plan on this page"
                        title="Select every pending plan on this page"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = selectedGroups.length > 0 && !allSelected;
                        }}
                        onChange={pickAll}
                        disabled={bulkBusy || rejectingSelected || sortingSelected}
                      />
                    )}
                  </th>
                  <th></th>
                  {SORT_COLUMNS.map((col) => {
                    const on = sort?.key === col.key;
                    return (
                      <th key={col.key} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                        <button
                          type="button"
                          onClick={() => sortBy(col.key)}
                          title={`Sort ${col.hint}${on ? " — click again to reverse, a third time for the queue's own order" : ""}`}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            font: "inherit",
                            letterSpacing: "inherit",
                            textTransform: "inherit",
                            color: on ? "var(--text)" : "inherit",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {col.label}
                          <span aria-hidden="true" style={{ marginLeft: 4, opacity: on ? 1 : 0.35 }}>
                            {on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageGroups.map((g, onPage) => {
                  const index = offset + onPage;
                  // On its way out: it plays, then folds its height away (leaving-rows.ts).
                  const out = leaving.get(g.key);
                  if (out?.foldFrom != null) {
                    return (
                      <tr key={g.key} className="fp-fold" aria-hidden="true">
                        <td colSpan={COLUMN_COUNT}>
                          <div style={{ height: out.foldFrom, "--fp-fold-ms": `${out.fold}ms` } as CSSProperties} />
                        </td>
                      </tr>
                    );
                  }
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
                  // A row playing its way out still shows what it was, but takes no more clicks.
                  // Nor does one whose Approve, Reject or Remove is still on its way (Jeff,
                  // 2026-09-30): the server has it locked, so it cannot be edited meanwhile.
                  const inert = Boolean(out) || asking.has(g.key) || busy.has(g.key);
                  return (
                    <tr
                      key={g.key}
                      ref={(el) => {
                        if (el) rowEls.current.set(g.key, el);
                        else rowEls.current.delete(g.key);
                      }}
                      className={out ? `fp-leaving fp-leaving-${out.exit}` : undefined}
                      onClick={(e) => {
                        // The whole row opens the overlay (Jeff, 2026-09-19); the
                        // 3D tour and builder page links and every button keep their own job.
                        if (!isPending || inert) return;
                        if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
                        openEdit(g);
                      }}
                      style={
                        {
                          ...(isPending && !inert ? { cursor: "pointer" } : {}),
                          ...(colors ? { background: colors.tint } : {}),
                          ...(out ? { "--fp-exit-ms": `${out.ms}ms`, "--fp-exit-delay": `${out.delay}ms` } : {}),
                        } as CSSProperties
                      }
                      title={isPending && !inert ? "Click to edit this plan before approving" : undefined}
                    >
                      <td
                        style={{ width: 32, ...(colors ? { borderLeft: `3px solid ${colors.accent}` } : {}) }}
                        onClick={(e) => {
                          // A miss beside the box ticks it too, rather than opening the overlay.
                          if (!isPending || inert || (e.target as HTMLElement).closest("input")) return;
                          e.stopPropagation();
                          pick(index, e.shiftKey);
                        }}
                      >
                        {isPending && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${rec?.name ?? c.plan_key}`}
                            checked={selected.has(g.key)}
                            onChange={(e) => pick(index, (e.nativeEvent as MouseEvent).shiftKey === true)}
                            disabled={bulkBusy || rejectingSelected || sortingSelected || inert}
                          />
                        )}
                      </td>
                      <td style={{ width: 92 }}>
                        {thumb ? (
                          <button
                            type="button"
                            title={isPending ? "Edit this plan before approving" : `${photoCount} photos`}
                            disabled={isPending && inert}
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
                        {isPending && photoCount > 1 && !rec?.photosSorted && !rec?.userEditedFields?.includes("galleryImages") && (
                          <div
                            className="text-sm"
                            style={{ color: "var(--info, #60a5fa)" }}
                            title="Its photos are being looked at and put in order in the background, a few minutes after a run. No need to sort them by hand."
                          >
                            ⟳ Sorting photos…
                          </div>
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
                            {fieldRows.map((r) =>
                              r.field_changed === TOUR_REVIEW_LABEL ? (
                                // The weekly tour review (tour-review.ts): the tour to open, and why it was put here.
                                <div key={r.id}>
                                  {r.field_changed}:{" "}
                                  <a href={r.old_value ?? undefined} target="_blank" rel="noreferrer">open the tour ↗</a> → <strong>no tour</strong>
                                  {r.proposed_record?.tourReview?.reason && (
                                    <div className="text-muted">Why: {r.proposed_record.tourReview.reason}. Approve takes it off the site; Reject keeps it.</div>
                                  )}
                                </div>
                              ) : (
                                <div key={r.id}>
                                  {r.field_changed}: <s className="text-muted">{formatValue(r.field_changed, r.old_value)}</s> → <strong>{formatValue(r.field_changed, r.new_value)}</strong>
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <span>{detailLine(rec)}</span>
                        )}
                        {failedRow && (
                          <div className="text-muted text-sm">⚠ {failedRow.error_detail}</div>
                        )}
                        {isPending && g.kind === "update" && fieldRows.some((r) => r.field_changed === "price" && !r.new_value) && (
                          <div
                            className="text-sm"
                            style={{ color: "var(--warning, #b45309)" }}
                            title="The builder still lists it, with no price. If it sold out, Remove takes it off the site with its quick move-ins."
                          >
                            ⚠ price gone: sold out?
                          </div>
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
                            disabled={busy.has(g.key) || inert}
                            title="Put this back in the queue. Rejecting it stopped the sync from ever raising it again; this lifts that too."
                            onClick={() => act(g, "restore")}
                          >
                            {busy.has(g.key) || inert ? "…" : "Restore"}
                          </button>
                        )}
                        {isPending && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn btn-primary"
                              disabled={busy.has(g.key) || inert || Boolean(blocker)}
                              title={blocker ?? undefined}
                              onClick={() => act(g, "approve")}
                            >
                              {busy.has(g.key) || inert ? "…" : "Approve"}
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busy.has(g.key) || inert}
                              onClick={() => openEdit(g)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busy.has(g.key) || inert}
                              onClick={() => act(g, "reject")}
                            >
                              Reject
                            </button>
                            {g.kind === "update" && (
                              <button
                                className="btn btn-secondary"
                                disabled={busy.has(g.key) || inert}
                                title={
                                  rec?.quickMoveIn
                                    ? "Take this home off the site now."
                                    : "Take this plan off the site now, with the quick move-ins built from it."
                                }
                                onClick={() => removePlan(g)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <Pager page={shownPage} pages={pages} offset={offset} shown={pageGroups.length} total={groups.length} onPage={setPage} />
          )}
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
                    // "2" reads "2 car", the way the sites show garages; saved that way too.
                    onBlur={field === "garages" ? () => setEditForm((f) => ({ ...f, garages: standardGarages(f.garages) ?? "" })) : undefined}
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
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={editGallery[0]}
                        alt=""
                        style={{
                          maxWidth: 320, maxHeight: 220, borderRadius: 6, display: "block", objectFit: "cover",
                          ...(editReplaced ? { outline: `3px solid ${NEW_PICTURE}`, outlineOffset: 1 } : {}),
                        }}
                      />
                      {editReplaced && (
                        <span
                          className="text-sm"
                          title="This change shows this picture in place of the one on the site"
                          style={{ position: "absolute", top: 4, right: 6, background: NEW_PICTURE, color: "#fff", borderRadius: 4, padding: "0 4px", fontWeight: 600 }}
                        >
                          new
                        </span>
                      )}
                    </div>
                    {editReplaced && (
                      <div>
                        <div className="text-muted text-sm" style={{ marginBottom: 4 }}>
                          On the site now
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={editReplaced} alt="" style={{ width: 128, height: 88, borderRadius: 6, display: "block", objectFit: "cover", opacity: 0.8 }} />
                      </div>
                    )}
                  </div>
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
                  meta={editRec?.galleryMeta}
                  isPhotos
                  onPreview={setPreview}
                  added={editAdded}
                  removed={editRemoved.photos}
                />
                <GalleryEditor
                  label="Blueprints"
                  list={editBlueprints}
                  setList={setEditBlueprints}
                  isPhotos={false}
                  onPreview={setPreview}
                  added={editAdded}
                  removed={editRemoved.drawings}
                />
                {editGallery.length > 1 && (
                  <div className="form-group">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={sorting || savingEdit || restoring}
                      onClick={sortPhotos}
                      title="Claude looks at each photo and puts them in the site's order: the front of the house first, then kitchen, living, dining, outdoor, and the other exterior shots last. A photo that appears twice is kept once."
                    >
                      {sorting ? "Looking at the photos…" : "✨ Sort the photos"}
                    </button>
                    <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                      {sorted
                        ? `${
                            sorted.placed === sorted.of
                              ? `Placed all ${sorted.of} photos.`
                              : `Placed ${sorted.placed} of ${sorted.of} photos; the rest kept their order.`
                          } ${
                            sorted.removed
                              ? `Removed ${sorted.removed} duplicate photo${sorted.removed === 1 ? "" : "s"}.`
                              : sorted.checked
                                ? "No duplicates found."
                                : "Duplicates could not be checked this time; try again."
                          } Drag any that are wrong, then Save.`
                        : "Claude looks at each picture, removes any photo that appears twice and orders them the way the sites do. Nothing is saved until you press Save."}
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

/** "Plans 51–100 of 276", with the pages either side. */
function Pager({
  page,
  pages,
  offset,
  shown,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  offset: number;
  shown: number;
  total: number;
  onPage: (page: number) => void;
}) {
  // The first, the last, and the two either side of this one.
  const near = [...new Set([0, page - 2, page - 1, page, page + 1, page + 2, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
      <span className="text-muted text-sm" style={{ marginRight: 8 }}>
        Plans {offset + 1}–{offset + shown} of {total}
      </span>
      <button className="btn btn-secondary" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ‹ Prev
      </button>
      {near.map((p, i) => (
        <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 && p - near[i - 1] > 1 && <span className="text-muted">…</span>}
          <button
            className={`btn ${p === page ? "btn-primary" : "btn-secondary"}`}
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            style={{ minWidth: 36 }}
          >
            {p + 1}
          </button>
        </span>
      ))}
      <button className="btn btn-secondary" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next ›
      </button>
    </div>
  );
}
