// Write-back: applies an approved fp_pending_changes row to the site's
// pipeline-operated Wix collection (FloorPlansV2).
//
// Adds land as Wix DRAFTS while the site's insert_publish_mode is 'draft' —
// invisible on the live site until a human publishes them in the Wix CMS.
// Success moves the row to synced_draft (or synced), failure to failed with
// error_detail. The canonical fp_floor_plans row is upserted on success.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import {
  insertItem,
  updateItem,
  removeItem,
  importMediaFromUrl,
  type WixItemData,
} from "@/lib/wix/client";

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

type GalleryItem = { type: "image"; src: string };

/** Imports an ordered list of source URLs, preserving order; failures are skipped. */
async function importGallery(
  siteId: string,
  wixSiteId: string,
  urls: string[],
  planKey: string,
  suffix: string
): Promise<GalleryItem[]> {
  const items: GalleryItem[] = [];
  for (const [i, url] of urls.slice(0, MAX_GALLERY_IMAGES).entries()) {
    const uri = await importImage(siteId, wixSiteId, url, `${planKey}-${suffix}-${i + 1}.jpg`);
    if (uri) items.push({ type: "image", src: uri });
  }
  return items;
}

/** URL-deduped image import; returns a wix:image URI for IMAGE fields. */
async function importImage(
  siteId: string,
  wixSiteId: string,
  sourceUrl: string,
  displayName: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("fp_media_map")
    .select("wix_media_id")
    .eq("site_id", siteId)
    .eq("source_url", sourceUrl)
    .maybeSingle();
  if (existing?.wix_media_id) return existing.wix_media_id;

  try {
    const file = await importMediaFromUrl(wixSiteId, sourceUrl, displayName);
    const wixUri = `wix:image://v1/${file.id}/${encodeURIComponent(displayName)}`;
    await supabase.from("fp_media_map").upsert(
      {
        site_id: siteId,
        source_url: sourceUrl,
        wix_media_id: wixUri,
      },
      { onConflict: "site_id,source_url" }
    );
    return wixUri;
  } catch (error) {
    // Image failure shouldn't block the record; sync without the image.
    logger.warn("Floor plan image import failed", {
      sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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

function galleryUrls(rec: ProposedRecord): string[] {
  const urls = rec.galleryImages ?? [];
  if (urls.length) return urls;
  return rec.primaryImage ? [rec.primaryImage] : [];
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
      const gallery = await importGallery(site.id, site.wix_site_id, galleryUrls(rec), rec.planKey, "photo");
      const blueprints = await importGallery(site.id, site.wix_site_id, rec.blueprintImages ?? [], rec.planKey, "plan");
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

    if (change.change_type === "update") {
      if (!change.wix_record_id) return fail("update change has no wix_record_id");
      const rec = change.proposed_record as ProposedRecord;
      const gallery = await importGallery(site.id, site.wix_site_id, galleryUrls(rec), rec.planKey, "photo");
      const blueprints = await importGallery(site.id, site.wix_site_id, rec.blueprintImages ?? [], rec.planKey, "plan");
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
      return { status: "synced" };
    }

    return fail(`unknown change_type ${change.change_type}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
