// Life in Wellen Park onboarding probe: everything the site row in
// migration 051 and its first shadow run depend on, read from the live Wix
// site in one build log. Read-only -- it queries collections and lists
// Media Manager folders, and writes nothing anywhere.
//
// Run by scripts/listings-wellen-probe.mjs (the build-step guard); see that
// file for the environment it needs. What it answers:
//
//   1. Which collections the site has: the one it renders, the shadow
//      collection the engine writes to until cutover, the neighborhoods,
//      and whether there is a Villages collection (there is none on the
//      MPC sites, which is why the terms are derived instead of imported).
//   2. Whether the shadow collection can hold what the engine writes --
//      every field buildListingRecord produces, checked against both
//      collections' schemas.
//   3. Which cities the site's own listings are in, which is what
//      ls_sites.market_cities has to cover. Wellen Park sits across
//      Venice, North Port and Englewood, so this is the one setting that
//      cannot be read off a single city name.
//   4. Whether the transcribed neighborhood terms (migration 052, from the
//      site's dashboard page) still file every live listing where the site
//      itself has it -- a regression check on the port -- and what the
//      derivation in seed-villages.ts would have said instead, so a
//      neighborhood the dashboard chain has drifted away from shows up.
//   5. The Media Manager folders, so the photo folder in migration 051 can
//      be confirmed to exist (a named folder that does not resolve holds
//      every photo import for the site).

import { getDataCollection, listMediaFolders, queryAllItems, type WixItemData } from "@/lib/wix/client";
import { buildListingRecord } from "@/lib/listings/transform";
import { matchVillage } from "@/lib/listings/classify";
import { deriveVillageSeed, type ObservedListing } from "@/lib/listings/seed-villages";
import type { VillageWithTerms } from "@/lib/listings/types";
import { wellenVillages } from "./listings-wellen-villages.mjs";

/** One neighborhood as scripts/listings-wellen-villages.mjs transcribes it. */
interface TranscribedVillage {
  name: string;
  slug: string;
  itemId: string;
  pageUrl: string;
  display: Record<string, string>;
  terms: Array<{ term: string; exclude_term: string | null }>;
}

const SITE_ID = process.env.LS_WELLEN_SITE_ID || "1a8c2755-823e-4882-ae32-e6c108a30e39";
const DOMAIN = process.env.LS_WELLEN_DOMAIN || "lifeinwellenpark.com";
const LIVE = process.env.LS_WELLEN_LIVE_COLLECTION || "HousesforSale";
const SHADOW = process.env.LS_WELLEN_SHADOW_COLLECTION || "HousesforSale2";
const NEIGHBORHOODS = process.env.LS_WELLEN_VILLAGES_COLLECTION || "HousesforSale-DynamicPages";
const MEDIA_FOLDER = process.env.LS_WELLEN_MEDIA_FOLDER || "WellenParkListingPhotos";
const SYSTEM_FIELDS = new Set(["_id", "_owner", "_createdDate", "_updatedDate", "_publishStatus", "_publishDate", "_draftDate"]);

const log = (line = "") => console.log(line ? `WP: ${line}` : "");
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The fields the engine writes to a site's collection, from the transform itself. */
function writtenFields(): string[] {
  const village: VillageWithTerms = {
    id: "probe",
    site_id: "probe",
    name: "Probe",
    wix_slug: "probe",
    wix_item_id: "probe",
    page_url: `https://www.${DOMAIN}/neighborhood/probe`,
    display: {},
    active: true,
    active_listing_count: 0,
    zero_since: null,
    terms: [],
  };
  const record = buildListingRecord({
    listing: { listing_id: "PROBE", raw: { ListingId: "PROBE" }, modification_timestamp: null },
    village,
    gallery: [],
    pulledAt: new Date(),
    priceSortStyle: "shorthand",
  });
  return Object.keys(record).filter((k) => !SYSTEM_FIELDS.has(k));
}

/** A listing's city, wherever the site's collection keeps it. */
function cityOf(data: WixItemData): string | null {
  const address = data.propertyAddressGoogleMaps;
  if (address && typeof address === "object") {
    const city = text((address as Record<string, unknown>).city);
    if (city) return city;
  }
  // "12180 Wellen Golf Street, Venice, FL 34293"
  const parts = text(data.propertyAddress)?.split(",") ?? [];
  return parts.length >= 3 ? text(parts[parts.length - 2]) : null;
}

