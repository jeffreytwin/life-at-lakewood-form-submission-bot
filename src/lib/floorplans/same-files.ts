// A picture the builder serves again from another address, byte for byte
// the same file, is the picture the record already has.
//
// Meritage serves each drawing at an address ending in "?v=" and a tag
// that keeps changing: of the 58 drawing changes put to the queue from
// Sep 30 to Oct 13, 28 put up the very file the site already showed, and
// Bluebell's changed on Oct 6 and back on Oct 9. Lennar uploads a drawing
// twice under two folders, SimplyDwell a photo twice as Buttonwood_2-2.jpg
// and Buttonwood_2.jpg (Jeff, 2026-10-13: "replacing the photo with the
// exact same photo"). No rule about addresses can call those one file
// without calling two different dens one too (photo-duplicates.ts), so the
// bytes decide: before a run proposes pictures in place of the record's,
// each replacement, as Wix holds it or else as its address serves it now
// (what approving it would put on the site), is compared with the picture
// it would replace as Wix holds it (fp_media_map.content_hash: what the
// site shows). The same file keeps the record's address, and nothing is
// proposed for it. A file that differs by a single byte is still a change,
// and so is one that cannot be fetched, or a record's picture whose bytes
// Wix never noted: nothing is skipped on a guess. The record's own address
// is never fetched to compare: Meritage serves its newest drawing whatever
// tag the address carries, so the old address would serve the new file
// and a redrawn plan would pass for the old one.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { askableBatches, fileFingerprint } from "@/lib/floorplans/media";
import { galleryOf, GALLERY_FIELDS, type CanonicalRecord, type GalleryField } from "@/lib/floorplans/diff";
import { onePerPicture, pictureKey } from "@/lib/floorplans/extractors/plan-page";
import type { NormalizedPlan } from "@/lib/floorplans/types";

/** A gallery that changed by more pictures than this is a new set, not the same files moved: not fetched. */
export const MOST_REPLACED = 12;

/** Fetches one run may make to compare files, and how long it may keep making them. */
export interface FileCheckBudget {
  left: number;
  until: number;
}

/** A run's budget: enough for a builder whose every drawing moved address, and done well before the run must end. */
export const runFileBudget = (startedAt: number): FileCheckBudget => ({ left: 48, until: startedAt + 265_000 });

/** Fetches made at once. */
const AT_ONCE = 6;

/**
 * The pictures a run would put in place of the record's: its addresses the
 * record has no picture under (pictureKey), and the record's it no longer
 * has. A home shows one picture, so only its lead is compared, as the diff
 * compares it (diff.ts); it has no drawings to compare. Pure; exported for
 * tests.
 */
export function replacedPictures(current: CanonicalRecord, plan: NormalizedPlan, field: GalleryField): { added: string[]; gone: string[] } {
  const home = plan.quickMoveIn === true;
  if (home && field === "blueprintImages") return { added: [], gone: [] };
  const before = onePerPicture(galleryOf(current, field)).photos;
  const after = onePerPicture(galleryOf(plan, field)).photos;
  const had = new Set(before.map(pictureKey));
  const has = new Set(after.map(pictureKey));
  const added = (home ? after.slice(0, 1) : after).filter((url) => !had.has(pictureKey(url)));
  const gone = (home ? before.slice(0, 1) : before).filter((url) => !has.has(pictureKey(url)));
  return { added, gone };
}

/**
 * Each added address whose file is a gone picture's file, paired with
 * that picture's address: one gone picture for one added. `hashes` gives
 * the digests known for an address (as Wix holds it, as it serves now).
 * Pure; exported for tests.
 */
export function sameFiles(added: string[], gone: string[], hashes: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  const pairs = new Map<string, string>();
  const taken = new Set<string>();
  for (const url of added) {
    const mine = new Set(hashes.get(url) ?? []);
    if (!mine.size) continue;
    const match = gone.find((old) => !taken.has(old) && (hashes.get(old) ?? []).some((h) => mine.has(h)));
    if (!match) continue;
    pairs.set(url, match);
    taken.add(match);
  }
  return pairs;
}

