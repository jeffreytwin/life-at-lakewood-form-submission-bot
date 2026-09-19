// Write-back: applies an approved fp_pending_changes row to the site's
// pipeline-operated Wix collection (FloorPlansV2).
//
// Adds land as Wix DRAFTS while the site's insert_publish_mode is 'draft' —
// invisible on the live site until a human publishes them in the Wix CMS.
// Success moves the row to synced_draft (or synced), failure to failed with
// error_detail. The canonical fp_floor_plans row is upserted on success.
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
  mediaState,
  WixApiError,
  type WixItemData,
} from "@/lib/wix/client";
import { basePlanMarkers } from "@/lib/floorplans/quick-move-ins";
import { wixImageUri } from "@/lib/listings/types";
import { measureImageUrl, wixFileIdOf } from "@/lib/floorplans/media";
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
}

// A safety bound, not a policy: the freelancers' galleries run to 58 photos
// and Jeff has not yet said whether to cap them (2026-09-19).
const MAX_GALLERY_IMAGES = 40;

/** One MEDIA_GALLERY entry, in the shape the legacy collections carry; the caption rides as title and alt. */
type GalleryItem = { type: "image"; src: string; title: string; alt?: string };

interface GalleryImport {
  items: GalleryItem[];
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
  const items: GalleryItem[] = [];
  const skipped: string[] = [];
  for (const [i, url] of urls.slice(0, MAX_GALLERY_IMAGES).entries()) {
    const displayName = displayNameFor(planKey, suffix, i + 1, url);
    const uri = await importImage(siteId, wixSiteId, url, displayName);
    const caption = meta[url]?.caption?.trim();
    if (uri) items.push({ type: "image", src: uri, title: caption || displayName, ...(caption ? { alt: caption } : {}) });
    else skipped.push(url);
  }
  return { items, skipped };
}

/**
 * A renderable wix:image URI for one source photo, importing it into the
 * site's Media Manager on first sight. Null when the photo is left out:
 * it could not be fetched or measured, or Wix reported the import failed.
 */
