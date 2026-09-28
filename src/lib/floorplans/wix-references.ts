// The builder1 and villages references a Floor Plans V2 row carries: the
// site's Builders item and its neighborhood's page, found by name in the
// collections the site's own schema points them at. Written with every row
// (writeback.ts) and kept true by the scheduled check (qmi-flags.ts).

import { logger } from "@/lib/shared/logger";
import { getDataCollection, queryItems, type WixDataItem } from "@/lib/wix/client";
import { findItemNamed, itemNamedAtStart, referencedCollectionOf } from "@/lib/floorplans/collection-schema";
import { normKey } from "@/lib/floorplans/types";

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
 * (collection-schema.ts, findItemNamed), and failing that the item whose
 * title the name begins with (itemNamedAtStart: "Del Webb Explore North
 * River Ranch" is the neighborhood "Del Webb Explore"). Draft items count:
 * Parrish's "Richmond American Homes" is a draft in its Builders, and a
 * read that asks for published items alone never found it (Jeff,
 * 2026-09-23); a published item wins over a draft of the same name. Null
 * when there is no such item or the lookup fails: the row is then written
 * without the reference, and one set by hand survives the read-merge on
 * update. Exported for tests.
 */
export async function referenceIdOf(wixSiteId: string, collectionId: string, title: string): Promise<string | null> {
  const wanted = title.trim();
  if (!wanted) return null;
  const cacheKey = `${wixSiteId}|${collectionId}|${wanted.toLowerCase()}`;
  const cached = referenceCache.get(cacheKey);
  if (cached) return cached;
  try {
    let { items } = await queryItems(wixSiteId, collectionId, { filter: { title: { $eq: wanted } }, limit: 10, includeDrafts: true });
    if (!items.length) {
      const loose = await queryItems(wixSiteId, collectionId, { filter: { title: { $contains: wanted } }, limit: 10, includeDrafts: true });
      const same = loose.items.filter((it) => normKey(String(it.data?.title ?? "")) === normKey(wanted));
      items = same.length ? same : loose.items.length === 1 ? loose.items : [];
    }
    if (!items.length) {
      const all = await queryItemsUpTo(wixSiteId, collectionId, REFERENCE_SCAN_CAP);
      const found = findItemNamed(all, wanted) ?? itemNamedAtStart(all, wanted);
      items = found ? [found] : [];
    }
    items = publishedFirst(items);
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

/** Published items before drafts, each kept in its order. */
const publishedFirst = (items: WixDataItem[]) =>
  [...items].sort((a, b) => Number(a.data?._publishStatus === "DRAFT") - Number(b.data?._publishStatus === "DRAFT"));

/** The first `cap` items of a collection, drafts included, a page at a time. */
async function queryItemsUpTo(wixSiteId: string, collectionId: string, cap: number): Promise<WixDataItem[]> {
  const all: WixDataItem[] = [];
  while (all.length < cap) {
    const { items, total } = await queryItems(wixSiteId, collectionId, {
      limit: Math.min(100, cap - all.length),
      offset: all.length,
      includeDrafts: true,
    });
    all.push(...items);
    if (!items.length || all.length >= total) break;
  }
  return all;
}

export interface PlanReferences {
  builderId: string | null;
  villageId: string | null;
}

/** A site as the reference lookups need it: where its Floor Plans V2 lives. */
export interface ReferenceSite {
  wix_site_id: string;
  wix_collection_id: string;
}

/**
 * Communities whose rows belong on another neighborhood's page than the
 * one named like them (Jeff, 2026-09-28): Parrish keeps pages for
 * "Crosswind Point" and "Crosswind Ranch", but their homes are shown on
 * "Crosswind"'s; "Del Webb Explore North River Ranch" is shown on "Del
 * Webb Explore"'s.
 */
export const VILLAGE_PAGES: Readonly<Record<string, string>> = {
  "Crosswind Point": "Crosswind",
  "Crosswind Ranch": "Crosswind",
  "Del Webb Explore North River Ranch": "Del Webb Explore",
};

/** The neighborhood page a community's rows point at, when it is not the one named like it. Pure; exported for tests. */
export function villagePageOf(communityName: string): string | null {
  const wanted = normKey(communityName);
  const found = Object.entries(VILLAGE_PAGES).find(([community]) => normKey(community) === wanted);
  return found ? found[1] : null;
}

/**
 * The builder1 and villages references for a row: the site's Builders item
 * and neighborhood item, by name, in the collections its own schema points
 * at; a community with a page of its own set out (VILLAGE_PAGES) points at
 * that page.
 */
export async function referencesFor(site: ReferenceSite, builderName: string, communityName: string): Promise<PlanReferences> {
  return referenceResolver(site)(builderName, communityName);
}

/**
 * referencesFor for many rows of one site: each name looked up once, a
 * name no item has included, so a check over every row of a site asks
 * Wix about each builder and neighborhood only once.
 */
export function referenceResolver(site: ReferenceSite): (builderName: string, communityName: string) => Promise<PlanReferences> {
  const targets = referenceTargetsOf(site.wix_site_id, site.wix_collection_id);
  const found = new Map<string, Promise<string | null>>();
  const lookUp = (field: keyof ReferenceTargets, name: string) => {
    const key = `${field}|${name.trim().toLowerCase()}`;
    if (!found.has(key)) found.set(key, targets.then((t) => referenceIdOf(site.wix_site_id, t[field], name)));
    return found.get(key)!;
  };
  return async (builderName, communityName) => {
    const [builderId, villageId] = await Promise.all([
      lookUp("builder1", builderName),
      lookUp("villages", villagePageOf(communityName) ?? communityName),
    ]);
    return { builderId, villageId };
  };
}
