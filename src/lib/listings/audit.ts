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
import { bulkRemoveItems, listMediaFiles, queryAllItems, type WixDataItem } from "@/lib/wix/client";
import { wixFileId } from "@/lib/listings/normalize";
import { selectAll } from "@/lib/listings/db";
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

export async function auditSite(siteId: string): Promise<SiteAuditReport> {
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
  };
  let folderFileIds: string[] | null = null;
  if (site.media_folder_id) {
    const listing = await listMediaFiles(site.wix_site_id, site.media_folder_id);
    folderFileIds = listing.files.map((f) => f.id);
    folder.filesInFolder = folderFileIds.length;
    folder.listingTruncated = listing.truncated;
    Object.assign(folder, compareFolder(await loadEngineFileIds(site.id), folderFileIds));
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
