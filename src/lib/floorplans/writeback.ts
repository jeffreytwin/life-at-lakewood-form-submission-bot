// Write-back: applies an approved fp_pending_changes row to the site's
// pipeline-operated Wix collection (FloorPlansV2).
//
// An approved plan is written as a PUBLISHED item (Jeff, 2026-09-20: an
// approval is the publication; every site's insert_publish_mode is
// 'published'). A site set back to 'draft' gets drafts, invisible on the
// live site until a human publishes them in the Wix CMS. Success moves the
// row to synced (or synced_draft), failure to failed with error_detail.
// The canonical fp_floor_plans row is upserted on success.
//
// Photos: every image is fetched and measured before Wix imports it, because
// a wix:image URI renders only with its origin dimensions (see media.ts).
// The Wix file id and the size live in fp_media_map, keyed by source URL, so
// an unchanged image is never imported twice and its URI is rebuilt from the
// stored size on every write.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import {
  getItem,
  insertItem,
  updateItem,
  removeItem,
  queryItems,
  importMediaFromUrl,
  getMediaFile,
  mediaState,
  mediaVerdict,
  WixApiError,
  type WixItemData,
  getDataCollection,
  type WixDataItem,
} from "@/lib/wix/client";
import { basePlanMarkers } from "@/lib/floorplans/quick-move-ins";
import { virtualTourButtonFor } from "@/lib/floorplans/site-assets";
import { findItemNamed, referencedCollectionOf } from "@/lib/floorplans/collection-schema";
import { wixImageUri } from "@/lib/listings/types";
import { measureImageUrl, rasterizeSvg, rasterStoragePath, RASTER_BUCKET, wixFileIdOf } from "@/lib/floorplans/media";
import { normKey, type GalleryMeta } from "@/lib/floorplans/types";

/** A plan is builder + community + name (migration 065); the same trio keys the Wix row's syncKey. */
const PLAN_IDENTITY = "site_id,community_id,builder_id,plan_key";

/** Wix answers a write to an item deleted from the CMS with 404 WDE0073. */
const isGoneFromWix = (error: unknown): boolean => error instanceof WixApiError && error.status === 404;

interface ProposedRecord {
  planKey: string;
  name: string;
  price: number | null;
  priceDisplay: string | null;
  beds: string;
  baths: string;
  sqft: number | null;
  garages: string | null;
  homeType: string | null;
  quickMoveIn: boolean;
  sourceUrl: string | null;
  /** Legacy field from early slice rows; galleryImages[0] is authoritative. */
  primaryImage?: string | null;
  galleryImages: string[];
  blueprintImages?: string[];
  galleryMeta?: Record<string, GalleryMeta>;
  description?: string | null;
  virtualTourUrl?: string | null;
  virtualTourImage?: string | null;
  /** Quick move-ins: the base plan (quick-move-ins.ts); base plans: whether any quick move-in of theirs is on offer. */
  relatedPlanKey?: string | null;
  relatedPlanName?: string | null;
  hasQuickMoveIns?: boolean;
  /** Set in the Hub; the sites list high scores first. Base plans only. */
  score?: number | null;
}

// A safety bound, not a policy: the freelancers' galleries run to 58 photos
// and Jeff has not yet said whether to cap them (2026-09-19).
const MAX_GALLERY_IMAGES = 40;

/** One MEDIA_GALLERY entry, in the shape the legacy collections carry; the caption rides as title and alt. */
type GalleryItem = { type: "image"; src: string; title: string; alt?: string };

/** A picture imported for a record, with what is needed to check on it before the row is written. */
interface ImportedImage {
  uri: string;
  fileId: string;
  sourceUrl: string;
  /** Wix has been seen holding the picture (fp_media_map.verified_at); a fresh import starts false. */
  verified: boolean;
}

type PendingGalleryItem = GalleryItem & { image: ImportedImage };

interface GalleryImport {
  items: PendingGalleryItem[];
  /** Source URLs left out this time: unfetchable, unmeasurable, or refused by Wix. */
  skipped: string[];
}

/** The Media Manager file name for a gallery position, keeping the source's own extension when it has one. */
function displayNameFor(planKey: string, suffix: string, position: number, sourceUrl: string): string {
  let ext = "jpg";
  try {
    const m = new URL(sourceUrl).pathname.match(/\.(jpe?g|png|webp|gif|svg)$/i);
    if (m) ext = m[1].toLowerCase();
  } catch {
    // not a URL we can parse; the default extension is fine for a display name
  }
  return `${planKey}-${suffix}-${position}.${ext}`;
}

