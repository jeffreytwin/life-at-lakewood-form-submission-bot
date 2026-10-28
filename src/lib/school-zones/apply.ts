// Apply all (Jeff, 2026-10-28: "well over 50 of them on this most recent
// scan"): every school zones alert Apply can write is queued at once and
// written by the server in the background, so the page can be left. The
// queue is a mark on each alert's detail, which the page reads to show
// what is still being written and what could not be. Pure, for the page
// and the server alike.

import type { SchoolZonesDetail } from "@/lib/school-zones/scan";

/** A queue mark older than any function lives is a run that was cut off: Apply all may take it again. */
export const APPLY_STALE_MS = 15 * 60_000;

/** Apply can write it: a row in a site's collection, with a school to change. */
export function canApplySchools(detail: SchoolZonesDetail): boolean {
  return detail.source === "collection" && Boolean(detail.wixItemId) && (detail.levels ?? []).some((l) => l.verdict !== "same");
}

/** Apply all has it and is still writing it. */
export function applyQueued(detail: SchoolZonesDetail, now = Date.now()): boolean {
  return Boolean(detail.applyQueuedAt) && now - new Date(detail.applyQueuedAt!).getTime() < APPLY_STALE_MS;
}
