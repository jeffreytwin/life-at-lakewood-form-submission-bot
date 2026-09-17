// Pre-cutover audit of a site: are the photos the engine wrote all in the
// site's Media Manager folder, and does its collection hold rows the engine
// does not own? Built for Life At Parrish, whose old listing photos are to be
// purged by folder once the engine's set is live: the purge is only safe if
// every engine photo sits in the named folder and every row the engine will
// not carry is gone from the live collection.
//
// The report is read-only. Deleting stale rows is a separate, explicit call
// and only ever against the site's *target* collection, so nothing can be
// removed from the live collection while the site is still in shadow.

import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/shared/errors";
import { bulkRemoveItems, listMediaFiles, mediaState, queryAllItems, WIX_MEDIA_ROOT, type WixDataItem } from "@/lib/wix/client";
import { wixFileId } from "@/lib/listings/normalize";
import { selectAll, setSiteMediaScanOffset } from "@/lib/listings/db";
import { HubError } from "@/lib/listings/hub";
import type { LsSite } from "@/lib/listings/types";

const SAMPLE = 25;

export interface FolderAudit {
  configured: boolean;
  resolved: boolean;
  /** Files Wix lists in the folder (0 when not configured or not resolved). */
  filesInFolder: number;
  /** True when the folder listing stopped at the paging cap. */
  listingTruncated: boolean;
  /** Distinct Media Manager file ids the engine holds for this site. */
  engineFiles: number;
  engineFilesInFolder: number;
  /** Engine file ids Wix does not list in the folder (a sample, and the count). */
  outsideFolder: string[];
  outsideFolderCount: number;
  /** Files in the folder the engine does not know (older imports, manual uploads). */
  unknownInFolder: number;
  /** Engine files Wix holds no picture for: the import call succeeded but its fetch did not. */
  brokenFiles: number;
  /** Engine files Wix is still processing; they may yet come good. */
  pendingFiles: number;
}

/** How much of a folder may look broken before the engine assumes it is misreading Wix, not Wix failing. */
export const BROKEN_SHARE_CAP = 0.35;

export interface ReimportResult {
  /** Engine files Wix holds no picture for. */
  broken: number;
  /** Photo records cleared, so the next photo pass imports them again. */
  cleared: number;
  /** Listings whose gallery is rewritten once the photos are back. */
  listings: number;
  /** Set when the share of broken files was too high to be believed; nothing was cleared. */
  refused: string | null;
  /** The folder listing ran out of time or pages; the rest waits for the next pass. */
  truncated?: boolean;
}

export interface StaleRow {
  id: string;
  address: string | null;
  status: string | null;
}

export interface CollectionAudit {
  collectionId: string;
  role: "target" | "live";
  /** Whether stale rows here may be deleted from the Hub (only the target collection). */
  deletable: boolean;
  items: number;
  /** Rows whose _id the engine owns (written by it, or a removal it has pending). */
  owned: number;
  stale: StaleRow[];
  staleCount: number;
  /** Engine rows with a Wix item id the collection does not hold (the engine thinks it wrote them). */
  missing: number;
  /** Gallery items across the collection, and how many reference a file outside the folder (null without a resolved folder). */
  galleryItems: number;
  galleryOutsideFolder: number | null;
  galleryNotWixImage: number;
}

export interface SiteAuditReport {
  generatedAt: string;
  site: Pick<LsSite, "id" | "name" | "domain" | "write_mode" | "target_collection_id" | "live_collection_id" | "media_folder_name" | "media_folder_id">;
  folder: FolderAudit;
  collections: CollectionAudit[];
  /** True when every engine photo is in the folder, no collection gallery points outside it, and the target holds no stale row. */
  clean: boolean;
}

/** Pure: engine file ids against the folder's. */
export function compareFolder(engineFileIds: Iterable<string>, folderFileIds: Iterable<string>): Pick<FolderAudit, "engineFiles" | "engineFilesInFolder" | "outsideFolder" | "outsideFolderCount" | "unknownInFolder"> {
  const engine = new Set(engineFileIds);
  const folder = new Set(folderFileIds);
  const outside: string[] = [];
  let inFolder = 0;
  for (const id of engine) {
    if (folder.has(id)) inFolder += 1;
    else outside.push(id);
  }
  let unknown = 0;
  for (const id of folder) if (!engine.has(id)) unknown += 1;
  outside.sort();
  return { engineFiles: engine.size, engineFilesInFolder: inFolder, outsideFolder: outside.slice(0, SAMPLE), outsideFolderCount: outside.length, unknownInFolder: unknown };
}

