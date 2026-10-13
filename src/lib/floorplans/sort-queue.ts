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
import { identicalPhotos, samePhotos, withoutDuplicates } from "@/lib/floorplans/photo-duplicates";
import { galleryOf, samePictures, type CanonicalRecord } from "@/lib/floorplans/diff";
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
  change_type: string;
  field_changed: string | null;
  site_id: string;
  community_id: string;
  builder_id: string;
  plan_key: string;
}

/**
 * Whether a waiting photos change would write the photos the live plan
 * shows already: the same pictures in the same order (diff.ts,
 * samePictures), and for a home its lead, the one picture its row shows.
 * Pure; exported for tests.
 */
export function writesWhatIsLive(live: Partial<NormalizedPlan> | null | undefined, proposed: NormalizedPlan): boolean {
  if (!live) return false;
  const before = galleryOf(live as CanonicalRecord, "galleryImages");
  const after = galleryOf(proposed as CanonicalRecord, "galleryImages");
  if (!before.length || !after.length) return false;
  const home = proposed.quickMoveIn === true;
  return samePictures(home ? before.slice(0, 1) : before, home ? after.slice(0, 1) : after);
}

/**
 * Whether checking a waiting photos change for copies, and sorting it, left
 * it writing what the live plan shows: a change that was one until this
 * tick and is nothing now. Neal's 17810 Sylvester Drive came up as
 * "1 photo → 1 photo" four times between Oct 6 and Oct 12: the builder had
 * put up its rendering again under a new name, the copy check took the new
 * one out and put the original back in front, and every approval wrote the
 * photo that was already there (Jeff, 2026-10-13: "nothing in the UI
 * suggests that the photo is any different"). A change that wrote what is
 * live before the tick touched it — a gallery written whole again because
 * Wix never had a picture of it (pictures-on-wix.ts) — is left be. Pure;
 * exported for tests.
 */
export function cleanedToNothing(live: Partial<NormalizedPlan> | null | undefined, queued: NormalizedPlan, cleaned: NormalizedPlan): boolean {
  return !writesWhatIsLive(live, queued) && writesWhatIsLive(live, cleaned);
}

/** The live plan a waiting change is for. */
async function livePlanOf(row: QueuedRow): Promise<{ id: string; record: NormalizedPlan } | null> {
  const { data, error } = await supabase
    .from("fp_floor_plans")
    .select("id, record")
    .match({ site_id: row.site_id, community_id: row.community_id, builder_id: row.builder_id, plan_key: row.plan_key })
    .is("removed_at", null)
    .maybeSingle();
  if (error || !data?.record) return null;
  return data as { id: string; record: NormalizedPlan };
}

/**
 * The copies a withdrawn change's check took out, remembered with the live
 * plan, so the next run spells them as the photo they copy and proposes
 * nothing for them (pictures.ts, withKnownSpellings). Added in place
 * (fp_remember_copies, migration 080): nothing else in the record is
 * written, so a change to it made meanwhile stands. Not remembered, the
 * next run proposes the change again and this check withdraws it again.
 */
async function rememberCopies(live: { id: string; record: NormalizedPlan }, copies: Record<string, string> | undefined): Promise<void> {
  const known = live.record.copiesOf ?? {};
  const added = Object.entries(copies ?? {}).filter(([copy, original]) => known[copy] !== original);
  if (!added.length) return;
  const { error } = await supabase.rpc("fp_remember_copies", { plan_id: live.id, copies: Object.fromEntries(added) });
  if (error) logger.warn("Copies taken out could not be remembered with the plan", { id: live.id, error: error.message });
}

/**
 * Galleries this small are left in the order the run gave them, and their
 * photos are not looked at: a look is a model's read of every picture,
 * and five pictures are put right at a glance (Jeff, 2026-09-26).
 */
export const FEW_PHOTOS = 5;

/**
 * Whether a waiting change's gallery is still to be sorted: more than a few
 * photos, nobody's hand on it, and not every photo of it looked at and put
 * in order yet. A gallery a builder captions is sorted too, so what the
 * sites show is what its photos show, not what the builder called them.
 * Exported for tests.
 */
export function wantsSorting(record: NormalizedPlan | null): record is NormalizedPlan {
  return handsOff(record) && record.galleryImages.length > FEW_PHOTOS && !record.photosSorted;
}

/** Whether a waiting change's gallery is still to be checked for a photograph shown twice. Exported for tests. */
export function wantsCopiesChecked(record: NormalizedPlan | null): record is NormalizedPlan {
  return handsOff(record) && !record.copiesChecked;
}

/**
 * The gallery with each photograph once (withoutDuplicates), marked as
 * checked, the captions of the pictures taken out dropped, and each one
 * taken out remembered with the photo kept in its place. Pure; exported
 * for tests.
 */
