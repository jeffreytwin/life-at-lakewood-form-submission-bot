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
// order the queue already shows.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { labelPhotos, leadsWithARoom, mostlyPlaced, rememberedRooms, withLookedAtRooms } from "@/lib/floorplans/photo-rooms";
import type { NormalizedPlan } from "@/lib/floorplans/types";

/** Pictures looked at per tick: a few requests, so a tick is cheap and quick. */
const PHOTOS_PER_TICK = 90;

interface QueuedRow {
  id: string;
  updated_at: string | null;
  proposed_record: NormalizedPlan | null;
}

/**
 * Whether a waiting change's gallery is one this should sort: photos to
 * sort, or a room leading an outside view (sorted before the rule that
 * puts the house in front; Pulte's homes, 2026-09-23), and nobody's hand
 * on it. Exported for tests.
 */
export function wantsSorting(record: NormalizedPlan | null): record is NormalizedPlan {
  return handsOff(record) && (!mostlyPlaced(record) || leadsWithARoom(record));
}

/** A waiting gallery of two pictures or more that nobody has arranged by hand. Exported for tests. */
export function handsOff(record: NormalizedPlan | null): record is NormalizedPlan {
  if (!record || !Array.isArray(record.galleryImages) || record.galleryImages.length < 2) return false;
  return !(record.userEditedFields ?? []).includes("galleryImages");
}

export async function sortQueuedPhotos(): Promise<{ rows: number; looked: number; sorted: number }> {
  const { data, error } = await supabase
    .from("fp_pending_changes")
    .select("id, updated_at, proposed_record")
    .eq("status", "pending")
    .in("change_type", ["add", "update"])
    .not("proposed_record", "is", null)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(`queued changes: ${error.message}`);
  // A gallery worth sorting, or one whose lead picture nobody has looked
  // at: the lead is the one picture a quick move-in shows, and a builder's
  // feed can rank a graphic first (Pulte's "Peace of Mind", 2026-09-23).
  const candidates = ((data ?? []) as QueuedRow[]).filter((r) => handsOff(r.proposed_record));
  const leads = await rememberedRooms(candidates.map((r) => r.proposed_record!.galleryImages[0]).filter(Boolean));
  const rows = candidates.filter((r) => wantsSorting(r.proposed_record) || !leads.has(r.proposed_record!.galleryImages[0]));
  if (!rows.length) return { rows: 0, looked: 0, sorted: 0 };

  // The pictures nobody has looked at, oldest change first, up to the tick's share.
  const all = [...new Set(rows.flatMap((r) => r.proposed_record!.galleryImages))];
  const remembered = await rememberedRooms(all);
  const fresh: string[] = [];
  for (const row of rows) {
    for (const url of row.proposed_record!.galleryImages) {
      if (!remembered.has(url) && !fresh.includes(url)) fresh.push(url);
    }
    if (fresh.length >= PHOTOS_PER_TICK) break;
  }
  const looked = fresh.length ? await labelPhotos(fresh.slice(0, PHOTOS_PER_TICK)) : new Map();
  const known = new Map([...remembered, ...looked]);

  // Each waiting gallery whose pictures have all been looked at is put in
  // order. Written only if the row has not changed since it was read, so a
  // person saving the same change in the Hub at that moment wins.
  let sorted = 0;
  for (const row of rows) {
    const record = row.proposed_record!;
    if (!record.galleryImages.every((url) => known.has(url))) continue;
    const next = withLookedAtRooms(record, known);
    if (next.galleryImages.join("\n") === record.galleryImages.join("\n")) continue;
    let update = supabase
      .from("fp_pending_changes")
      .update({ proposed_record: { ...record, galleryImages: next.galleryImages, galleryMeta: next.galleryMeta }, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    update = row.updated_at ? update.eq("updated_at", row.updated_at) : update.is("updated_at", null);
    const { error: writeError } = await update;
    if (writeError) {
      logger.warn("A waiting gallery could not be sorted", { id: row.id, error: writeError.message });
      continue;
    }
    sorted += 1;
  }
  logger.info("Waiting galleries sorted by what their photos show", { rows: rows.length, looked: fresh.length, sorted });
  return { rows: rows.length, looked: Math.min(fresh.length, PHOTOS_PER_TICK), sorted };
}