interface GalleryLike {
  src?: unknown;
}

/** Pure: a collection's rows against the ids the engine owns, and its galleries against the folder. */
export function compareCollection(
  items: Array<{ id: string; data: Record<string, unknown> }>,
  ownedIds: Iterable<string>,
  folderFileIds: Iterable<string> | null
): Pick<CollectionAudit, "items" | "owned" | "stale" | "staleCount" | "missing" | "galleryItems" | "galleryOutsideFolder" | "galleryNotWixImage"> {
  const owned = new Set(ownedIds);
  const folder = folderFileIds ? new Set(folderFileIds) : null;
  const present = new Set<string>();
  const stale: StaleRow[] = [];
  let ownedCount = 0;
  let galleryItems = 0;
  let galleryOutside = 0;
  let notWixImage = 0;
  for (const item of items) {
    const id = typeof item.data._id === "string" ? item.data._id : item.id;
    present.add(id);
    if (owned.has(id)) ownedCount += 1;
    else {
      stale.push({
        id,
        address: typeof item.data.propertyAddress === "string" ? item.data.propertyAddress : null,
        status: typeof item.data.standardStatus === "string" ? item.data.standardStatus : null,
      });
    }
    const gallery = Array.isArray(item.data.listingImageGallery) ? (item.data.listingImageGallery as GalleryLike[]) : [];
    for (const g of gallery) {
      galleryItems += 1;
      const fileId = typeof g?.src === "string" ? wixFileId(g.src) : null;
      if (!fileId) {
        notWixImage += 1;
        continue;
      }
      if (folder && !folder.has(fileId)) galleryOutside += 1;
    }
  }
  let missing = 0;
  for (const id of owned) if (!present.has(id)) missing += 1;
  stale.sort((a, b) => a.id.localeCompare(b.id));
  return {
    items: items.length,
    owned: ownedCount,
    stale: stale.slice(0, SAMPLE),
    staleCount: stale.length,
    missing,
    galleryItems,
    galleryOutsideFolder: folder ? galleryOutside : null,
    galleryNotWixImage: notWixImage,
  };
}

async function loadSite(siteId: string): Promise<LsSite> {
  const { data, error } = await supabase.from("ls_sites").select("*").eq("id", siteId).maybeSingle();
  if (error) throw new HubError(`load site: ${errorMessage(error)}`, 500);
  if (!data) throw new HubError("Site not found", 404);
  return data as LsSite;
}

/** The _ids the engine owns in the site's collection: rows it wrote, and removals it has still to apply. */
async function loadOwnedIds(siteId: string): Promise<string[]> {
  const rows = await selectAll<{ wix_item_id: string | null }>("load owned rows", (from, to) =>
    supabase.from("ls_site_listings").select("wix_item_id").eq("site_id", siteId).not("wix_item_id", "is", null).order("id").range(from, to)
  );
  return rows.map((r) => r.wix_item_id).filter((id): id is string => !!id);
}

async function loadEngineFileIds(siteId: string): Promise<string[]> {
  const rows = await selectAll<{ wix_file_id: string | null; wix_image_uri: string }>("load site media files", (from, to) =>
    supabase.from("ls_site_media").select("wix_file_id, wix_image_uri").eq("site_id", siteId).order("id").range(from, to)
  );
  return rows.map((r) => r.wix_file_id ?? wixFileId(r.wix_image_uri)).filter((id): id is string => !!id);
}

/**
 * How long the audit gives the folder listing before settling for what it
 * has. The route is capped at AUDIT_MAX_DURATION_MS and the collection
 * queries still have to run after this, so the walk cannot simply have the
 * lot: Parrish's folder passed 20,000 files -- over 200 sequential Wix
 * requests -- and the whole request began returning 504, which is no report
 * at all. A partial listing is already a first-class outcome here
 * (listingTruncated), so the honest failure is to say how far it got.
 */
export const AUDIT_FOLDER_BUDGET_MS = 55_000;

