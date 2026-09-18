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
  insertItem,
  updateItem,
  removeItem,
  importMediaFromUrl,
  mediaState,
  type WixItemData,
} from "@/lib/wix/client";
import { wixImageUri } from "@/lib/listings/types";
import { measureImageUrl, wixFileIdOf } from "@/lib/floorplans/media";

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
}

const MAX_GALLERY_IMAGES = 10;

/** One MEDIA_GALLERY entry, in the shape the legacy collections carry. */
type GalleryItem = { type: "image"; src: string; title: string };

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
  suffix: string
): Promise<GalleryImport> {
  const items: GalleryItem[] = [];
  const skipped: string[] = [];
  for (const [i, url] of urls.slice(0, MAX_GALLERY_IMAGES).entries()) {
    const displayName = displayNameFor(planKey, suffix, i + 1, url);
    const uri = await importImage(siteId, wixSiteId, url, displayName);
    if (uri) items.push({ type: "image", src: uri, title: displayName });
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
): Promise<{ gallery: GalleryItem[]; blueprints: GalleryItem[] }> {
  const photoUrls = galleryUrls(rec);
  const gallery = await importGallery(siteId, wixSiteId, photoUrls, rec.planKey, "photo");
  const blueprints = await importGallery(siteId, wixSiteId, rec.blueprintImages ?? [], rec.planKey, "plan");
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
  return { gallery: gallery.items, blueprints: blueprints.items };
}

function toWixData(
  rec: ProposedRecord,
  communityName: string,
  builderName: string,
  gallery: GalleryItem[],
  blueprints: GalleryItem[]
): WixItemData {
  return {
    floorPlanName: rec.name,
    floorPlanPrice: rec.priceDisplay ?? undefined,
    homeType: rec.homeType ?? undefined,
    village: communityName,
    builder: builderName,
    bedrooms: rec.beds || undefined,
    bathrooms: rec.baths || undefined,
    garages: rec.garages ?? undefined,
    squareFeet: rec.sqft ? rec.sqft.toLocaleString("en-US") : undefined,
    quickMoveInAvailable: rec.quickMoveIn,
    // The main image is gallery position #1, always.
    ...(gallery[0] ? { floorPlanImage: gallery[0].src } : {}),
    ...(gallery.length ? { floorPlanImageGalleryLink: gallery } : {}),
    ...(blueprints.length ? { floorPlanBluePrintGallery: blueprints } : {}),
    sourceUrl: rec.sourceUrl ?? undefined,
    syncKey: rec.planKey,
    lastSyncedAt: new Date().toISOString(),
  };
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
      const asDraft = site.insert_publish_mode !== "published";
      const { gallery, blueprints } = await importRecordMedia(site.id, site.wix_site_id, rec);
      const item = await insertItem(
        site.wix_site_id,
        site.wix_collection_id,
        toWixData(rec, community.name, builder.name, gallery, blueprints),
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
          { onConflict: "site_id,plan_key" }
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
      const { gallery, blueprints } = await importRecordMedia(site.id, site.wix_site_id, rec);
      await updateItem(
        site.wix_site_id,
        site.wix_collection_id,
        change.wix_record_id,
        toWixData(rec, community.name, builder.name, gallery, blueprints)
      );
      await supabase
        .from("fp_floor_plans")
        .update({
          name: rec.name,
          price: rec.price,
          sqft: rec.sqft,
          quick_move_in: rec.quickMoveIn,
          record: rec,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("site_id", site.id)
        .eq("plan_key", change.plan_key);
      await supabase
        .from("fp_pending_changes")
        .update({ status: "synced", updated_at: new Date().toISOString() })
        .eq("id", changeId);
      await maybeCreateFollowUp(
        change.field_changed === "price" ? "price_changed" : "other_change",
        `${rec.name}: ${change.field_changed ?? "updated"} ${change.old_value ?? ""} → ${change.new_value ?? ""} — update the brand email`
      );
      return { status: "synced" };
    }

    if (change.change_type === "remove") {
      if (!change.wix_record_id) return fail("remove change has no wix_record_id");
      await removeItem(site.wix_site_id, site.wix_collection_id, change.wix_record_id);
      await supabase
        .from("fp_floor_plans")
        .update({ removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("site_id", site.id)
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
