// Data access for the ls_ tables. Thin, chunked, and typed just enough; the
// engine's logic lives in reconcile.ts and friends, not here.

import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/shared/errors";
import type {
  LsListingMediaInput,
  LsListingRow,
  LsSite,
  LsSiteListing,
  LsVillage,
  VillageWithTerms,
} from "@/lib/listings/types";

const IN_CHUNK = 200;
const LISTING_UPSERT_CHUNK = 50; // raw JSON is 10-25 KB a row
const MEDIA_UPSERT_CHUNK = 500;

/** Composite key for (listing, photo) lookups; ids and path keys never contain "::". */
export const mediaKey = (listingId: string, pathKey: string): string => `${listingId}::${pathKey}`;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(context: string, error: unknown): never {
  throw new Error(`${context}: ${errorMessage(error)}`);
}

/** PostgREST answers at most this many rows a request, whatever the query asks for. */
const PAGE = 1000;

/**
 * Pages a query with a stable order until it runs dry. Every select that can
 * exceed a thousand rows goes through here: a site's inventory, or the
 * photos of a couple of hundred listings, are both bigger than one page,
 * and a capped result silently drops the rest.
 */
export async function selectAll<T>(
  context: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(context, error);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadActiveSites(siteIds?: string[]): Promise<LsSite[]> {
  let query = supabase.from("ls_sites").select("*").eq("active", true).order("domain");
  if (siteIds?.length) query = query.in("id", siteIds);
  const { data, error } = await query;
  if (error) fail("load sites", error);
  return (data ?? []) as LsSite[];
}

export async function loadVillagesWithTerms(siteId: string): Promise<VillageWithTerms[]> {
  const [{ data: villages, error: e1 }, terms] = await Promise.all([
    supabase.from("ls_villages").select("*").eq("site_id", siteId).order("name"),
    selectAll<{ village_id: string; term: string; street_term: string | null }>("load village terms", (from, to) =>
      supabase.from("ls_village_terms").select("village_id, term, street_term").eq("site_id", siteId).order("id").range(from, to)
    ),
  ]);
  if (e1) fail("load villages", e1);
  const byVillage = new Map<string, { term: string; street_term: string | null }[]>();
  for (const t of terms) {
    const list = byVillage.get(t.village_id) ?? [];
    list.push({ term: t.term, street_term: t.street_term });
    byVillage.set(t.village_id, list);
  }
  return ((villages ?? []) as LsVillage[]).map((v) => ({ ...v, terms: byVillage.get(v.id) ?? [] }));
}

export async function upsertListings(rows: LsListingRow[]): Promise<void> {
  for (const part of chunk(rows, LISTING_UPSERT_CHUNK)) {
    const { error } = await supabase.from("ls_listings").upsert(part, { onConflict: "listing_id" });
    if (error) fail("upsert listings", error);
  }
}

/** Every listing id the engine knows that MLSGrid has not dropped. */
export async function loadKnownListingIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("ls_listings")
      .select("listing_id")
      .eq("in_feed", true)
      .order("listing_id")
      .range(from, from + 999);
    if (error) fail("load listing ids", error);
    const page = (data ?? []) as { listing_id: string }[];
    ids.push(...page.map((r) => r.listing_id));
    if (page.length < 1000) return ids;
  }
}

export async function markNotInFeed(listingIds: string[], at: Date): Promise<void> {
  for (const part of chunk(listingIds, IN_CHUNK)) {
    const { error } = await supabase
      .from("ls_listings")
      .update({ in_feed: false, last_seen_at: at.toISOString() })
      .in("listing_id", part);
    if (error) fail("mark not in feed", error);
  }
}

export async function loadListings(listingIds: string[]): Promise<Map<string, LsListingRow>> {
  const out = new Map<string, LsListingRow>();
  for (const part of chunk(listingIds, IN_CHUNK)) {
    const { data, error } = await supabase.from("ls_listings").select("*").in("listing_id", part);
    if (error) fail("load listings", error);
    for (const row of (data ?? []) as LsListingRow[]) out.set(row.listing_id, row);
  }
  return out;
}