export function withCopiesTakenOut(record: NormalizedPlan, same: number[][]): { record: NormalizedPlan; removed: string[] } {
  const once = withoutDuplicates(record.galleryImages, same);
  const kept = new Set(once.urls);
  const galleryMeta = record.galleryMeta
    ? Object.fromEntries(Object.entries(record.galleryMeta).filter(([url]) => kept.has(url)))
    : record.galleryMeta;
  // Remembered with the record, so the next run's reading of a copy is
  // not proposed as a new photo (Jeff, 2026-09-28: WestBay's single-photo
  // additions were the copies this took out, back again the next night).
  const copiesOf = { ...(record.copiesOf ?? {}), ...once.copyOf };
  return {
    record: { ...record, galleryImages: once.urls, galleryMeta, copiesChecked: true, ...(Object.keys(copiesOf).length ? { copiesOf } : {}) },
    removed: once.removed,
  };
}

/**
 * A waiting gallery sorted now, the way the Sort button sorts one — each
 * photograph once, as Claude and the pixels find them (samePhotos), then
 * in the order the sites show rooms in — and marked sorted and checked, as
 * the background sort marks one. Not a hand edit: the next run may still
 * propose the builder's new photos (Jeff, 2026-09-28: sorting the ticked
 * plans from the queue at once).
 */
export async function sortGalleryNow(record: NormalizedPlan): Promise<{ record: NormalizedPlan; removed: string[]; placed: number }> {
  const once = withCopiesTakenOut(record, (await samePhotos(record.galleryImages)).same);
  const labels = await labelPhotos(once.record.galleryImages);
  const next = withLookedAtRooms(once.record, labels);
  return {
    record: { ...once.record, galleryImages: next.galleryImages, galleryMeta: next.galleryMeta, photosSorted: true },
    removed: once.removed,
    placed: once.record.galleryImages.filter((url) => labels.get(url)).length,
  };
}

/** A waiting gallery of two pictures or more that nobody has arranged by hand. Exported for tests. */
export function handsOff(record: NormalizedPlan | null): record is NormalizedPlan {
  if (!record || !Array.isArray(record.galleryImages) || record.galleryImages.length < 2) return false;
  return !(record.userEditedFields ?? []).includes("galleryImages");
}

export async function sortQueuedPhotos(): Promise<{ rows: number; looked: number; sorted: number; checked: number; removed: number; withdrawn: number }> {
  const started = Date.now();
  const { data, error } = await supabase
    .from("fp_pending_changes")
    .select("id, updated_at, proposed_record, change_type, field_changed, site_id, community_id, builder_id, plan_key")
    .eq("status", "pending")
    .in("change_type", ["add", "update"])
    .not("proposed_record", "is", null)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(`queued changes: ${error.message}`);
  const rows = ((data ?? []) as QueuedRow[]).filter((r) => wantsSorting(r.proposed_record) || wantsCopiesChecked(r.proposed_record));
  if (!rows.length) return { rows: 0, looked: 0, sorted: 0, checked: 0, removed: 0, withdrawn: 0 };

  // The pictures nobody has looked at, oldest change first, so the
  // galleries finish one after another; looked at a wave at a time while
  // the tick has time. A wave whose request failed is looked at again on
  // a later tick (photo-rooms.ts).
  // Only the galleries to be sorted: one waiting only to be checked for
  // copies costs no look.
  const all = [...new Set(rows.filter((r) => wantsSorting(r.proposed_record)).flatMap((r) => r.proposed_record!.galleryImages))];
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
  let withdrawn = 0;
  for (const row of rows) {
    const queued = row.proposed_record!;
    let record = queued;
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
    // A photos change the check and the sort left writing what the plan
    // shows already is no change: it leaves the queue rather than wait for
    // an approval that writes nothing, and the copies it found stay with
    // the plan (cleanedToNothing). Only if the row has not changed since it
    // was read, so a person working on it wins.
    if (row.change_type === "update" && row.field_changed === "photos") {
      const live = await livePlanOf(row);
      if (live && cleanedToNothing(live.record, queued, record)) {
        let withdraw = supabase.from("fp_pending_changes").delete().eq("id", row.id).eq("status", "pending");
        withdraw = row.updated_at ? withdraw.eq("updated_at", row.updated_at) : withdraw.is("updated_at", null);
        const { data: gone, error: withdrawError } = await withdraw.select("id");
        if (withdrawError) {
          logger.warn("A photos change that writes nothing could not be withdrawn", { id: row.id, error: withdrawError.message });
        } else if (gone?.length) {
          await rememberCopies(live, record.copiesOf);
          withdrawn += 1;
          logger.info("Withdrew a photos change that would write the photos the plan shows already", { id: row.id, planKey: row.plan_key });
          continue;
        }
      }
    }
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
  logger.info("Waiting galleries sorted by what their photos show", { rows: rows.length, fresh: fresh.length, looked, sorted, checked, removed, withdrawn });
  return { rows: rows.length, looked, sorted, checked, removed, withdrawn };
}
