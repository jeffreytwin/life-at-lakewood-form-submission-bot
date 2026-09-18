// Life At Lakewood onboarding probe: everything migration 057 asserts and
// everything migration 058's terms are betting on, read from the live Wix
// site and from MLSGrid in one build log. Read-only -- it queries
// collections, lists Media Manager folders and pages MLSGrid's Active
// listings, and writes nothing anywhere.
//
// Run by scripts/listings-lakewood-probe.mjs (the build-step guard); see
// that file for the environment it needs.
//
// WHY THIS SITE GETS A PROBE THE OTHERS DID NOT. Wellen Park was switched on
// in shadow and its bad term was caught by watching what staged -- four
// Englewood listings in the first minutes (migration 056). That worked
// because the mistake was loud and the market was small. This market is
// Lakewood Ranch, Bradenton and Sarasota, and six of the site's terms have
// no anchor available in the way the MLS writes the name: aurora, cresswind,
// del webb, indigo, lake club, palisades. Watching a bare term fail across a
// market this size costs a photo backfill to find out. Section 5 asks the
// MLS instead.
//
// What it answers:
//
//   1. Which collections the site has: the one it renders, the shadow
//      collection the engine writes to until cutover, and the neighborhoods.
//   2. Whether the shadow collection can hold what the engine writes --
//      every field buildListingRecord produces, checked against both
//      collections' schemas.
//   3. Which cities the site's own listings are in, and its statuses and
//      price tags -- ls_sites.market_cities and price_sort_style in 057.
//   4. Whether migration 058's terms file every live listing exactly where
//      the site files it today. The fixture in __tests__ is a snapshot of
//      one export; this is the same check against the collection as it
//      stands at build time.
//   5. **The market test.** Every Active listing in the three cities, and
//      for each term: what it matches that the site does not already show.
//      A term that only ever matches subdivisions the site carries is safe.
//      A term that reaches a stranger's subdivision is the Wellen Park
//      failure waiting to happen, and is printed in full.
//   6. What the engine will drop that the collection currently shows: new
//      construction (the engine excludes builder listings on every site) and
//      Coming Soon (the dashboard chain let it through by a precedence bug).
//   7. The Media Manager folder, so LifeAtLakewoodListingPhotos in 057 can
//      be confirmed to exist -- a named folder that does not resolve holds
//      every photo import for the site.

import { getDataCollection, listMediaFolders, queryAllItems, type WixItemData } from "@/lib/wix/client";
import { buildListingRecord } from "@/lib/listings/transform";
import { matchVillage } from "@/lib/listings/classify";
import { MlsGridClient } from "@/lib/listings/mlsgrid";
import type { MlsGridProperty, VillageWithTerms } from "@/lib/listings/types";
import { lakewoodVillages, BARE_TERMS } from "./listings-lakewood-villages.mjs";

/** One neighborhood as scripts/listings-lakewood-villages.mjs transcribes it. */
interface TranscribedVillage {
  name: string;
  slug: string;
  itemId: string;
  pageUrl: string;
  display: Record<string, string>;
  terms: Array<{ term: string; exclude_term: string | null }>;
  unconfirmed: boolean;
}

const SITE_ID = process.env.LS_LAKEWOOD_SITE_ID || "4fbabb96-2d6c-4f20-a240-9223153498b5";
const DOMAIN = process.env.LS_LAKEWOOD_DOMAIN || "lifeatlakewood.com";
const LIVE = process.env.LS_LAKEWOOD_LIVE_COLLECTION || "HousesforSale";
const SHADOW = process.env.LS_LAKEWOOD_SHADOW_COLLECTION || "HousesforSale2";
const NEIGHBORHOODS = process.env.LS_LAKEWOOD_VILLAGES_COLLECTION || "HousesforSale-DynamicPages";
const MEDIA_FOLDER = process.env.LS_LAKEWOOD_MEDIA_FOLDER || "LifeAtLakewoodListingPhotos";
const MARKET = (process.env.LS_LAKEWOOD_MARKET_CITIES || "Lakewood Ranch,Bradenton,Sarasota").split(",").map((c) => c.trim());
/** Pages of 200. Left unset the scan runs the whole MLS, which is the point. */
const MAX_PAGES = Number(process.env.LS_LAKEWOOD_MAX_PAGES || 0) || undefined;

