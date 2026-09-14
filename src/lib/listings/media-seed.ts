// Seeds the site's media map from the galleries it already serves, so the
// engine reuses the photos a site has imported instead of downloading them
// again from MLSGrid (which allows one download per photo per hour and asks
// consumers to keep their own copies). Read-only on Wix: every gallery item
// with an MLS source URL and a Media Manager URI becomes a ls_listing_media
// row (identity: the stable path key) plus a ls_site_media row (origin
// 'seeded'). Listings unknown to the engine get a placeholder ls_listings
// row that the next pull overwrites; a full run verifies each of them
// against MLSGrid.
//
// Idempotent and repeatable: while the Velo pipeline still owns the live
// collection it re-uploads galleries and trashes the replaced files, so a
// seeded row follows the live gallery's current URI on every run. A row the
// engine imported itself (origin 'imported') is never touched here.

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
  /** ls_site_media rows added. */
  siteMediaRows: number;
  /** Seeded rows whose Media Manager URI changed since the last seed. */
  refreshed: number;
}

interface LiveGalleryItem {
  src?: unknown;
  mlsSourceUrl?: unknown;
  title?: unknown;
}

export async function seedSiteMediaFromLive(site: LsSite): Promise<MediaSeedResult> {
  if (!site.wix_site_id) throw new Error(`site ${site.domain} has no wix_site_id`);
  const items = await queryAllItems(site.wix_site_id, site.live_collection_id);
  const result: MediaSeedResult = { liveItems: items.length, galleryItems: 0, unkeyed: 0, placeholders: 0, mediaRows: 0, siteMediaRows: 0, refreshed: 0 };

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

  // Resolve media ids for every seeded photo.
  const listingIds = [...new Set(media.map((m) => m.listing_id))];
  const wanted: Array<{ mediaId: string; uri: string; fileId: string | null }> = [];
  for (const part of chunk(listingIds, 200)) {
    // A couple of hundred galleries is thousands of rows: page, never trust one response.
    const rows = await selectAll<{ id: string; listing_id: string; path_key: string }>("load seeded media", (from, to) =>
      supabase.from("ls_listing_media").select("id, listing_id, path_key").in("listing_id", part).order("id").range(from, to)
    );
    for (const row of rows) {
      const hit = uris.get(mediaKey(row.listing_id, row.path_key));
      if (hit) wanted.push({ mediaId: row.id, uri: hit.uri, fileId: hit.fileId });
    }
  }

  // Record the site's URI: new rows are added, seeded rows follow the live
  // gallery, rows the engine imported itself are left alone.
  const existing = new Map<string, { origin: string; wix_image_uri: string }>();
  for (const part of chunk(wanted.map((w) => w.mediaId), 200)) {
    const rows = await selectAll<{ media_id: string; origin: string; wix_image_uri: string }>("load site media", (from, to) =>
      supabase.from("ls_site_media").select("media_id, origin, wix_image_uri").eq("site_id", site.id).in("media_id", part).order("id").range(from, to)
    );
    for (const row of rows) existing.set(row.media_id, row);
  }
  const upserts: Array<Record<string, unknown>> = [];
  for (const w of wanted) {
    const prior = existing.get(w.mediaId);
    if (prior) {
      if (prior.origin !== "seeded" || prior.wix_image_uri === w.uri) continue;
      result.refreshed += 1;
    } else {
      result.siteMediaRows += 1;
    }
    upserts.push({ site_id: site.id, media_id: w.mediaId, wix_file_id: w.fileId, wix_image_uri: w.uri, origin: "seeded" });
  }
  for (const part of chunk(upserts, 500)) {
    const { error } = await supabase.from("ls_site_media").upsert(part, { onConflict: "site_id,media_id" });
    if (error) throw new Error(`seed site media: ${errorMessage(error)}`);
  }
  return result;
}