export async function auditSite(siteId: string, now: number = Date.now()): Promise<SiteAuditReport> {
  const site = await loadSite(siteId);
  if (!site.wix_site_id) throw new HubError(`${site.name} has no wix_site_id`, 409);

  const folder: FolderAudit = {
    configured: !!site.media_folder_name,
    resolved: !!site.media_folder_id,
    filesInFolder: 0,
    listingTruncated: false,
    engineFiles: 0,
    engineFilesInFolder: 0,
    outsideFolder: [],
    outsideFolderCount: 0,
    unknownInFolder: 0,
    brokenFiles: 0,
    pendingFiles: 0,
  };
  let folderFileIds: string[] | null = null;
  if (site.media_folder_id) {
    // From the start, not from the shared cursor: this is a person asking
    // about the whole library, and scanWindow explains why (see below).
    const listing = await listMediaFiles(site.wix_site_id, site.media_folder_id, {
      deadline: now + AUDIT_FOLDER_BUDGET_MS,
    });
    folderFileIds = listing.files.map((f) => f.id);
    folder.filesInFolder = folderFileIds.length;
    folder.listingTruncated = listing.truncated;
    const engineIds = new Set(await loadEngineFileIds(site.id));
    for (const file of listing.files) {
      if (!engineIds.has(file.id)) continue;
      const state = mediaState(file);
      if (state === "broken") folder.brokenFiles += 1;
      else if (state === "pending") folder.pendingFiles += 1;
    }
    Object.assign(folder, compareFolder(engineIds, folderFileIds));
  } else {
    folder.engineFiles = new Set(await loadEngineFileIds(site.id)).size;
  }

  const owned = await loadOwnedIds(site.id);
  const collections: CollectionAudit[] = [];
  const ids = [site.target_collection_id, ...(site.live_collection_id !== site.target_collection_id ? [site.live_collection_id] : [])];
  for (const collectionId of ids) {
    const items: WixDataItem[] = await queryAllItems(site.wix_site_id, collectionId);
    const role = collectionId === site.target_collection_id ? "target" : "live";
    collections.push({
      collectionId,
      role,
      deletable: role === "target",
      ...compareCollection(items.map((i) => ({ id: i.id, data: i.data as Record<string, unknown> })), owned, folderFileIds),
    });
  }

  const target = collections.find((c) => c.role === "target");
  const clean =
    folder.configured &&
    folder.resolved &&
    !folder.listingTruncated &&
    folder.outsideFolderCount === 0 &&
    collections.every((c) => (c.galleryOutsideFolder ?? 0) === 0) &&
    (target?.staleCount ?? 0) === 0;

  return {
    generatedAt: new Date().toISOString(),
    site: {
      id: site.id,
      name: site.name,
      domain: site.domain,
      write_mode: site.write_mode,
      target_collection_id: site.target_collection_id,
      live_collection_id: site.live_collection_id,
      media_folder_name: site.media_folder_name,
      media_folder_id: site.media_folder_id,
    },
    folder,
    collections,
    clean,
  };
}

export interface StaleDeleteResult {
  collectionId: string;
  requested: number;
  deleted: number;
  failed: number;
  errors: string[];
}

/**
 * Deletes the rows the engine does not own from the site's target collection.
 * Recomputed here, never taken from the client, and refused for any other
 * collection: in shadow mode that is the shadow collection, after cutover
 * the live one, so the old manual rows go only once the engine is serving.
 */
export async function deleteStaleRows(siteId: string, collectionId: string): Promise<StaleDeleteResult> {
  const site = await loadSite(siteId);
  if (!site.wix_site_id) throw new HubError(`${site.name} has no wix_site_id`, 409);
  if (collectionId !== site.target_collection_id) {
    throw new HubError(`Stale rows are only deleted from the site's target collection (${site.target_collection_id}), not ${collectionId}`, 409);
  }
  const owned = new Set(await loadOwnedIds(site.id));
  const items = await queryAllItems(site.wix_site_id, collectionId);
  const stale = items.map((i) => (typeof i.data._id === "string" ? i.data._id : i.id)).filter((id) => !owned.has(id));
  const result: StaleDeleteResult = { collectionId, requested: stale.length, deleted: 0, failed: 0, errors: [] };
  if (!stale.length) return result;
  const outcome = await bulkRemoveItems(site.wix_site_id, collectionId, stale);
  for (const r of outcome.results) {
    if (r.success) result.deleted += 1;
    else {
      result.failed += 1;
      if (result.errors.length < SAMPLE) result.errors.push(`${stale[r.originalIndex] ?? "?"}: ${r.error?.description ?? r.error?.code ?? "rejected"}`);
    }
  }
  return result;
}