const SYSTEM_FIELDS = new Set(["_id", "_owner", "_createdDate", "_updatedDate", "_publishStatus", "_publishDate", "_draftDate"]);

const log = (line = "") => console.log(line ? `LWR: ${line}` : "");
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The fields the engine writes to a site's collection, from the transform itself. */
function writtenFields(): string[] {
  const village: VillageWithTerms = {
    id: "probe",
    site_id: "probe",
    name: "Probe",
    wix_slug: "probe",
    wix_item_id: "probe",
    page_url: `https://www.${DOMAIN}/probe`,
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
  // "15625 San Lazzaro Avenue, Bradenton, FL 34211"
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

const transcribed = lakewoodVillages() as unknown as TranscribedVillage[];
const asVillages: VillageWithTerms[] = transcribed.map((v) => ({
  id: v.itemId,
  site_id: "lakewood",
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
/** term -> neighborhood, for reporting which term did the catching. */
const termOwner = new Map<string, string>();
for (const v of transcribed) for (const t of v.terms) termOwner.set(t.term, v.name);

async function main() {
  log(`site ${DOMAIN} (${SITE_ID}) -- ${transcribed.length} neighborhoods, ${termOwner.size} terms`);

  // ---- 1. Collections ----
  const ids = [LIVE, SHADOW, NEIGHBORHOODS, "Villages"];
  const collections = new Map<string, Awaited<ReturnType<typeof getDataCollection>>>();
  // "Absent" and "could not be asked" are different answers: one means
  // create the collection, the other means the API key cannot see it.
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

  // ---- 2. Can the shadow collection hold what the engine writes? ----
  const written = writtenFields();
  const liveKeys = new Set(live.fields.map((f) => f.key));
  const missingOnLive = written.filter((f) => !liveKeys.has(f));
  log(`engine writes ${written.length} fields; ${LIVE} is missing ${missingOnLive.length ? missingOnLive.join(", ") : "none"}`);
  if (!shadow) {
    log(`${SHADOW} could not be read; 057 says Jeff created it on 2026-09-17, so this is worth a second look.`);
  } else {
    const shadowKeys = new Set(shadow.fields.map((f) => f.key));
    const missingOnShadow = written.filter((f) => !shadowKeys.has(f));
    const drift = live.fields.filter((f) => !shadowKeys.has(f.key)).map((f) => f.key);
    log(`${SHADOW} is missing ${missingOnShadow.length ? missingOnShadow.join(", ") : "none"} of them; ${drift.length} field(s) of ${LIVE} absent: ${drift.join(", ") || "none"}`);
  }

  // ---- 3. What the site is showing today ----
  const [listingItems, neighborhoodItems] = await Promise.all([
    queryAllItems(SITE_ID, LIVE),
    collections.get(NEIGHBORHOODS) ? queryAllItems(SITE_ID, NEIGHBORHOODS) : Promise.resolve([]),
  ]);
  log(`${LIVE}: ${listingItems.length} rows; ${NEIGHBORHOODS}: ${neighborhoodItems.length} rows`);
  const cities = tally(listingItems.map((item) => cityOf(item.data)));
  log(`cities on those rows (057's market_cities must cover every one):`);
  for (const [city, count] of cities) {
    const covered = MARKET.some((m) => m.toLowerCase() === city.toLowerCase());
    log(`  ${count.toString().padStart(4)}  ${city}${covered ? "" : "   <-- NOT in market_cities"}`);
  }
  const statuses = tally(listingItems.map((item) => text(item.data.standardStatus)));
  log(`statuses: ${statuses.map(([s, n]) => `${s} ${n}`).join(", ")}`);
  const priceTags = tally(
    listingItems.flatMap((item) => (Array.isArray(item.data.listingPriceSort) ? item.data.listingPriceSort.map((v) => text(v)) : [text(item.data.listingPriceSort)]))
  );
  log(`price filter tags (057 says shorthand): ${priceTags.slice(0, 8).map(([t, n]) => `${t} ${n}`).join(", ") || "none"}`);

  // ---- 4. Do 058's terms reproduce the site's own filing? ----
  const byItemId = new Map<string, string>();
  for (const item of neighborhoodItems) {
    const id = typeof item.data._id === "string" ? item.data._id : item.id;
    const name = text(item.data.villageName) ?? text(item.data.village) ?? text(item.data.title);
    if (id && name) byItemId.set(id, name);
  }
  const ownSubdivisions = new Set<string>();
  let agreed = 0;
  const misfiled: string[] = [];
  const unreached: string[] = [];
  for (const item of listingItems) {
    const subdivision = text(item.data.subdivision);
    if (subdivision) ownSubdivisions.add(subdivision.toLowerCase());
    const filedAs = text(item.data.village) ?? (text(item.data.village1) ? byItemId.get(text(item.data.village1)!) ?? null : null);
    const got = matchVillage(subdivision, null, asVillages)?.name ?? null;
    if (!filedAs) continue;
    if (got === filedAs) agreed += 1;
    else if (got === null) unreached.push(`${subdivision} (site: ${filedAs})`);
    else misfiled.push(`${subdivision}: site says ${filedAs}, terms say ${got}`);
  }
  log(`058's terms against the live collection: ${agreed} agree, ${unreached.length} unreached, ${misfiled.length} MISFILED`);
  for (const line of [...new Set(unreached)].sort()) log(`  unreached  ${line}`);
  for (const line of [...new Set(misfiled)].sort()) log(`  MISFILED   ${line}`);
  if (!misfiled.length) log(`  nothing is filed under the wrong neighborhood, which is the check that matters.`);

  // ---- 5. The market test ----
  if (!process.env.MLSGRID_API_KEY) {
    log(`no MLSGRID_API_KEY; skipping the market test, which is the main reason this probe exists.`);
  } else {
    log(``);
    log(`market test: paging every Active listing in the MLS, keeping ${MARKET.join(" / ")}.`);
    const client = new MlsGridClient();
    const started = Date.now();
    const scan = await client.fetchActive({ maxPages: MAX_PAGES });
    const market = MARKET.map((c) => c.toLowerCase());
    const inMarket = scan.items.filter((raw: MlsGridProperty) => {
      const city = (text(raw.City) ?? text(raw.PostalCity) ?? "").toLowerCase();
      return market.includes(city);
    });
    log(
      `scanned ${scan.items.length} of ${scan.expectedCount ?? "?"} Active listings in ${scan.requestCount} requests` +
        `${scan.truncated ? " (TRUNCATED -- raise the timeout or LS_LAKEWOOD_MAX_PAGES; what follows is partial)" : ""}` +
        `, ${Math.round((Date.now() - started) / 1000)}s`
    );
    log(`${inMarket.length} of them are in the market -- that is roughly what this site adds to ls_listings.`);
    for (const [city, count] of tally(inMarket.map((raw) => text(raw.City) ?? text(raw.PostalCity)))) {
      log(`  ${count.toString().padStart(5)}  ${city}`);
    }

    // For each term: the subdivisions it matches that the site does not
    // already carry. Matching is `includes`, exactly as classify does it,
    // and the exclusion is applied the same way -- but no longest-wins,
    // because the question here is what a term can reach, not who wins.
    const strangers = new Map<string, Map<string, number>>();
    const familiar = new Map<string, number>();
    for (const raw of inMarket) {
      const subdivision = text(raw.SubdivisionName);
      if (!subdivision) continue;
      const needle = subdivision.toLowerCase();
      for (const v of transcribed) {
        for (const t of v.terms) {
          if (!needle.includes(t.term)) continue;
          if (t.exclude_term && needle.includes(t.exclude_term)) continue;
          if (ownSubdivisions.has(needle)) {
            familiar.set(t.term, (familiar.get(t.term) ?? 0) + 1);
          } else {
            const seen = strangers.get(t.term) ?? new Map<string, number>();
            seen.set(subdivision, (seen.get(subdivision) ?? 0) + 1);
            strangers.set(t.term, seen);
          }
        }
      }
    }
    log(``);
    log(`TERMS THAT REACH A SUBDIVISION THE SITE DOES NOT SHOW TODAY:`);
    const risky = [...strangers.entries()].sort((a, b) => {
      const an = [...a[1].values()].reduce((x, y) => x + y, 0);
      const bn = [...b[1].values()].reduce((x, y) => x + y, 0);
      return bn - an || a[0].localeCompare(b[0]);
    });
    if (!risky.length) log(`  none. Every term matches only subdivisions the site already carries.`);
    for (const [term, seen] of risky) {
      const listings = [...seen.values()].reduce((x, y) => x + y, 0);
      const bare = BARE_TERMS.includes(term) ? "  [BARE TERM]" : "";
      log(`  "${term}" -> ${termOwner.get(term)}: ${listings} listing(s) across ${seen.size} subdivision(s)${bare}`);
      for (const [subdivision, count] of [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        log(`        ${count.toString().padStart(3)}  ${subdivision}`);
      }
    }
    log(``);
    log(`terms that matched only what the site already shows: ${[...familiar.keys()].filter((t) => !strangers.has(t)).sort().join(", ") || "none"}`);
    const silent = [...termOwner.keys()].filter((t) => !familiar.has(t) && !strangers.has(t)).sort();
    log(`terms that matched nothing at all (too narrow, or the neighborhood has no listing): ${silent.join(", ") || "none"}`);

    // ---- 6. What the engine will drop that the collection shows ----
    const matched = inMarket.filter((raw) => matchVillage(text(raw.SubdivisionName), null, asVillages));
    const newBuild = matched.filter((raw) => raw.NewConstructionYN === true);
    const wrongType = matched.filter((raw) => (text(raw.PropertyType) ?? "").toLowerCase() !== "residential");
    log(``);
    log(`${matched.length} in-market Active listings match a neighborhood term.`);
    log(`  ${newBuild.length} are NewConstructionYN true, which the engine excludes on every site (057).`);
    log(`  ${wrongType.length} are not PropertyType Residential, which 057 also excludes.`);
    log(`  so the engine would stage about ${matched.length - new Set([...newBuild, ...wrongType]).size}, against ${listingItems.length} rows in the collection today.`);
    for (const [village, count] of tally(newBuild.map((raw) => matchVillage(text(raw.SubdivisionName), null, asVillages)?.name ?? null)).slice(0, 10)) {
      log(`     new construction by neighborhood: ${count.toString().padStart(4)}  ${village}`);
    }
  }

  // ---- 7. The Media Manager folder ----
  const folders = await listMediaFolders(SITE_ID).catch((error) => {
    log(`media folders could not be listed -- ${error instanceof Error ? error.message : String(error)}`);
    return [] as Array<{ id: string; displayName: string }>;
  });
  const wanted = folders.find((f) => f.displayName === MEDIA_FOLDER);
  log(`media folder ${MEDIA_FOLDER}: ${wanted ? `found, id ${wanted.id}` : "NOT FOUND -- every photo import for this site would hold with folder_missing"}`);
  if (!wanted && folders.length) log(`  folders on this site: ${folders.map((f) => f.displayName).join(", ")}`);
}

main().catch((error) => {
  log(`probe failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 0;
});
