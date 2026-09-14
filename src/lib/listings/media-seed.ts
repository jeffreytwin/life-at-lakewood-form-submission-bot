// Seeds the site's media map from the galleries it already serves, so the
// engine reuses the photos a site has imported instead of downloading them
// again from MLSGrid (which allows one download per photo per hour and asks
// consumers to keep their own copies). Read-only on Wix: every gallery item
// with an MLS source URL and a Media Manager URI becomes a ls_listing_media
// row (identity: the stable path key) plus a ls_site_media row (origin
// 'seeded'). Listings unknown to the engine get a placeholder ls_listings
// row that the next pull overwrites; a full run verifies each of them
// against MLSGrid.

import { queryAllItems } from "@/lib/wix/client";
import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/shared/errors";
import { mediaPathKey, wixFileId } from "@/lib/listings/normalize";
import { chunk, mediaKey, selectAll } from "@/lib/listings/db";
import type { LsSite } from "@/lib/listings/types";

export interface MediaSeedResult {
  liveItems: number;
  galleryItems: number;
  /** Gallery items without an MLS source URL or a Wix URI (cannot be keyed). */
  unkeyed: number;
  placeholders: number;
  mediaRows: number;
  siteMediaRows: number;
}

interface LiveGalleryItem {
  src?: unknown;
  mlsSourceUrl?: unknown;
  title?: unknown;
}

export async function seedSiteMediaFromLive(site: LsSite): Promise<MediaSeedResult> {
  if (!site.wix_site_id) throw new Error(`site ${site.domain} has no wix_site_id`);
  const items = await queryAllItems(site.wix_site_id, site.live_collection_id);
  const result: MediaSeedResult = { liveItems: items.length, galleryItems: 0, unkeyed: 0, placeholders: 0, mediaRows: 0, siteMediaRows: 0 };

  const placeholders: Array<Record<string, unknown>> = [];
  const media: Array<{ listing_id: string; position: number; path_key: string; title: string | null }> = [];
  const uris = new Map<string, { uri: string; fileId: string | null }>();

  for (const item of items) {
    const data = item.data as Record<string, unknown>;
    const listingId = typeof data._id === "string" ? data._id : item.id;
    if (!listingId) continue;
    const gallery = Array.isArray(data.listingImageGallery) ? (data.listingImageGallery as LiveGalleryItem[]) : [];
    let position = 0;
    for (const g of gallery) {
      result.galleryItems += 1;
      const src = typeof g?.src === "string" ? g.src : null;
      const source = typeof g?.mlsSourceUrl === "string" ? g.mlsSourceUrl : null;
      const pathKey = source ? mediaPathKey(source) : null;
      if (!src || !src.startsWith("wix:image://") || !pathKey) {
        result.unkeyed += 1;
        continue;
      }
      position += 1;
      media.push({ listing_id: listingId, position, path_key: pathKey, title: typeof g.title === "string" ? g.title : null });
      uris.set(mediaKey(listingId, pathKey), { uri: src, fileId: wixFileId(src) });
    }
    const address = data.propertyAddressGoogleMaps as Record<string, unknown> | undefined;
    placeholders.push({
      listing_id: listingId,
      standard_status: typeof data.standardStatus === "string" ? data.standardStatus : null,
      city: address && typeof address.city === "string" ? address.city : null,
      subdivision: typeof data.subdivision === "string" ? data.subdivision : null,
      list_price: typeof data.listingPricePure === "number" ? data.listingPricePure : null,
      photo_count: position,
      raw: { seededFrom: site.live_collection_id, seededAt: new Date().toISOString() },
    });
  }

  // Placeholders only where the engine has no row yet (a real pull wins).
  for (const part of chunk(placeholders, 100)) {
    const { data, error } = await supabase
      .from("ls_listings")
      .upsert(part, { onConflict: "listing_id", ignoreDuplicates: true })
      .select("listing_id");
    if (error) throw new Error(`seed placeholders: ${errorMessage(error)}`);
    result.placeholders += (data ?? []).length;
  }

  // Media rows keyed by (listing, path); an existing row from a pull is kept.
  for (const part of chunk(media, 500)) {
    const { data, error } = await supabase
      .from("ls_listing_media")
      .upsert(part, { onConflict: "listing_id,path_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`seed listing media: ${errorMessage(error)}`);
    result.mediaRows += (data ?? []).length;
  }

  // Resolve media ids for every seeded photo, then record the site's URI.
  const listingIds = [...new Set(media.map((m) => m.listing_id))];
  const siteMedia: Array<Record<string, unknown>> = [];
  for (const part of chunk(listingIds, 200)) {
    // A couple of hundred galleries is thousands of rows: page, never trust one response.
    const rows = await selectAll<{ id: string; listing_id: string; path_key: string }>("load seeded media", (from, to) =>
      supabase.from("ls_listing_media").select("id, listing_id, path_key").in("listing_id", part).order("id").range(from, to)
    );
    for (const row of rows) {
      const hit = uris.get(mediaKey(row.listing_id, row.path_key));
      if (!hit) continue;
      siteMedia.push({ site_id: site.id, media_id: row.id, wix_file_id: hit.fileId, wix_image_uri: hit.uri, origin: "seeded" });
    }
  }
  for (const part of chunk(siteMedia, 500)) {
    const { data, error } = await supabase
      .from("ls_site_media")
      .upsert(part, { onConflict: "site_id,media_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`seed site media: ${errorMessage(error)}`);
    result.siteMediaRows += (data ?? []).length;
  }
  return result;
}