/**
 * Clears the engine's record of photos Wix holds no picture for, so the next
 * photo pass imports them again and the listing's gallery is rewritten.
 *
 * Wix's URL import is asynchronous, and a fetch that fails leaves a file id
 * that renders as a broken thumbnail forever. Nothing in the import response
 * says so, which is why this looks afterwards instead.
 *
 * It refuses when more than BROKEN_SHARE_CAP of the engine's files look
 * broken: at that point the likelier explanation is that Wix changed what it
 * reports, and discarding thousands of good imports would be far worse than
 * leaving a few bad ones.
 */
/**
 * Where a sweep of the Media Manager folder starts, and whether it moves the
 * shared cursor on.
 *
 * A caller working to a clock covers the folder across passes: it picks up
 * where the last one stopped and leaves the cursor further along. A caller
 * with no clock is a person who pressed the button, and they mean the whole
 * library -- as the read-only audit beside it already does. Resuming from
 * wherever the background scan happened to be would report on the tail and
 * silently leave the rest, right after an audit that swept everything:
 * "12 broken" and then "cleared 2", for no visible reason. It leaves the
 * cursor alone as well, so pressing the button does not cost the background
 * scan its place.
 */
export function scanWindow(deadline: number | undefined, cursor: number): { startOffset: number; advances: boolean } {
  const paced = deadline !== undefined;
  return { startOffset: paced ? Math.max(0, cursor) : 0, advances: paced };
}

export async function reimportBrokenPhotos(siteId: string, deadline?: number): Promise<ReimportResult> {
  const site = await loadSite(siteId);
  if (!site.wix_site_id) throw new HubError(`${site.name} has no wix_site_id`, 409);
  // A site with no folder of its own imports into Wix's root, so that is where to look.
  const folderId = site.media_folder_id ?? WIX_MEDIA_ROOT;

  // Listing a big folder is hundreds of sequential Wix requests, so a caller
  // working to a clock passes its deadline and takes whatever was reached.
  // Checking part of the library is fine there: the files it did not see are
  // left for the next pass, and nothing is inferred from their absence. Such
  // a caller resumes from the cursor and moves it on, so the folder is
  // covered across passes rather than only ever its first pages (054).
  //
  // A caller with no deadline is a person who pressed the button, and they
  // mean the whole library -- as the read-only audit beside it already does.
  // Resuming from wherever the background scan happened to be would report
  // on the tail and silently leave the rest, right after an audit that swept
  // everything: "12 broken" followed by "cleared 2", for no visible reason.
  // It leaves the cursor alone too, so a manual sweep does not cost the
  // background scan its place.
  const { startOffset, advances } = scanWindow(deadline, site.media_scan_offset);
  const listing = await listMediaFiles(site.wix_site_id, folderId, { deadline, startOffset });
  if (advances) await setSiteMediaScanOffset(site.id, listing.nextOffset);
  const engineIds = new Set(await loadEngineFileIds(site.id));
  const broken = listing.files.filter((f) => engineIds.has(f.id) && mediaState(f) === "broken").map((f) => f.id);
  const result: ReimportResult = { broken: broken.length, cleared: 0, listings: 0, refused: null, truncated: listing.truncated };
  if (!broken.length) return result;
  // Against the engine photos this pass actually saw: on a truncated listing
  // the whole library is the wrong denominator and would wave through a share
  // the cap exists to catch.
  const seen = listing.files.filter((f) => engineIds.has(f.id)).length;
  if (seen && broken.length / seen > BROKEN_SHARE_CAP) {
    result.refused = `${broken.length} of the ${seen} of this location's photos this pass checked look broken to Wix, which is too many to act on; nothing was cleared`;
    return result;
  }

  const { data: rows, error } = await supabase
    .from("ls_site_media")
    .delete()
    .eq("site_id", site.id)
    .in("wix_file_id", broken)
    .select("media_id");
  if (error) throw new HubError(`clear broken photos: ${errorMessage(error)}`, 500);
  const mediaIds = (rows ?? []).map((r) => r.media_id as string);
  result.cleared = mediaIds.length;
  if (!mediaIds.length) return result;

  const { data: media } = await supabase.from("ls_listing_media").select("listing_id").in("id", mediaIds);
  const listingIds = [...new Set((media ?? []).map((m) => m.listing_id as string))];
  if (listingIds.length) {
    const { data: touched } = await supabase
      .from("ls_site_listings")
      .update({ needs_write: true, gallery_ready: false, updated_at: new Date().toISOString() })
      .eq("site_id", site.id)
      .in("listing_id", listingIds)
      .select("id");
    result.listings = (touched ?? []).length;
  }
  return result;
}