const tally = (values: Array<string | null>): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value ?? "(blank)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

async function main() {
  log(`site ${DOMAIN} (${SITE_ID})`);

  // ---- 1. Collections ----
  const ids = [LIVE, SHADOW, NEIGHBORHOODS, "Villages"];
  const collections = new Map<string, Awaited<ReturnType<typeof getDataCollection>>>();
  // "Absent" and "could not be asked" are different answers and lead
  // different places: one means create the collection, the other means the
  // API key cannot see it. getDataCollection returns null only for a real
  // 404 and throws for everything else, so the two are kept apart here.
  const unreadable = new Map<string, string>();
  for (const id of ids) {
    const collection = await getDataCollection(SITE_ID, id).catch((error) => {
      unreadable.set(id, error instanceof Error ? error.message : String(error));
      return null;
    });
    collections.set(id, collection);
    const failure = unreadable.get(id);
    log(
      collection
        ? `  ${id}: "${collection.displayName ?? id}", ${collection.fields.length} fields`
        : failure
          ? `  ${id}: could not be read -- ${failure}`
          : `  ${id}: not on this site`
    );
  }
  const live = collections.get(LIVE);
  const shadow = collections.get(SHADOW);
  if (!live) {
    log(
      unreadable.has(LIVE)
        ? `${LIVE} could not be read, so this says nothing about whether it exists -- check the API key's access to this site. Stopping.`
        : `${LIVE} is not on this site; nothing else can be checked. Stopping.`
    );
    return;
  }
  if (collections.get("Villages")) {
    log(`Villages exists after all: the Longboat Key import (source "villages") may suit this site better.`);
  }

  // ---- 2. Can the shadow collection hold what the engine writes? ----
  const written = writtenFields();
  const liveKeys = new Set(live.fields.map((f) => f.key));
  const missingOnLive = written.filter((f) => !liveKeys.has(f));
  log(`engine writes ${written.length} fields; ${LIVE} is missing ${missingOnLive.length ? missingOnLive.join(", ") : "none"}`);
  if (!shadow) {
    const dataFields = live.fields.filter((f) => !SYSTEM_FIELDS.has(f.key) && f.type !== "PAGE_LINK" && !f.key.startsWith("link-"));
    log(`${SHADOW} has to be created before the site is switched on: duplicate ${LIVE} without data, admin-only writes.`);
    log(`  its ${dataFields.length} data fields: ${dataFields.map((f) => `${f.key}:${f.type ?? "?"}`).join(", ")}`);
  } else {
    const shadowKeys = new Set(shadow.fields.map((f) => f.key));
    const missingOnShadow = written.filter((f) => !shadowKeys.has(f));
    const drift = live.fields.filter((f) => !shadowKeys.has(f.key)).map((f) => f.key);
    log(`${SHADOW} is missing ${missingOnShadow.length ? missingOnShadow.join(", ") : "none"} of them; ${drift.length} field(s) of ${LIVE} absent: ${drift.join(", ") || "none"}`);
  }

  // ---- 3 + 4. What the site is showing today ----
  const [listingItems, neighborhoodItems] = await Promise.all([
    queryAllItems(SITE_ID, LIVE),
    collections.get(NEIGHBORHOODS) ? queryAllItems(SITE_ID, NEIGHBORHOODS) : Promise.resolve([]),
  ]);
  log(`${LIVE}: ${listingItems.length} rows; ${NEIGHBORHOODS}: ${neighborhoodItems.length} rows`);

  const cities = tally(listingItems.map((item) => cityOf(item.data)));
  log(`cities on those rows (ls_sites.market_cities must cover every one):`);
  for (const [city, count] of cities) log(`  ${count.toString().padStart(4)}  ${city}`);

  const statuses = tally(listingItems.map((item) => text(item.data.standardStatus)));
  log(`statuses: ${statuses.map(([s, n]) => `${s} ${n}`).join(", ")}`);
  const priceTags = tally(
    listingItems.flatMap((item) => (Array.isArray(item.data.listingPriceSort) ? item.data.listingPriceSort.map((v) => text(v)) : [text(item.data.listingPriceSort)]))
  );
  log(`price filter tags (051 says shorthand: "$300s", "2M+"): ${priceTags.slice(0, 8).map(([t, n]) => `${t} ${n}`).join(", ") || "none"}`);

  const neighborhoods = neighborhoodItems.map((item) => ({
    ...item.data,
    _id: typeof item.data._id === "string" ? item.data._id : item.id,
  }));
  const observed: ObservedListing[] = listingItems.map((item) => ({
    subdivision: text(item.data.subdivision),
    villageItemId: text(item.data.village1),
    villageName: text(item.data.village),
  }));
  // The terms migration 052 carries, against the rows the site has now:
  // every live listing should land back on the neighborhood it already sits
  // in. A mismatch means the transcription drifted from the dashboard, or
  // the dashboard has since changed.
  const transcribed = wellenVillages() as unknown as TranscribedVillage[];
  const asVillages: VillageWithTerms[] = transcribed.map((v) => ({
    id: v.itemId,
    site_id: "wellen",
    name: v.name,
    wix_slug: v.slug,
    wix_item_id: v.itemId,
    page_url: v.pageUrl,
    display: v.display,
    active: true,
    active_listing_count: 0,
    zero_since: null,
    terms: v.terms.map((t) => ({ term: t.term, street_term: null, exclude_term: t.exclude_term })),
  }));
  log(`transcribed seed (migration 052): ${transcribed.length} neighborhoods, ${transcribed.reduce((n, v) => n + v.terms.length, 0)} terms`);

  let agreed = 0;
  const mismatches: string[] = [];
  const unclaimed: string[] = [];
  for (const item of listingItems) {
    const subdivision = text(item.data.subdivision);
    const site = text(item.data.village);
    if (!subdivision || !site) continue;
    const mine = matchVillage(subdivision, null, asVillages)?.name ?? null;
    if (mine === site) agreed += 1;
    else if (mine === null) unclaimed.push(`${subdivision} -> the site says ${site}, the terms match nothing`);
    else mismatches.push(`${subdivision} -> the site says ${site}, the terms say ${mine}`);
  }
  log(`the terms agree with the site on ${agreed} of ${agreed + mismatches.length + unclaimed.length} rows`);
  for (const line of [...mismatches, ...unclaimed]) log(`  MISMATCH ${line}`);

  // What the site's own data would have implied, for comparison: a
  // neighborhood or spelling here that the transcription lacks is one the
  // dashboard chain has drifted away from.
  const seed = deriveVillageSeed(neighborhoods, observed);
  const known = new Map(transcribed.map((v) => [v.name, v]));
  log(`derived seed, for comparison: ${seed.villages.length} neighborhoods, ${seed.villages.reduce((n, v) => n + v.terms.length, 0)} terms, ${seed.orphanListings} listing(s) filed under no neighborhood`);
  for (const village of seed.villages) {
    const match = known.get(village.name);
    if (!match) {
      log(`  NOT IN 052: ${village.name} [${village.wix_item_id}] terms ${village.terms.join(" | ") || "(none)"}`);
      continue;
    }
    if (match.itemId !== village.wix_item_id) log(`  ITEM ID DIFFERS: ${village.name} -- 052 has ${match.itemId}, the site's rows point at ${village.wix_item_id}`);
    const extra = village.terms.filter((t) => !match.terms.some((m) => t.includes(m.term)));
    if (extra.length) log(`  ${village.name}: the site's rows also suggest ${extra.join(" | ")}`);
  }
  if (seed.termless.length) log(`neighborhoods with nothing for sale today: ${seed.termless.join(", ")}`);
  log();

  // ---- 5. Media Manager ----
  const folders = await listMediaFolders(SITE_ID).catch((error) => {
    log(`media folders could not be listed (${error instanceof Error ? error.message : String(error)})`);
    return [];
  });
  const target = folders.find((f) => f.displayName === MEDIA_FOLDER);
  log(`media folders at the root (${folders.length}): ${folders.map((f) => f.displayName).join(", ") || "none"}`);
  log(target ? `${MEDIA_FOLDER} exists (${target.id})` : `${MEDIA_FOLDER} does not exist yet; create it, or photo imports will hold with folder_missing`);
}

main().then(
  () => log("done."),
  (error) => log(`failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
);
