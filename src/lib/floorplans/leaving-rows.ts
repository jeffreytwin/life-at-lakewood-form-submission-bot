// How a plan leaves the review queue on screen (Jeff, 2026-09-29: getting
// the pending floor plans done should be fun). Approve, Reject and Remove
// each play their own way out once the server has the change, an Approve
// All run's plans too once the page has asked how each write went (Jeff,
// 2026-09-30); a plan that leaves the list any other way, a failed write or
// one acted on in another tab, fades and folds away without claiming what
// happened to it. The rows of a plan still playing are kept in the list until it has
// gone, so a read of the queue landing mid-animation does not cut it short.
// Pure, for the page and its tests.

import type { GroupableChange } from "./group-changes";

/** How a row goes: one of the three buttons, or "leave" for a plan gone from the list some other way. */
export type Exit = "approve" | "reject" | "remove" | "leave";

/** The exits a person chose, counted toward the day's tally. */
export type CountedExit = Exclude<Exit, "leave">;

/** How long each row plays before it folds away, in ms. */
const EXIT_MS: Record<Exit, number> = { approve: 700, reject: 700, remove: 540, leave: 260 };
/** How long a row that has played takes to fold its height away. */
const FOLD_MS = 220;
/** With reduced motion a row just fades, and the list closes up at once. */
const REDUCED_MS = 160;

export function exitDuration(exit: Exit, reduced: boolean): number {
  return reduced ? REDUCED_MS : EXIT_MS[exit];
}

export function foldDuration(reduced: boolean): number {
  return reduced ? 0 : FOLD_MS;
}

/**
 * Rows leaving together go one after another, like a wave; past the tenth
 * the rest go at once, so a page of fifty is not a thirty-second show.
 */
export function cascadeDelay(index: number): number {
  return Math.min(index, 10) * 60;
}

/**
 * How long after a batch starts each of its rows plays, sound and all
 * (Jeff, 2026-09-30). A rejected batch goes in a rattle, each row's sound
 * on top of the last, like a menu blip with the arrow key held down, and
 * a big batch rattles faster so it is over in a second and a half.
 * Approvals and removals go one at a time: the plans one read of an
 * Approve All run finds written are spread across the three seconds to the
 * next read, as they were written, and a removal's quick move-ins go up
 * one after another. A plan that simply went fades in a quick wave.
 */
export function batchDelay(exit: Exit, index: number, count: number): number {
  if (exit === "leave") return cascadeDelay(index);
  if (count <= 1) return 0;
  const gap =
    exit === "reject"
      ? Math.min(60, Math.floor(1500 / (count - 1)))
      : exit === "approve"
        ? Math.min(600, Math.floor(2700 / (count - 1)))
        : 400;
  return index * gap;
}

/** The list route's order: newest first, then by id. */
function listOrder(a: GroupableChange, b: GroupableChange): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The queue as the server sent it, with the rows of plans still leaving
 * the screen put back in their places. A read that lands between a plan's
 * write and the end of its animation no longer lists it, and without this
 * the row would vanish mid-explosion.
 */
export function withHeld<T extends GroupableChange>(fresh: T[], held: T[]): T[] {
  if (!held.length) return fresh;
  const ids = new Set(fresh.map((r) => r.id));
  const kept = held.filter((r) => !ids.has(r.id));
  return kept.length ? [...fresh, ...kept].sort(listOrder) : fresh;
}

const WRITTEN = new Set(["synced", "synced_draft"]);

/** A change's status once its write to Wix has landed (a draft counts). */
export function isWritten(status: unknown): boolean {
  return WRITTEN.has(String(status));
}

/**
 * A change's status once an Approve All write is over, one way or the
 * other: written, failed, or back in the queue. "approved" is not: the
 * route marks a row approved just before writing it, so the row has
 * already left the pending list while its write is still under way.
 */
export function writeSettled(status: unknown): boolean {
  return status !== undefined && status !== "approved" && status !== "approving";
}

/**
 * How many plans the bulk route wrote to Wix: a result saying synced (or
 * synced as a draft). Failed, blocked and deferred plans are still waiting
 * or went to Failed, and must not play Approve's way out.
 */
export function countWritten(results: unknown): number {
  if (!Array.isArray(results)) return 0;
  return results.filter((r) => isWritten((r as { status?: unknown } | null)?.status)).length;
}

/** What this browser has cleared from the queue on one Eastern day. */
export interface Tally {
  day: string;
  approved: number;
  rejected: number;
  removed: number;
}

const FIELD: Record<CountedExit, "approved" | "rejected" | "removed"> = {
  approve: "approved",
  reject: "rejected",
  remove: "removed",
};

export function emptyTally(day: string): Tally {
  return { day, approved: 0, rejected: 0, removed: 0 };
}

/** "2026-09-29" for the day it is in Lakewood Ranch at that moment. */
export function easternDay(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The tally kept in the browser, if it is today's; otherwise a fresh one. */
export function readTally(raw: string | null, day: string): Tally {
  try {
    const t = JSON.parse(raw ?? "null") as Partial<Tally> | null;
    const counts = [t?.approved, t?.rejected, t?.removed];
    if (t?.day === day && counts.every((n) => Number.isInteger(n) && (n as number) >= 0)) {
      return { day, approved: t.approved!, rejected: t.rejected!, removed: t.removed! };
    }
  } catch {
    // Nothing kept, or not ours: a fresh day.
  }
  return emptyTally(day);
}

/** The tally with n more plans cleared, starting over on a new day. */
export function addToTally(t: Tally | null, exit: CountedExit, n: number, day: string): Tally {
  const base = t && t.day === day ? t : emptyTally(day);
  const field = FIELD[exit];
  return { ...base, [field]: base[field] + Math.max(0, n) };
}

export function clearedIn(t: Tally | null): number {
  return t ? t.approved + t.rejected + t.removed : 0;
}

/** "12 approved · 3 rejected · 1 removed", leaving out what is nought. */
export function tallyLine(t: Tally): string {
  const parts: string[] = [];
  if (t.approved) parts.push(`${t.approved} approved`);
  if (t.rejected) parts.push(`${t.rejected} rejected`);
  if (t.removed) parts.push(`${t.removed} removed`);
  return parts.join(" · ");
}

/** How far through the queue the day has come: cleared over cleared plus waiting. */
export function progressOf(cleared: number, left: number): number {
  const all = cleared + left;
  return all > 0 ? cleared / all : 1;
}
