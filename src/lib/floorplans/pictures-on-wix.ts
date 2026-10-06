// Which of a live plan's pictures are on Wix, and an update for the ones
// that are not.
//
// A row is written with every picture its record lists, or not at all
// (writeback.ts, PicturesMissing), but that rule is newer than many rows:
// SimplyDwell's Olivia went up without its eighth photo and Neal's Bright
// Star without its drawing, and every plan with more than forty photos
// went up with its first forty, the cap then (Jeff, 2026-10-06). Their
// records list those pictures all the same, so a run finds nothing
// changed. A picture is on Wix once Wix has been seen holding it
// (fp_media_map.verified_at), which every picture a row carries has been;
// one the record lists that Wix has never held is proposed as a photos
// update, and approving it writes the plan whole.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { askableBatches } from "@/lib/floorplans/media";
import { describeGallery, galleryOf, GALLERY_FIELDS, type CanonicalRecord, type FieldChange } from "@/lib/floorplans/diff";

/**
 * The most photos, and the most drawings, a row carries. Raised from forty
 * (Jeff, 2026-10-06): twenty live plans had more, up to seventy.
 */
export const MAX_GALLERY_IMAGES = 80;

/** The pictures among these that Wix has been seen holding for the site. */
export async function picturesOnWix(siteId: string, urls: string[]): Promise<Set<string>> {
  const wanted = urls.filter((url, i) => url && urls.indexOf(url) === i);
  const held = new Set<string>();
  for (const batch of askableBatches(wanted)) {
    const { data, error } = await supabase
      .from("fp_media_map")
      .select("source_url")
      .eq("site_id", siteId)
      .not("verified_at", "is", null)
      .in("source_url", batch);
    // A question that fails says nothing: the plan is left as it is rather
    // than every picture proposed as missing.
    if (error) {
      logger.warn("Pictures on Wix could not be read", { error: error.message });
      return new Set(wanted);
    }
    for (const row of data ?? []) held.add(row.source_url);
  }
  return held;
}

/** The pictures a record would put on its row: its photos and its drawings, each up to the cap. */
export function listedPictures(record: CanonicalRecord): string[] {
  return GALLERY_FIELDS.flatMap(([field]) => galleryOf(record, field).slice(0, MAX_GALLERY_IMAGES));
}

/**
 * A photos (or drawings) update for each gallery of a live base plan that
 * lists a picture Wix has never held, unless the run already proposes that
 * gallery. The old value is what is on Wix, the new one the whole list, so
 * a rejection holds against the same list and a different one comes back.
 * A quick move-in shows one picture, and a row is never written without
 * it, so it has none missing. Pure; exported for tests.
 */
export function unwrittenPictureChanges(record: CanonicalRecord, onWix: Set<string>, proposed: Set<string>): FieldChange[] {
  if (record.quickMoveIn === true) return [];
  const changes: FieldChange[] = [];
  for (const [field, label] of GALLERY_FIELDS) {
    if (proposed.has(label)) continue;
    const listed = galleryOf(record, field).slice(0, MAX_GALLERY_IMAGES);
    const held = listed.filter((url) => onWix.has(url));
    if (held.length === listed.length) continue;
    changes.push({ field, label, oldValue: describeGallery(held, label), newValue: describeGallery(listed, label) });
  }
  return changes;
}
