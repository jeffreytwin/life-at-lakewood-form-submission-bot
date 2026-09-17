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
//   4. The neighborhoods, and the subdivision terms the site's own
//      listings imply for them -- the exact output the
//      `source: "site-collections"` village import would write, printed as
//      SQL so it can be reviewed before anything is written.
//   5. The Media Manager folders, so the photo folder in migration 051 can
//      be confirmed to exist (a named folder that does not resolve holds
//      every photo import for the site).

import { getDataCollection, listMediaFolders, queryAllItems, type WixItemData } from "@/lib/wix/client";
import { buildListingRecord } from "@/lib/listings/transform";
import { deriveVillageSeed, type ObservedListing } from "@/lib/listings/seed-villages";
import type { VillageWithTerms } from "@/lib/listings/types";

const SITE_ID = process.env.LS_WELLEN_SITE_ID || "1a8c2755-823e-4882-ae32-e6c108a30e39";
const DOMAIN = process.env.LS_WELLEN_DOMAIN || "lifeinwellenpark.com";
const LIVE = process.env.LS_WELLEN_LIVE_COLLECTION || "HousesforSale";
const SHADOW = process.env.LS_WELLEN_SHADOW_COLLECTION || "HousesforSale2";
const NEIGHBORHOODS = process.env.LS_WELLEN_VILLAGES_COLLECTION || "HousesforSale-DynamicPages";
const MEDIA_FOLDER = process.env.LS_WELLEN_MEDIA_FOLDER || "WellenParkListingPhotos";
const SYSTEM_FIELDS = new Set(["_id", "_owner", "_createdDate", "_updatedDate", "_publishStatus", "_publishDate", "_draftDate"]);

const log = (line = "") => console.log(line ? `WP: ${line}` : "");
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

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
  for (const id of ids) {
    const collection = await getDataCollection(SITE_ID, id).catch((error) => {
      log(`  ${id}: could not be read (${error instanceof Error ? error.message : String(error)})`);
      return null;
    });
    collections.set(id, collection);
    log(
      collection
        ? `  ${id}: "${collection.displayName ?? id}", ${collection.fields.length} fields`
        : `  ${id}: not on this site`
    );
  }
  const live = collections.get(LIVE);
  const shadow = collections.get(SHADOW);
  if (!live) {
    log(`${LIVE} is missing; nothing else can be checked. Stopping.`);
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
  const seed = deriveVillageSeed(neighborhoods, observed);
  log(
    `neighborhood seed: ${seed.villages.length} neighborhoods, ${seed.villages.reduce((n, v) => n + v.terms.length, 0)} terms, ` +
      `${seed.skippedRows} unnamed row(s), ${seed.orphanListings} listing(s) filed under no neighborhood`
  );
  for (const village of seed.villages) {
    log(`  ${village.name} [${village.wix_item_id}]`);
    log(`      terms: ${village.terms.join(" | ") || "(none -- no listing to learn from; add one in the Hub)"}`);
    if (village.subdivisions.length) log(`      from:  ${village.subdivisions.join(" / ")}`);
    if (village.uncovered.length) log(`      NOT COVERED: ${village.uncovered.join(" / ")}`);
  }
  if (seed.termless.length) log(`termless neighborhoods (${seed.termless.length}): ${seed.termless.join(", ")}`);

  // The same rows as SQL, for review before the import writes them.
  log();
  log(`-- ${seed.villages.length} neighborhoods, ${seed.villages.reduce((n, v) => n + v.terms.length, 0)} terms, from ${DOMAIN}'s own collections`);
  log(`WITH site AS (SELECT id FROM ls_sites WHERE domain = ${sql(DOMAIN)}),`);
  log(`village_rows(name, wix_slug, wix_item_id, page_url, display) AS (VALUES`);
  log(
    seed.villages
      .map((v) => `    (${sql(v.name)}, ${v.wix_slug ? sql(v.wix_slug) : "NULL"}, ${sql(v.wix_item_id)}, ${v.page_url ? sql(v.page_url) : "NULL"}, ${sql(JSON.stringify(v.display))}::jsonb)`)
      .join(",\n")
  );
  log(`)`);
  log(`INSERT INTO ls_villages (site_id, name, wix_slug, wix_item_id, page_url, display)`);
  log(`SELECT site.id, v.name, v.wix_slug, v.wix_item_id, v.page_url, v.display FROM village_rows v, site`);
  log(`ON CONFLICT (site_id, name) DO UPDATE SET wix_slug = EXCLUDED.wix_slug, wix_item_id = EXCLUDED.wix_item_id, page_url = EXCLUDED.page_url, display = EXCLUDED.display, updated_at = now();`);
  const termRows = seed.villages.flatMap((v) => v.terms.map((t) => `    (${sql(v.name)}, ${sql(t)})`));
  if (termRows.length) {
    log();
    log(`WITH site AS (SELECT id FROM ls_sites WHERE domain = ${sql(DOMAIN)}),`);
    log(`term_rows(village_name, term) AS (VALUES`);
    log(termRows.join(",\n"));
    log(`)`);
    log(`INSERT INTO ls_village_terms (site_id, village_id, term)`);
    log(`SELECT site.id, v.id, t.term FROM term_rows t JOIN site ON true JOIN ls_villages v ON v.site_id = site.id AND v.name = t.village_name`);
    log(`ON CONFLICT DO NOTHING;`);
  }
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