/**
 * Replaces each pulled listing's media set: upsert the incoming rows by
 * (listing_id, path_key), then drop rows the pull no longer lists. Three
 * batched query groups rather than two queries per listing.
 */
export async function replaceListingMedia(media: LsListingMediaInput[], listingIds: string[]): Promise<{ removed: number }> {
  for (const part of chunk(media, MEDIA_UPSERT_CHUNK)) {
    const { error } = await supabase.from("ls_listing_media").upsert(part, { onConflict: "listing_id,path_key" });
    if (error) fail("upsert listing media", error);
  }
  const incoming = new Set(media.map((m) => mediaKey(m.listing_id, m.path_key)));
  const stale: string[] = [];
  for (const part of chunk(listingIds, IN_CHUNK)) {
    const rows = await selectAll<{ id: string; listing_id: string; path_key: string }>("load listing media", (from, to) =>
      supabase.from("ls_listing_media").select("id, listing_id, path_key").in("listing_id", part).order("id").range(from, to)
    );
    for (const row of rows) {
      if (!incoming.has(mediaKey(row.listing_id, row.path_key))) stale.push(row.id);
    }
  }
  for (const part of chunk(stale, IN_CHUNK)) {
    const { error } = await supabase.from("ls_listing_media").delete().in("id", part);
    if (error) fail("delete stale media", error);
  }
  return { removed: stale.length };
}

export async function loadSiteListings(siteId: string, listingIds?: string[]): Promise<Map<string, LsSiteListing>> {
  const out = new Map<string, LsSiteListing>();
  const parts: Array<string[] | null> = listingIds ? chunk(listingIds, IN_CHUNK) : [null];
  for (const part of parts) {
    const rows = await selectAll<LsSiteListing>("load site listings", (from, to) => {
      let query = supabase.from("ls_site_listings").select("*").eq("site_id", siteId);
      if (part) query = query.in("listing_id", part);
      return query.order("id").range(from, to);
    });
    for (const row of rows) out.set(row.listing_id, row);
  }
  return out;
}

/**
 * Upserts patches keyed by (site_id, listing_id). Rows are grouped by their
 * key set first: PostgREST writes every column named in a batch for every
 * row of the batch, so a row missing a key another row carries would have
 * that column nulled instead of left alone.
 */
export async function upsertSiteListings(rows: Array<Record<string, unknown>>): Promise<void> {
  for (const group of groupByKeys(rows).values()) {
    for (const part of chunk(group, IN_CHUNK)) {
      const { error } = await supabase.from("ls_site_listings").upsert(part, { onConflict: "site_id,listing_id" });
      if (error) fail("upsert site listings", error);
    }
  }
}

/** Exported for tests: rows bucketed by their sorted key list. */
export function groupByKeys<T extends Record<string, unknown>>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const signature = Object.keys(row).sort().join(",");
    const list = groups.get(signature) ?? [];
    list.push(row);
    groups.set(signature, list);
  }
  return groups;
}

export async function updateSiteListing(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("ls_site_listings").update(patch).eq("id", id);
  if (error) fail("update site listing", error);
}

/** Site listings due for a write: flagged, never written, or written too long ago. */
export async function loadWritableSiteListings(siteId: string, refreshBefore: Date): Promise<LsSiteListing[]> {
  return selectAll<LsSiteListing>("load writable site listings", (from, to) =>
    supabase
      .from("ls_site_listings")
      .select("*")
      .eq("site_id", siteId)
      .in("state", ["staged", "live"])
      .or(`needs_write.eq.true,written_at.is.null,written_at.lt.${refreshBefore.toISOString()}`)
      .order("listing_id")
      .range(from, to)
  );
}