async function importImage(
  siteId: string,
  wixSiteId: string,
  sourceUrl: string,
  displayName: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("fp_media_map")
    .select("wix_media_id, width, height")
    .eq("site_id", siteId)
    .eq("source_url", sourceUrl)
    .maybeSingle();
  const cachedFileId = wixFileIdOf(existing?.wix_media_id);

  if (cachedFileId && existing?.width && existing?.height) {
    return wixImageUri(cachedFileId, displayName, existing.width, existing.height);
  }

  // Not measured yet: a new photo, or one imported before its size was
  // recorded (every import before migration 064). Measure first; a photo
  // that cannot be sized is left out rather than written as a URI Wix
  // refuses, which would take the whole gallery down with it.
  const measured = await measureImageUrl(sourceUrl);
  if (!measured) {
    logger.warn("Floor plan photo could not be fetched or measured; left out", { sourceUrl });
    return null;
  }

  if (cachedFileId) {
    // The same Wix file as before, now with its size on record.
    await supabase
      .from("fp_media_map")
      .update({ width: measured.width, height: measured.height, content_hash: measured.contentHash })
      .eq("site_id", siteId)
      .eq("source_url", sourceUrl);
    return wixImageUri(cachedFileId, displayName, measured.width, measured.height);
  }

  try {
    const file = await importMediaFromUrl(wixSiteId, sourceUrl, displayName);
    if (mediaState(file) === "broken") {
      // Wix answered the import with FAILED: an id with nothing behind it,
      // and caching it would make the broken thumbnail permanent.
      logger.warn("Wix reported the floor plan photo import failed; left out", { sourceUrl, fileId: file.id });
      return null;
    }
    const uri = wixImageUri(file.id, displayName, measured.width, measured.height);
    if (!uri) return null;
    await supabase.from("fp_media_map").upsert(
      {
        site_id: siteId,
        source_url: sourceUrl,
        wix_media_id: uri,
        content_hash: measured.contentHash,
        width: measured.width,
        height: measured.height,
      },
      { onConflict: "site_id,source_url" }
    );
    return uri;
  } catch (error) {
    // Image failure shouldn't block the record; sync without the image.
    logger.warn("Floor plan image import failed", {
      sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function galleryUrls(rec: ProposedRecord): string[] {
  const urls = rec.galleryImages ?? [];
  if (urls.length) return urls;
  return rec.primaryImage ? [rec.primaryImage] : [];
}

/**
 * Both galleries for a record. Throws when the record lists photos and not
 * one could be imported, so an approval never inserts a photo-less plan or
 * wipes a live gallery over a transient failure; a partial gallery is
 * written and the rest logged.
 */
async function importRecordMedia(
  siteId: string,
  wixSiteId: string,
  rec: ProposedRecord
): Promise<{ gallery: GalleryItem[]; blueprints: GalleryItem[]; tourImage: string | null }> {
  // A quick move-in's row shows one picture and no drawings or tour
  // (Wellen Park and Parrish keep those on the base plan), so only that
  // picture is imported for it.
  const photoUrls = rec.quickMoveIn ? galleryUrls(rec).slice(0, 1) : galleryUrls(rec);
  const gallery = await importGallery(siteId, wixSiteId, photoUrls, rec.planKey, "photo", rec.galleryMeta ?? {});
  const blueprints = rec.quickMoveIn
    ? { items: [] as GalleryItem[], skipped: [] as string[] }
    : await importGallery(siteId, wixSiteId, rec.blueprintImages ?? [], rec.planKey, "plan");
  // A drawing has no caption of its own; the site shows this one.
  blueprints.items = blueprints.items.map((item) => ({ ...item, title: "Floor plan", alt: "Floor plan" }));
  // The still behind the virtual tour button; optional, so its failure only costs the still.
  const tourImage = rec.virtualTourImage && !rec.quickMoveIn
    ? await importImage(siteId, wixSiteId, rec.virtualTourImage, displayNameFor(rec.planKey, "tour", 1, rec.virtualTourImage))
    : null;
  if (photoUrls.length && !gallery.items.length) {
    throw new Error(`none of the ${photoUrls.length} photos could be imported (first: ${photoUrls[0]})`);
  }
  if (gallery.skipped.length || blueprints.skipped.length) {
    logger.warn("Floor plan write-back left images out", {
      planKey: rec.planKey,
      photosSkipped: gallery.skipped.length,
      blueprintsSkipped: blueprints.skipped.length,
    });
  }
  return { gallery: gallery.items, blueprints: blueprints.items, tourImage };
}

/** The Builders and villages collections the reference fields point at, as every site names them. */
const BUILDERS_COLLECTION = "Builders";
const VILLAGES_COLLECTION = "HousesforSale-DynamicPages";

/** Wix item ids found by title, kept for the life of the process (a serverless invocation); only hits are kept. */
const referenceCache = new Map<string, string>();

/**
 * The _id of the item titled `title` in one of a site's collections, for the
 * builder1 and villages references every Wellen Park and Parrish row carries
 * (the Builders item "Toll Brothers", the village "The Isles"). An exact
 * title first, then a contains-match whose normalized title is the same, or
 * the only match. Null when there is no such item or the lookup fails: the
 * row is then written without the reference, and one set by hand survives
 * the read-merge on update.
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
    const id = items[0]?.id ?? (typeof items[0]?.data?._id === "string" ? items[0].data._id : null);
    if (!id) {
      logger.warn("No Wix item to reference by title", { collectionId, title: wanted });
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

interface PlanReferences {
  builderId: string | null;
  villageId: string | null;
}

/** The builder1 and villages references for a row: the site's Builders item and village page item, by name. */
async function referencesFor(wixSiteId: string, builderName: string, communityName: string): Promise<PlanReferences> {
  const [builderId, villageId] = await Promise.all([
    referenceIdOf(wixSiteId, BUILDERS_COLLECTION, builderName),
    referenceIdOf(wixSiteId, VILLAGES_COLLECTION, communityName),
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
    const scope = { site_id: site.id, community_id: community.id, builder_id: builder.id };

    if (change.change_type === "add") {
      const rec = change.proposed_record as ProposedRecord;
      const asDraft = site.insert_publish_mode !== "published";
      const { gallery, blueprints, tourImage } = await importRecordMedia(site.id, site.wix_site_id, rec);
      const item = await insertItem(
        site.wix_site_id,
        site.wix_collection_id,
        toWixData(rec, {
          communityName: community.name,
          builderName: builder.name,
          gallery,
          blueprints,
          tourImage,
          basePlanName: await basePlanNameOf(scope, rec),
          refs: await referencesFor(site.wix_site_id, builder.name, community.name),
        }),
        { asDraft }
      );

      const { data: plan, error: planError } = await supabase
        .from("fp_floor_plans")
        .upsert(
          {
            site_id: site.id,
            community_id: community.id,
            builder_id: builder.id,
            plan_key: change.plan_key,
            wix_record_id: item.id,
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
          wix_record_id: item.id,
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
      const { gallery, blueprints, tourImage } = await importRecordMedia(site.id, site.wix_site_id, rec);
      let wixRecordId: string = change.wix_record_id;
      // Read first: the update sends the whole item back, with the fields
      // the pipeline does not own carried over from what is there now.
      const current = await getItem(site.wix_site_id, site.wix_collection_id, wixRecordId);
      const data: WixItemData = {
        ...fieldsKeptFromWix(current?.data),
        ...toWixData(rec, {
          communityName: community.name,
          builderName: builder.name,
          gallery,
          blueprints,
          tourImage,
          basePlanName: await basePlanNameOf(scope, rec),
          refs: await referencesFor(site.wix_site_id, builder.name, community.name),
        }),
      };
      let recreatedAsDraft = false;
      try {
        if (!current) throw new WixApiError(404, "item not found", "GET item");
        await updateItem(site.wix_site_id, site.wix_collection_id, wixRecordId, data);
      } catch (error) {
        if (!isGoneFromWix(error)) throw error;
        // The item was deleted from the CMS by hand (Jeff cleared the
        // collection on 2026-09-19 and every approval 404ed). Re-create it
        // rather than strand the plan; like any insert it lands as a draft
        // while the site is in draft mode.
        const asDraft = site.insert_publish_mode !== "published";
        const item = await insertItem(site.wix_site_id, site.wix_collection_id, data, { asDraft });
        wixRecordId = item.id;
        recreatedAsDraft = asDraft;
        logger.info("Floor plan item was gone from Wix; re-created", { changeId, planKey: change.plan_key, wixRecordId });
      }
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
