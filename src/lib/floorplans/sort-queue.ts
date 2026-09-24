// Sorting the photos waiting for review by what they show.
//
// A builder's file names say nothing about most of its pictures — a media
// store's id, "4638-8-scaled-1.webp" — so a gallery came back for review in
// page order and was put right by hand, or by the Sort button in the edit
// overlay (Jeff, 2026-09-23: sorting was one of the five things that went
// wrong every time a builder was turned on). This does what the button
// does, in the background, for every change waiting in the queue: the
// pictures nobody has looked at yet are looked at (photo-rooms.ts, once
// per picture, ever), and each waiting gallery is put in the site's order.
//
// The run that queues the change does not do this itself: looking at
// thirty pictures takes longer than a run can spare. The next run reads
// the same remembered answers (sync.ts), so the order it proposes is the
// order the queue already shows, and a builder whose photos have been
// looked at once comes in sorted from then on.
//
// Every photo of every waiting gallery is looked at, and as many as a tick
// has time for rather than a set few: Neal's three communities queued two
// thousand photos in one morning, ninety a quarter-hour sorted them in
// five hours, and they were sorted by hand in the meantime (Jeff,
// 2026-09-24). A gallery is marked sorted once all of its photos have
// been looked at, and the queue says which are still waiting.
//
// Each waiting gallery is also checked once for one photograph shown
// twice, by its pixels (photo-duplicates.ts, identicalPhotos), as the Sort
// button checks it: a copy at another address no rule pairs is gone
// before anyone opens the gallery (Jeff, 2026-09-24: Neal's galleries
// were put right one by one with the button).

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { labelPhotos, rememberedRooms, withLookedAtRooms } from "@/lib/floorplans/photo-rooms";
import { identicalPhotos, withoutDuplicates } from "@/lib/floorplans/photo-duplicates";
import type { NormalizedPlan } from "@/lib/floorplans/types";

/** Pictures asked about at once here, where nobody is waiting on each answer (the Sort button asks three at a time). */
const PARALLEL = 8;

/** Pictures looked at in one go: one request for each of PARALLEL, fifteen pictures apiece. */
const WAVE = PARALLEL * 15;

/** No wave of looking is begun past this far into a tick, leaving time to check for copies and write. */
const LOOK_UNTIL_MS = 150_000;

/** No gallery is begun checking for copies past this far into a tick: the route has 300 seconds. */
const CHECK_COPIES_UNTIL_MS = 200_000;

interface QueuedRow {
  id: string;
  updated_at: string | null;
  proposed_record: NormalizedPlan | null;
}

/**
 * Whether a waiting change's gallery is still to be sorted: nobody's hand
 * on it, and not every photo of it looked at and put in order yet. A
 * gallery a builder captions is sorted too, so what the sites show is what
 * its photos show, not what the builder called them. Exported for tests.
 */
export function wantsSorting(record: NormalizedPlan | null): record is NormalizedPlan {
  return handsOff(record) && !record.photosSorted;
}

/** Whether a waiting change's gallery is still to be checked for a photograph shown twice. Exported for tests. */
export function wantsCopiesChecked(record: NormalizedPlan | null): record is NormalizedPlan {
  return handsOff(record) && !record.copiesChecked;
}

/**
 * The gallery with each photograph once (withoutDuplicates), marked as
 * checked, and the captions of the pictures taken out dropped. Pure;
 * exported for tests.
 */
export function withCopiesTakenOut(record: NormalizedPlan, same: number[][]): { record: NormalizedPlan; removed: string[] } {
  const once = withoutDuplicates(record.galleryImages, same);
  const kept = new Set(once.urls);
  const galleryMeta = record.galleryMeta
    ? Object.fromEntries(Object.entries(record.galleryMeta).filter(([url]) => kept.has(url)))
    : record.galleryMeta;
  return { record: { ...record, galleryImages: once.urls, galleryMeta, copiesChecked: true }, removed: once.removed };
}

/** A waiting gallery of two pictures or more that nobody has arranged by hand. Exported for tests. */
export function handsOff(record: NormalizedPlan | null): record is NormalizedPlan {
  if (!record || !Array.isArray(record.galleryImages) || record.galleryImages.length < 2) return false;
  return !(record.userEditedFields ?? []).includes("galleryImages");
}

export async function sortQueuedPhotos(): Promise<{ rows: number; looked: number; sorted: number; checked: number; removed: number }> {
  const started = Date.now();
  const { data, error } = await supabase
    .from("fp_pending_changes")
    .select("id, updated_at, proposed_record")
    .eq("status", "pending")
    .in("change_type", ["add", "update"])
    .not("proposed_record", "is", null)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(`queued changes: ${error.message}`);
  const rows = ((data ?? []) as QueuedRow[]).filter((r) => wantsSorting(r.proposed_record) || wantsCopiesChecked(r.proposed_record));
  if (!rows.length) return { rows: 0, looked: 0, sorted: 0, checked: 0, removed: 0 };

  // The pictures nobody has looked at, oldest change first, so the
  // galleries finish one after another; looked at a wave at a time while
  // the tick has time. A wave whose request failed is looked at again on
  // a later tick (photo-rooms.ts).
  const all = [...new Set(rows.flatMap((r) => r.proposed_record!.galleryImages))];
  const known = await rememberedRooms(all);
  const fresh = all.filter((url) => !known.has(url));
  let looked = 0;
  for (let i = 0; i < fresh.length && Date.now() - started < LOOK_UNTIL_MS; i += WAVE) {
    const wave = fresh.slice(i, i + WAVE);
    for (const [url, label] of await labelPhotos(wave, PARALLEL)) known.set(url, label);
    looked += wave.length;
  }

  // Each waiting gallery is checked for copies while the tick has time,
  // and put in order once its pictures have all been looked at. Written
  // only if the row has not changed since it was read, so a person saving
  // the same change in the Hub at that moment wins.
  let sorted = 0;
  let checked = 0;
  let removed = 0;
  for (const row of rows) {
    let record = row.proposed_record!;
    let copies: string[] | null = null;
    let reordered = false;
    if (wantsCopiesChecked(record) && Date.now() - started < CHECK_COPIES_UNTIL_MS) {
      try {
        const once = withCopiesTakenOut(record, await identicalPhotos(record.galleryImages));
        record = once.record;
        copies = once.removed;
      } catch (checkError) {
        // Checked on a later tick.
        logger.warn("A waiting gallery could not be checked for copies", {
          id: row.id,
          error: checkError instanceof Error ? checkError.message : String(checkError),
        });
      }
    }
    if (wantsSorting(record) && record.galleryImages.every((url) => known.has(url))) {
      const next = withLookedAtRooms(record, known);
      record = { ...record, galleryImages: next.galleryImages, galleryMeta: next.galleryMeta, photosSorted: true };
      reordered = true;
    }
    if (!copies && !reordered) continue;
    let update = supabase
      .from("fp_pending_changes")
      .update({ proposed_record: record, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    update = row.updated_at ? update.eq("updated_at", row.updated_at) : update.is("updated_at", null);
    const { error: writeError } = await update;
    if (writeError) {
      logger.warn("A waiting gallery could not be sorted", { id: row.id, error: writeError.message });
      continue;
    }
    if (reordered) sorted += 1;
    if (copies) {
      checked += 1;
      removed += copies.length;
    }
  }
  logger.info("Waiting galleries sorted by what their photos show", { rows: rows.length, fresh: fresh.length, looked, sorted, checked, removed });
  return { rows: rows.length, looked, sorted, checked, removed };
}