export async function loadPendingRemovals(siteId: string): Promise<LsSiteListing[]> {
  return selectAll<LsSiteListing>("load pending removals", (from, to) =>
    supabase
      .from("ls_site_listings")
      .select("*")
      .eq("site_id", siteId)
      .eq("state", "removed")
      .eq("needs_write", true)
      .order("listing_id")
      .range(from, to)
  );
}

export async function countLiveSiteListings(siteId: string): Promise<number> {
  const { count, error } = await supabase
    .from("ls_site_listings")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("state", "live");
  if (error) fail("count live site listings", error);
  return count ?? 0;
}

export interface SiteGalleryPhoto {
  mediaId: string;
  position: number;
  pathKey: string;
  title: string | null;
  /** The site's Media Manager URI, when the photo has been imported there. */
  src: string | null;
}

/** Every photo of the given listings, in order, with the site's imported URI where one exists. */
export async function loadSiteGalleries(siteId: string, listingIds: string[]): Promise<Map<string, SiteGalleryPhoto[]>> {
  const out = new Map<string, SiteGalleryPhoto[]>();
  const mediaIds: string[] = [];
  const photos: Array<SiteGalleryPhoto & { listingId: string }> = [];
  for (const part of chunk(listingIds, IN_CHUNK)) {
    const rows = await selectAll<{ id: string; listing_id: string; position: number; path_key: string; title: string | null }>("load galleries", (from, to) =>
      supabase.from("ls_listing_media").select("id, listing_id, position, path_key, title").in("listing_id", part).order("id").range(from, to)
    );
    for (const row of rows) {
      photos.push({ mediaId: row.id, listingId: row.listing_id, position: row.position, pathKey: row.path_key, title: row.title, src: null });
      mediaIds.push(row.id);
    }
  }
  const uris = new Map<string, string>();
  for (const part of chunk(mediaIds, IN_CHUNK)) {
    const rows = await selectAll<{ media_id: string; wix_image_uri: string }>("load site media", (from, to) =>
      supabase.from("ls_site_media").select("media_id, wix_image_uri").eq("site_id", siteId).in("media_id", part).order("id").range(from, to)
    );
    for (const row of rows) uris.set(row.media_id, row.wix_image_uri);
  }
  for (const photo of photos) {
    const list = out.get(photo.listingId) ?? [];
    list.push({ ...photo, src: uris.get(photo.mediaId) ?? null });
    out.set(photo.listingId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.position - b.position);
  return out;
}

export async function refreshVillageCounts(siteId: string): Promise<{ changed: number }> {
  const [{ data: villages, error: e1 }, live] = await Promise.all([
    supabase.from("ls_villages").select("id, active_listing_count, zero_since").eq("site_id", siteId),
    selectAll<{ village_id: string | null }>("load live site listings", (from, to) =>
      supabase.from("ls_site_listings").select("village_id").eq("site_id", siteId).eq("state", "live").order("id").range(from, to)
    ),
  ]);
  if (e1) fail("load village counts", e1);
  const counts = new Map<string, number>();
  for (const row of live) {
    if (row.village_id) counts.set(row.village_id, (counts.get(row.village_id) ?? 0) + 1);
  }
  let changed = 0;
  const now = new Date().toISOString();
  for (const v of (villages ?? []) as { id: string; active_listing_count: number; zero_since: string | null }[]) {
    const count = counts.get(v.id) ?? 0;
    const zeroSince = count === 0 ? (v.zero_since ?? now) : null;
    if (count === v.active_listing_count && zeroSince === v.zero_since) continue;
    const { error } = await supabase.from("ls_villages").update({ active_listing_count: count, zero_since: zeroSince }).eq("id", v.id);
    if (error) fail("update village count", error);
    changed += 1;
  }
  return { changed };
}

// ---- the photo job ----

/** One photo of a listing some site still lacks, from ls_photo_backlog (migration 045). */
export interface PhotoBacklogRow {
  listing_id: string;
  media_id: string;
  position: number;
  path_key: string;
  title: string | null;
  source_url: string | null;
  source_url_received_at: string | null;
  storage_path: string | null;
  content_hash: string | null;
  retry_after: string | null;
  download_attempts: number;
  /** Active, unpaused sites showing (or about to show) the listing that do not have this photo yet. */
  site_ids: string[];
}

/**
 * Every photo of up to `maxListings` listings with photo work pending,
 * longest-waiting listing first. On a shadow-mode site a photo counts as
 * lacking only after `shadowGraceMinutes`, so the engine does not race the
 * Velo pipeline for MLSGrid's one download per photo per hour.
 */
export async function loadPhotoBacklog(maxListings: number, shadowGraceMinutes = 90): Promise<PhotoBacklogRow[]> {
  const { data, error } = await supabase.rpc("ls_photo_backlog", { max_listings: maxListings, shadow_grace_minutes: shadowGraceMinutes });
  if (error) fail("load photo backlog", error);
  return ((data ?? []) as PhotoBacklogRow[]).map((r) => ({ ...r, site_ids: r.site_ids ?? [] }));
}

export async function updateListingMedia(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("ls_listing_media").update(patch).eq("id", id);
  if (error) fail("update listing media", error);
}

/** Puts a listing's undownloaded photos on hold until `until`. */
export async function coolDownListingMedia(listingId: string, until: Date, reason: string): Promise<void> {
  const { error } = await supabase
    .from("ls_listing_media")
    .update({ retry_after: until.toISOString(), last_error: reason })
    .eq("listing_id", listingId)
    .is("storage_path", null);
  if (error) fail("cool down listing media", error);
}

/** The stored copy of these exact bytes, if another photo already carries them (the same image under two listings). */
export async function findStoredByHash(hash: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("ls_listing_media")
    .select("storage_path")
    .eq("content_hash", hash)
    .not("storage_path", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) fail("find stored media by hash", error);
  return (data as { storage_path: string | null } | null)?.storage_path ?? null;
}

export async function upsertSiteMedia(
  rows: Array<{ site_id: string; media_id: string; wix_file_id: string | null; wix_image_uri: string; origin: "seeded" | "imported" }>
): Promise<void> {
  for (const part of chunk(rows, MEDIA_UPSERT_CHUNK)) {
    const { error } = await supabase.from("ls_site_media").upsert(part, { onConflict: "site_id,media_id" });
    if (error) fail("upsert site media", error);
  }
}

// ---- neighborhood stats ----

/** One of a site's live listings with what the neighborhood stats need, keyed to its neighborhood's Wix item. */
export interface LiveListingStatsRow {
  wix_item_id: string | null;
  list_price: number | null;
  living_area: number | null;
  bedrooms: number | null;
  garage_spaces: number | null;
}

export async function loadLiveListingStats(siteId: string): Promise<LiveListingStatsRow[]> {
  const [{ data: villages, error: villagesError }, rows] = await Promise.all([
    supabase.from("ls_villages").select("id, wix_item_id").eq("site_id", siteId),
    selectAll<{ village_id: string | null; ls_listings: { list_price: number | null; living_area: number | null; bedrooms: number | null; garage_spaces: unknown } | null }>(
      "load live listing stats",
      (from, to) =>
        supabase
          .from("ls_site_listings")
          .select("village_id, ls_listings(list_price, living_area, bedrooms, garage_spaces:raw->GarageSpaces)")
          .eq("site_id", siteId)
          .eq("state", "live")
          .not("village_id", "is", null)
          .order("id")
          .range(from, to)
    ),
  ]);
  if (villagesError) fail("load villages", villagesError);
  const wixIds = new Map(((villages ?? []) as { id: string; wix_item_id: string | null }[]).map((v) => [v.id, v.wix_item_id]));
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  return rows.map((r) => ({
    wix_item_id: r.village_id ? (wixIds.get(r.village_id) ?? null) : null,
    list_price: num(r.ls_listings?.list_price),
    living_area: num(r.ls_listings?.living_area),
    bedrooms: num(r.ls_listings?.bedrooms),
    garage_spaces: num(r.ls_listings?.garage_spaces),
  }));
}