/** Imports an ordered list of source URLs, preserving order; an image that cannot be imported is skipped, not written broken. */
async function importGallery(
  siteId: string,
  wixSiteId: string,
  urls: string[],
  planKey: string,
  suffix: string,
  meta: Record<string, GalleryMeta> = {}
): Promise<GalleryImport> {
  const items: PendingGalleryItem[] = [];
  const skipped: string[] = [];
  for (const [i, url] of urls.slice(0, MAX_GALLERY_IMAGES).entries()) {
    const displayName = displayNameFor(planKey, suffix, i + 1, url);
    const image = await importImage(siteId, wixSiteId, url, displayName);
    const caption = meta[url]?.caption?.trim();
    if (image) items.push({ type: "image", src: image.uri, title: caption || displayName, ...(caption ? { alt: caption } : {}), image });
    else skipped.push(url);
  }
  return { items, skipped };
}

/** Stores a rendered drawing where Wix can fetch it and returns that URL; null when the store refused it. */
async function storeRaster(siteId: string, contentHash: string, png: Uint8Array): Promise<string | null> {
  const path = rasterStoragePath(siteId, contentHash);
  const { error } = await supabase.storage
    .from(RASTER_BUCKET)
    .upload(path, Buffer.from(png), { contentType: "image/png", upsert: true });
  if (error) {
    logger.warn("Rendered drawing could not be stored", { path, error: error.message });
    return null;
  }
  return supabase.storage.from(RASTER_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** A Wix file id that names an SVG: Wix filed that import as vector art, which never renders in an IMAGE field or a gallery. */
const isVectorFileId = (fileId: string): boolean => /\.svg$/i.test(fileId);

/**
 * A renderable wix:image URI for one source picture, importing it into the
 * site's Media Manager on first sight. An SVG drawing is rendered to a PNG
 * first (The Isles, 2026-09-20: Wix files an imported SVG as vector art,
 * and every drawing showed as a broken slash); a vector import cached
 * before then is re-imported the same way. Null when the picture is left
 * out: it could not be fetched, measured or rendered, or Wix reported the
 * import failed.
 */
async function importImage(
  siteId: string,
  wixSiteId: string,
  sourceUrl: string,
  displayName: string
): Promise<ImportedImage | null> {
  const { data: existing } = await supabase
    .from("fp_media_map")
    .select("wix_media_id, width, height, verified_at, media_type")
    .eq("site_id", siteId)
    .eq("source_url", sourceUrl)
    .maybeSingle();
  const cachedFileId = wixFileIdOf(existing?.wix_media_id);
  const cachedIsVector = cachedFileId ? isVectorFileId(cachedFileId) || existing?.media_type === "VECTOR" : false;
  const verified = Boolean(existing?.verified_at);

  if (cachedFileId && !cachedIsVector && existing?.width && existing?.height) {
    const uri = wixImageUri(cachedFileId, displayName, existing.width, existing.height);
    return uri ? { uri, fileId: cachedFileId, sourceUrl, verified } : null;
  }

  // Not measured yet: a new picture, one imported before its size was
  // recorded (every import before migration 064), or a vector to replace.
  // A picture that cannot be sized is left out rather than written as a
  // URI Wix refuses, which would take the whole gallery down with it.
  const measured = await measureImageUrl(sourceUrl);
  if (!measured) {
    logger.warn("Floor plan photo could not be fetched or measured; left out", { sourceUrl });
    return null;
  }

  if (cachedFileId && !cachedIsVector && !measured.svg) {
    // The same Wix file as before, now with its size on record.
    await supabase
      .from("fp_media_map")
      .update({ width: measured.width, height: measured.height, content_hash: measured.contentHash })
      .eq("site_id", siteId)
      .eq("source_url", sourceUrl);
    const uri = wixImageUri(cachedFileId, displayName, measured.width, measured.height);
    return uri ? { uri, fileId: cachedFileId, sourceUrl, verified } : null;
  }

  // A fresh import: the picture as served, or the drawing rendered to PNG.
  let importUrl = sourceUrl;
  let name = displayName;
  let { width, height } = measured;
  if (measured.svg) {
    const raster = await rasterizeSvg(measured.data);
    if (!raster) {
      logger.warn("SVG drawing could not be rendered; left out", { sourceUrl });
      return null;
    }
    const stored = await storeRaster(siteId, measured.contentHash, raster.png);
    if (!stored) return null;
    importUrl = stored;
    name = displayName.replace(/\.svg$/i, ".png");
    width = raster.width;
    height = raster.height;
  }

  try {
    const file = await importMediaFromUrl(wixSiteId, importUrl, name);
    if (mediaState(file) === "broken") {
      // Wix answered the import with FAILED: an id with nothing behind it,
      // and caching it would make the broken thumbnail permanent.
      logger.warn("Wix reported the floor plan photo import failed; left out", { sourceUrl, fileId: file.id });
      return null;
    }
    const uri = wixImageUri(file.id, name, width, height);
    if (!uri) return null;
    await supabase.from("fp_media_map").upsert(
      {
        site_id: siteId,
        source_url: sourceUrl,
        wix_media_id: uri,
        content_hash: measured.contentHash,
        width,
        height,
        verified_at: null,
        media_type: null,
      },
      { onConflict: "site_id,source_url" }
    );
    return { uri, fileId: file.id, sourceUrl, verified: false };
  } catch (error) {
    // Image failure shouldn't block the record; sync without the image.
    logger.warn("Floor plan image import failed", {
      sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Waits between looks at a fresh import: Wix usually has the bytes within seconds; the whole wait is about half a minute. */
const VERIFY_WAITS_MS = [1500, 3000, 5000, 8000, 12000];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks Wix about every picture the row is about to carry, and returns the
 * file ids that must not be written: Wix's own fetch failed, the file is
 * not an image (vector art), or it still was not there after the wait. A
 * picture Wix is seen holding is marked verified and never asked about
 * again; a failed or non-image one is forgotten, so the next approval
 * imports it afresh. Nothing broken reaches a row (Jeff, 2026-09-20).
 */
async function verifyImports(siteId: string, wixSiteId: string, images: ImportedImage[]): Promise<Set<string>> {
  const bad = new Set<string>();
  let pending = images.filter((image) => !image.verified);
  for (let round = 0; pending.length; round += 1) {
    if (round > 0) {
      if (round > VERIFY_WAITS_MS.length) break;
      await sleep(VERIFY_WAITS_MS[round - 1]);
    }
    const still: ImportedImage[] = [];
    for (const image of pending) {
      let file: Awaited<ReturnType<typeof getMediaFile>>;
      try {
        file = await getMediaFile(wixSiteId, image.fileId);
      } catch (error) {
        logger.warn("Could not ask Wix about an import; trying again", {
          fileId: image.fileId,
          error: error instanceof Error ? error.message : String(error),
        });
        still.push(image);
        continue;
      }
      const verdict = mediaVerdict(file);
      // READY without a media block is Wix saying its fetch completed; that is enough.
      const ready = verdict === "ready" || (verdict === "unknown" && String(file?.operationStatus ?? "").toUpperCase() === "READY");
      if (ready) {
        await supabase
          .from("fp_media_map")
          .update({ verified_at: new Date().toISOString(), media_type: file?.mediaType ?? "IMAGE" })
          .eq("site_id", siteId)
          .eq("source_url", image.sourceUrl);
      } else if (verdict === "pending" || verdict === "unknown") {
        still.push(image);
      } else {
        bad.add(image.fileId);
        logger.warn("Wix holds no usable picture for the import; left out and forgotten", {
          sourceUrl: image.sourceUrl,
          fileId: image.fileId,
          verdict,
          mediaType: file?.mediaType ?? null,
        });
        await supabase.from("fp_media_map").delete().eq("site_id", siteId).eq("source_url", image.sourceUrl);
      }
    }
    pending = still;
  }
  for (const image of pending) {
    bad.add(image.fileId);
    logger.warn("Wix had not fetched the picture in time; left out this time", { sourceUrl: image.sourceUrl, fileId: image.fileId });
  }
  return bad;
}

function galleryUrls(rec: ProposedRecord): string[] {
  const urls = rec.galleryImages ?? [];
  if (urls.length) return urls;
  return rec.primaryImage ? [rec.primaryImage] : [];
}

/** The gallery entry as written, without the bookkeeping. */
const toGalleryItem = (item: PendingGalleryItem): GalleryItem => ({
  type: item.type,
  src: item.src,
  title: item.title,
  ...(item.alt ? { alt: item.alt } : {}),
});

/**
 * Both galleries and the tour still for a record, every picture verified
 * with Wix before it is handed back. Throws when the record lists photos
 * and not one could be imported and verified, so an approval never inserts
 * a photo-less plan or wipes a live gallery over a transient failure; a
 * partial gallery is written and the rest logged.
 */
async function importRecordMedia(
  siteId: string,
  wixSiteId: string,
  rec: ProposedRecord,
  { tourStill = true }: { tourStill?: boolean } = {}
): Promise<{ gallery: GalleryItem[]; blueprints: GalleryItem[]; tourImage: string | null }> {
  // A quick move-in's row shows one picture and no drawings or tour
  // (Wellen Park and Parrish keep those on the base plan), so only that
  // picture is imported for it.
  const photoUrls = rec.quickMoveIn ? galleryUrls(rec).slice(0, 1) : galleryUrls(rec);
  const gallery = await importGallery(siteId, wixSiteId, photoUrls, rec.planKey, "photo", rec.galleryMeta ?? {});
  const blueprints = rec.quickMoveIn
    ? { items: [] as PendingGalleryItem[], skipped: [] as string[] }
    : await importGallery(siteId, wixSiteId, rec.blueprintImages ?? [], rec.planKey, "plan");
  // A drawing has no caption of its own; the site shows this one.
  blueprints.items = blueprints.items.map((item) => ({ ...item, title: "Floor plan", alt: "Floor plan" }));
  // The builder's still behind the virtual tour link, for a site without a
  // button of its own (site-assets.ts); optional, so its failure only costs the still.
  const tour = tourStill && rec.virtualTourImage && !rec.quickMoveIn
    ? await importImage(siteId, wixSiteId, rec.virtualTourImage, displayNameFor(rec.planKey, "tour", 1, rec.virtualTourImage))
    : null;

  // Nothing goes on the row until Wix is seen holding it.
  const bad = await verifyImports(siteId, wixSiteId, [
    ...gallery.items.map((item) => item.image),
    ...blueprints.items.map((item) => item.image),
    ...(tour ? [tour] : []),
  ]);
  const photos = gallery.items.filter((item) => !bad.has(item.image.fileId)).map(toGalleryItem);
  const drawings = blueprints.items.filter((item) => !bad.has(item.image.fileId)).map(toGalleryItem);
  const tourImage = tour && !bad.has(tour.fileId) ? tour.uri : null;

  if (photoUrls.length && !photos.length) {
    throw new Error(`none of the ${photoUrls.length} photos could be imported and verified (first: ${photoUrls[0]})`);
  }
  if (gallery.skipped.length || blueprints.skipped.length || bad.size) {
    logger.warn("Floor plan write-back left images out", {
      planKey: rec.planKey,
      photosSkipped: gallery.skipped.length,
      blueprintsSkipped: blueprints.skipped.length,
      unverified: bad.size,
    });
  }
  return { gallery: photos, blueprints: drawings, tourImage };
}

/**
 * Where the builder1 and villages reference fields point when a site's
 * schema cannot be read: the Builders collection, and the neighborhoods
 * collection Wellen Park and Parrish use.
 */
const DEFAULT_REFERENCE_TARGETS: ReferenceTargets = { builder1: "Builders", villages: "HousesforSale-DynamicPages" };

interface ReferenceTargets {
  builder1: string;
  villages: string;
}

/** Reference targets per site collection, kept for the life of the process (a serverless invocation). */
const targetsCache = new Map<string, ReferenceTargets>();

/**
 * The collections a site's builder1 and villages fields reference, read
 * from its Floor Plans V2 schema. They differ by site: Wellen Park and
 * Parrish keep their neighborhoods in HousesforSale-DynamicPages, Lakewood
 * in AmenitiesbyVillage, which is why every Isles row went out without its
 * neighborhood on 2026-09-20 while the lookup searched the former. The
 * defaults stand in when the schema cannot be read.
 */
async function referenceTargetsOf(wixSiteId: string, wixCollectionId: string): Promise<ReferenceTargets> {
  const cacheKey = `${wixSiteId}|${wixCollectionId}`;
  const cached = targetsCache.get(cacheKey);
  if (cached) return cached;
  try {
    const collection = await getDataCollection(wixSiteId, wixCollectionId);
    if (!collection) return { ...DEFAULT_REFERENCE_TARGETS };
    const targets: ReferenceTargets = {
      builder1: referencedCollectionOf(collection.fields, "builder1", DEFAULT_REFERENCE_TARGETS.builder1),
      villages: referencedCollectionOf(collection.fields, "villages", DEFAULT_REFERENCE_TARGETS.villages),
    };
    targetsCache.set(cacheKey, targets);
    return targets;
  } catch (error) {
    logger.warn("Wix schema lookup for the reference fields failed", {
      collectionId: wixCollectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...DEFAULT_REFERENCE_TARGETS };
  }
}

/** Wix item ids found by name, kept for the life of the process; only hits are kept. */
const referenceCache = new Map<string, string>();

/** The most items a name lookup reads when no title matches: the neighborhoods collections hold a few dozen. */
const REFERENCE_SCAN_CAP = 500;

/**
 * The _id of the item named `title` in one of a site's collections, for the
 * builder1 and villages references every Wellen Park and Parrish row carries
 * (the Builders item "Toll Brothers", the neighborhood "The Isles"). An exact
 * title first, then a contains-match whose normalized title is the same, or
 * the only match; then, since a collection may keep its name in another
 * field, the collection read and matched on any title or name field
 * (collection-schema.ts, findItemNamed). Null when there is no such item or
 * the lookup fails: the row is then written without the reference, and one
 * set by hand survives the read-merge on update.
 */
async function referenceIdOf(wixSiteId: string, collectionId: string, title: string): Promise<string | null> {
  const wanted = title.trim();
  if (!wanted) return null;
  const cacheKey = `${wixSiteId}|${collectionId}|${wanted.toLowerCase()}`;
  const cached = referenceCache.get(cacheKey);
  if (cached) return cached;
  try {
    let { items } = await queryItems(wixSiteId, collectionId, { filter: { title: { $eq: wanted } }, limit: 1 });
    if (!items.length) {
      const loose = await queryItems(wixSiteId, collectionId, { filter: { title: { $contains: wanted } }, limit: 10 });
      const same = loose.items.filter((it) => normKey(String(it.data?.title ?? "")) === normKey(wanted));
      items = same.length ? same : loose.items.length === 1 ? loose.items : [];
    }
    if (!items.length) {
      const found = findItemNamed(await queryItemsUpTo(wixSiteId, collectionId, REFERENCE_SCAN_CAP), wanted);
      items = found ? [found] : [];
    }
    const id = items[0]?.id ?? (typeof items[0]?.data?._id === "string" ? items[0].data._id : null);
    if (!id) {
      logger.warn("No Wix item to reference by name", { collectionId, title: wanted });
      return null;
    }
    referenceCache.set(cacheKey, id);
    return id;
  } catch (error) {
    logger.warn("Wix reference lookup failed", {
      collectionId,
      title: wanted,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The first `cap` items of a collection, a page at a time. */
async function queryItemsUpTo(wixSiteId: string, collectionId: string, cap: number): Promise<WixDataItem[]> {
  const all: WixDataItem[] = [];
  while (all.length < cap) {
    const { items, total } = await queryItems(wixSiteId, collectionId, {
      limit: Math.min(100, cap - all.length),
      offset: all.length,
    });
    all.push(...items);
    if (!items.length || all.length >= total) break;
  }
  return all;
}

interface PlanReferences {
  builderId: string | null;
  villageId: string | null;
}

/** A site as the reference lookups need it: where its Floor Plans V2 lives. */
interface ReferenceSite {
  wix_site_id: string;
  wix_collection_id: string;
}

/**
 * The builder1 and villages references for a row: the site's Builders item
 * and neighborhood item, by name, in the collections its own schema points at.
 */
async function referencesFor(site: ReferenceSite, builderName: string, communityName: string): Promise<PlanReferences> {
  const targets = await referenceTargetsOf(site.wix_site_id, site.wix_collection_id);
  const [builderId, villageId] = await Promise.all([
    referenceIdOf(site.wix_site_id, targets.builder1, builderName),
    referenceIdOf(site.wix_site_id, targets.villages, communityName),
  ]);
  return { builderId, villageId };
}

interface WixRowContext {
  communityName: string;
  builderName: string;
  gallery: GalleryItem[];
  blueprints: GalleryItem[];
  tourImage: string | null;
  /** Quick move-ins: the name the base plan's own row carries. */
  basePlanName: string | null;
  refs: PlanReferences;
}

/**
 * The Wix row for a record. A base plan carries everything; a quick move-in
 * carries its address, price, one picture, description and the name of its
 * base plan, and nothing else, the way Wellen Park and Parrish keep them
 * (docs/WIX_COLLECTIONS.md, "Quick move-ins"). Both carry the builder and
 * village as text and as references.
 */
function toWixData(rec: ProposedRecord, ctx: WixRowContext): WixItemData {
  const { communityName, builderName, gallery, blueprints, tourImage, basePlanName, refs } = ctx;
  const shared: WixItemData = {
    floorPlanName: rec.name,
    floorPlanPrice: rec.priceDisplay ?? undefined,
    village: communityName,
    builder: builderName,
    ...(refs.builderId ? { builder1: refs.builderId } : {}),
    ...(refs.villageId ? { villages: refs.villageId } : {}),
    floorPlanDescription: rec.description?.trim() || undefined,
    sourceUrl: rec.sourceUrl ?? undefined,
    syncKey: [normKey(builderName), normKey(communityName), rec.planKey].join("/"),
    lastSyncedAt: new Date().toISOString(),
  };
  if (rec.quickMoveIn) {
    return {
      ...shared,
      ...(gallery[0] ? { floorPlanImage: gallery[0].src } : {}),
      relatedFloorPlanQuickMoveInOnly: basePlanName ?? rec.relatedPlanName ?? undefined,
    };
  }
  return {
    ...shared,
    homeType: rec.homeType ?? undefined,
    bedrooms: rec.beds || undefined,
    bathrooms: rec.baths || undefined,
    garages: rec.garages ?? undefined,
    squareFeet: rec.sqft ? rec.sqft.toLocaleString("en-US") : undefined,
    virtualTourLink: rec.virtualTourUrl?.trim() || undefined,
    ...(tourImage ? { virtualTourImageV2: tourImage } : {}),
    // The main image is gallery position #1, always; a plan with drawings
    // and no photos leads with its drawing rather than nothing.
    ...(gallery[0] ?? blueprints[0] ? { floorPlanImage: (gallery[0] ?? blueprints[0]).src } : {}),
    // The photo gallery ends with the drawings (Jeff, 2026-09-19); they
    // also keep their own gallery for pages that show them apart.
    ...(gallery.length || blueprints.length ? { floorPlanImageGalleryLink: [...gallery, ...blueprints] } : {}),
    ...(blueprints.length ? { floorPlanBluePrintGallery: blueprints } : {}),
    // Whether quick move-ins of this plan are on offer: the flag, the banner
    // text, the badge and the status dot, plus the price bracket tag.
    ...basePlanMarkers(rec),
    ...(typeof rec.score === "number" && Number.isFinite(rec.score) ? { score: rec.score } : {}),
  };
}

/**
 * The name the base plan's own row carries on the site, for a quick move-in's
 * relatedFloorPlanQuickMoveInOnly: the canonical row's name (which keeps a
 * rename made in the Hub), else the name the engine saw.
 */
async function basePlanNameOf(
  scope: { site_id: string; community_id: string; builder_id: string },
  rec: ProposedRecord
): Promise<string | null> {
  if (!rec.quickMoveIn) return null;
  if (!rec.relatedPlanKey) return rec.relatedPlanName ?? null;
  const { data } = await supabase
    .from("fp_floor_plans")
    .select("name")
    .match({ ...scope, plan_key: rec.relatedPlanKey })
    .is("removed_at", null)
    .maybeSingle();
  return data?.name ?? rec.relatedPlanName ?? null;
}

/**
 * The fields of a Wix item the pipeline does not own, kept across an update:
 * a Wix update replaces the whole item, so anything set by hand in the CMS
 * (the builder and village references, score, notes) would go with it.
 * System fields (_id, dates, publish status) are Wix's to set.
 */
function fieldsKeptFromWix(data: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => !key.startsWith("_")));
}

/** The site, community and builder a plan belongs to, as the write needs them. */
interface PlanScope {
  site: { id: string; domain?: string | null; wix_site_id: string; wix_collection_id: string; insert_publish_mode: string | null };
  community: { id: string; name: string };
  builder: { id: string; name: string };
}

/**
 * Writes a record to its Wix row: media imported and verified first, the
 * row read so fields the pipeline does not own survive, and an item Wix no
 * longer has re-created (as a draft in draft mode), like a first insert.
 * Returns the row's id and whether it was inserted as a draft.
 */
async function writePlanToWix(
  scope: PlanScope,
  planKey: string,
  rec: ProposedRecord,
  wixRecordId: string | null
): Promise<{ wixRecordId: string; asDraft: boolean }> {
  const { site, community, builder } = scope;
  // A row with a virtual tour link carries its site's button picture (Jeff,
  // 2026-09-20; site-assets.ts), the builder's still only on a site without one.
  const button = virtualTourButtonFor(site.domain);
  const media = await importRecordMedia(site.id, site.wix_site_id, rec, { tourStill: !button });
  const { gallery, blueprints } = media;
  const tourImage = rec.virtualTourUrl?.trim() ? (button ?? media.tourImage) : null;
  const ids = { site_id: site.id, community_id: community.id, builder_id: builder.id };
  const current = wixRecordId ? await getItem(site.wix_site_id, site.wix_collection_id, wixRecordId) : null;
  const data: WixItemData = {
    ...fieldsKeptFromWix(current?.data),
    ...toWixData(rec, {
      communityName: community.name,
      builderName: builder.name,
      gallery,
      blueprints,
      tourImage,
      basePlanName: await basePlanNameOf(ids, rec),
      refs: await referencesFor(site, builder.name, community.name),
    }),
  };
  const asDraft = site.insert_publish_mode !== "published";
  if (current && wixRecordId) {
    const isDraft = String(current.data?._publishStatus ?? "").toUpperCase() === "DRAFT";
    if (isDraft && !asDraft) {
      // A draft cannot be published through an update (probe of 2026-07-02:
      // _publishStatus stays DRAFT), so the draft is replaced by a published
      // item with the same content; the row's id changes and is recorded.
      try {
        await removeItem(site.wix_site_id, site.wix_collection_id, wixRecordId);
      } catch (error) {
        if (!isGoneFromWix(error)) throw error;
      }
      const item = await insertItem(site.wix_site_id, site.wix_collection_id, data, { asDraft: false });
      logger.info("Floor plan draft replaced by a published item", { planKey, from: wixRecordId, to: item.id });
      return { wixRecordId: item.id, asDraft: false };
    }
    try {
      await updateItem(site.wix_site_id, site.wix_collection_id, wixRecordId, data);
      return { wixRecordId, asDraft: false };
    } catch (error) {
      if (!isGoneFromWix(error)) throw error;
    }
  }
  // The item was deleted from the CMS by hand (Jeff cleared the collection
  // on 2026-09-19 and every approval 404ed), or was never there: insert,
  // published, or as a draft while the site is in draft mode.
  const item = await insertItem(site.wix_site_id, site.wix_collection_id, data, { asDraft });
  if (wixRecordId) logger.info("Floor plan item was gone from Wix; re-created", { planKey, wixRecordId: item.id });
  return { wixRecordId: item.id, asDraft };
}

/**
 * Writes one canonical plan to Wix again under the current rules (pictures
 * re-imported where needed and verified, drawings as PNG), keeping its
 * score and edits: the repair for a row written with a picture Wix could
 * not show. Settings → Builder Connections → Rewrite runs it per plan.
 */
export async function rewritePlan(planId: string): Promise<{ status: "synced" | "synced_draft" | "failed"; name: string; error?: string }> {
  const { data: plan, error } = await supabase
    .from("fp_floor_plans")
    .select(
      "id, plan_key, name, wix_record_id, record, fp_sites:site_id(id, domain, wix_site_id, wix_collection_id, insert_publish_mode), fp_communities:community_id(id, name), fp_builders:builder_id(id, name)"
    )
    .eq("id", planId)
    .single();
  if (error || !plan) return { status: "failed", name: planId, error: error?.message ?? "plan not found" };
  const site = plan.fp_sites as unknown as PlanScope["site"] | null;
  const community = plan.fp_communities as unknown as PlanScope["community"] | null;
  const builder = plan.fp_builders as unknown as PlanScope["builder"] | null;
  if (!site?.wix_site_id || !site.wix_collection_id || !community || !builder) {
    return { status: "failed", name: plan.name, error: "plan is missing its site, community or builder" };
  }
  const rec = { ...(plan.record as ProposedRecord), planKey: plan.plan_key };
  try {
    const { wixRecordId, asDraft } = await writePlanToWix({ site, community, builder }, plan.plan_key, rec, plan.wix_record_id);
    await supabase
      .from("fp_floor_plans")
      .update({ wix_record_id: wixRecordId, updated_at: new Date().toISOString() })
      .eq("id", plan.id);
    return { status: asDraft ? "synced_draft" : "synced", name: plan.name };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("Floor plan rewrite failed", { planId, name: plan.name, detail });
    return { status: "failed", name: plan.name, error: detail };
  }
}

export async function applyPendingChange(changeId: string): Promise<{
  status: string;
  error?: string;
}> {
  const { data: change, error: loadError } = await supabase
    .from("fp_pending_changes")
    .select(
      "*, fp_sites:site_id(id, domain, wix_site_id, wix_collection_id, insert_publish_mode), fp_communities:community_id(id, name), fp_builders:builder_id(id, name)"
    )
    .eq("id", changeId)
    .single();
  if (loadError || !change) {
    return { status: "failed", error: loadError?.message ?? "change not found" };
  }
  if (change.status !== "approved") {
    return { status: change.status, error: "change is not approved" };
  }

  const site = change.fp_sites;
  const community = change.fp_communities;
  const builder = change.fp_builders;

  async function fail(detail: string) {
    await supabase
      .from("fp_pending_changes")
      .update({ status: "failed", error_detail: detail.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", changeId);
    logger.error("Floor plan write-back failed", { changeId, detail });
    return { status: "failed", error: detail };
  }

  if (!site?.wix_site_id || !site?.wix_collection_id) {
    return fail("site is missing wix_site_id or wix_collection_id");
  }

  try {
    if (change.change_type === "add") {
      const rec = change.proposed_record as ProposedRecord;
      const { wixRecordId: itemId, asDraft } = await writePlanToWix({ site, community, builder }, change.plan_key, rec, null);

      const { data: plan, error: planError } = await supabase
        .from("fp_floor_plans")
        .upsert(
          {
            site_id: site.id,
            community_id: community.id,
            builder_id: builder.id,
            plan_key: change.plan_key,
            wix_record_id: itemId,
            name: rec.name,
            price: rec.price,
            beds: parseFloat(rec.beds) || null,
            baths: parseFloat(rec.baths) || null,
            sqft: rec.sqft,
            quick_move_in: rec.quickMoveIn,
            record: rec,
            source_url: rec.sourceUrl,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: PLAN_IDENTITY }
        )
        .select("id")
        .single();
      if (planError) throw new Error(`canonical upsert: ${planError.message}`);

      const newStatus = asDraft ? "synced_draft" : "synced";
      await supabase
        .from("fp_pending_changes")
        .update({
          status: newStatus,
          wix_record_id: itemId,
          floor_plan_id: plan.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", changeId);
      return { status: newStatus };
    }

    // Starred-plan follow-up: the brand email lives outside Wix, so changes
    // to starred plans create a persistent task after sync.
    async function maybeCreateFollowUp(taskType: string, detail: string) {
      if (!change.floor_plan_id) return;
      const { data: plan } = await supabase
        .from("fp_floor_plans")
        .select("starred")
        .eq("id", change.floor_plan_id)
        .single();
      if (!plan?.starred) return;
      await supabase.from("fp_follow_up_tasks").insert({
        floor_plan_id: change.floor_plan_id,
        pending_change_id: change.id,
        task_type: taskType,
        detail,
      });
    }

    if (change.change_type === "update") {
      if (!change.wix_record_id) return fail("update change has no wix_record_id");
      const rec = change.proposed_record as ProposedRecord;
      const { wixRecordId, asDraft: recreatedAsDraft } = await writePlanToWix(
        { site, community, builder },
        change.plan_key,
        rec,
        change.wix_record_id
      );
      await supabase
        .from("fp_floor_plans")
        .update({
          name: rec.name,
          price: rec.price,
          sqft: rec.sqft,
          quick_move_in: rec.quickMoveIn,
          record: rec,
          wix_record_id: wixRecordId,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("site_id", site.id)
        .eq("community_id", community.id)
        .eq("builder_id", builder.id)
        .eq("plan_key", change.plan_key);
      const updateStatus = recreatedAsDraft ? "synced_draft" : "synced";
      await supabase
        .from("fp_pending_changes")
        .update({ status: updateStatus, wix_record_id: wixRecordId, updated_at: new Date().toISOString() })
        .eq("id", changeId);
      await maybeCreateFollowUp(
        change.field_changed === "price" ? "price_changed" : "other_change",
        `${rec.name}: ${change.field_changed ?? "updated"} ${change.old_value ?? ""} → ${change.new_value ?? ""} — update the brand email`
      );
      return { status: updateStatus };
    }

    if (change.change_type === "remove") {
      if (!change.wix_record_id) return fail("remove change has no wix_record_id");
      try {
        await removeItem(site.wix_site_id, site.wix_collection_id, change.wix_record_id);
      } catch (error) {
        // Already gone from the CMS is the outcome wanted.
        if (!isGoneFromWix(error)) throw error;
      }
      await supabase
        .from("fp_floor_plans")
        .update({ removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("site_id", site.id)
        .eq("community_id", community.id)
        .eq("builder_id", builder.id)
        .eq("plan_key", change.plan_key);
      await supabase
        .from("fp_pending_changes")
        .update({ status: "synced", updated_at: new Date().toISOString() })
        .eq("id", changeId);
      await maybeCreateFollowUp(
        "plan_removed",
        `${change.plan_key} was removed by the builder — pick a replacement for the brand email`
      );
      return { status: "synced" };
    }

    return fail(`unknown change_type ${change.change_type}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