/**
 * The run's pictures with each address that serves the same file as one of
 * the record's spelled as the record spells it, each picture once, its
 * caption kept. Pure; exported for tests.
 */
export function spelledAsRecord(plan: NormalizedPlan, field: GalleryField, same: ReadonlyMap<string, string>): NormalizedPlan {
  const list = field === "galleryImages" ? plan.galleryImages : plan.blueprintImages ?? [];
  if (!list.some((url) => same.has(url))) return plan;
  const spelled = [...new Set(list.map((url) => same.get(url) ?? url))];
  if (field === "blueprintImages") return { ...plan, blueprintImages: spelled };
  if (!plan.galleryMeta) return { ...plan, galleryImages: spelled };
  const meta: NonNullable<NormalizedPlan["galleryMeta"]> = {};
  for (const [url, m] of Object.entries(plan.galleryMeta)) {
    const at = same.get(url) ?? url;
    if (!(at in meta)) meta[at] = m;
  }
  return { ...plan, galleryImages: spelled, galleryMeta: meta };
}

/** The digests fp_media_map keeps for these addresses: the bytes each import fetched. */
async function storedHashes(siteId: string, urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const batch of askableBatches([...new Set(urls)])) {
    const { data, error } = await supabase
      .from("fp_media_map")
      .select("source_url, content_hash")
      .eq("site_id", siteId)
      .in("source_url", batch);
    if (error) {
      logger.warn("Stored picture digests could not be read", { error: error.message });
      return out;
    }
    for (const row of data ?? []) if (row.content_hash) out.set(row.source_url, row.content_hash);
  }
  return out;
}

/** The digests of these addresses as they serve now, as many as the budget allows; an address not fetched has none. */
async function freshHashes(urls: string[], budget: FileCheckBudget, fingerprint: (url: string) => Promise<string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const queue = [...new Set(urls)];
  while (queue.length && budget.left > 0 && Date.now() < budget.until) {
    const wave = queue.splice(0, Math.min(AT_ONCE, budget.left));
    budget.left -= wave.length;
    const got = await Promise.all(wave.map(async (url) => [url, await fingerprint(url)] as const));
    for (const [url, hash] of got) if (hash) out.set(url, hash);
  }
  return out;
}

/**
 * The run's plan with every replacement that is the same file as the
 * picture it replaces spelled as the record spells that picture, so the
 * diff proposes nothing for it (replacedPictures, sameFiles). The record's
 * pictures are compared only as Wix holds them; a replacement Wix has not
 * imported is fetched. A picture that cannot be fetched, or a run out of
 * budget, leaves the plan as it was.
 */
export async function withSameFilesAsRecord(
  current: CanonicalRecord,
  plan: NormalizedPlan,
  siteId: string,
  budget: FileCheckBudget,
  fingerprint: (url: string) => Promise<string | null> = (url) => fileFingerprint(url)
): Promise<NormalizedPlan> {
  let out = plan;
  for (const [field] of GALLERY_FIELDS) {
    if ((current.userEditedFields ?? []).includes(field)) continue;
    const { added, gone } = replacedPictures(current, out, field);
    if (!added.length || !gone.length || added.length > MOST_REPLACED) continue;
    if (budget.left <= 0 || Date.now() >= budget.until) break;
    const stored = await storedHashes(siteId, [...added, ...gone]);
    // Nothing to compare with: the record's pictures' bytes were never noted.
    if (!gone.some((url) => stored.has(url))) continue;
    const hashes = new Map<string, string[]>();
    const note = (found: Map<string, string>) => {
      for (const [url, hash] of found) hashes.set(url, [...(hashes.get(url) ?? []), hash]);
    };
    note(stored);
    note(await freshHashes(added.filter((url) => !hashes.has(url)), budget, fingerprint));
    const same = sameFiles(added, gone, hashes);
    if (!same.size) continue;
    logger.info("Pictures at new addresses are the files the record has; kept under the record's", {
      planKey: plan.planKey,
      field,
      same: [...same].map(([now, was]) => ({ now, was })),
    });
    out = spelledAsRecord(out, field, same);
  }
  return out;
}
