// Set up village (Jeff, 2026-10-28): "click a button for a new village and
// have the system create a draft row (or work with an existing draft row
// that matches) in both collections and fill it out."
//
// From a New Neighborhood alert: on Life At Lakewood, the village's row in
// Village Details, the source of truth, and its row in Dynamic Village
// Pages, its Village reference pointing at the first; on Wellen Park and
// Parrish, its row in their Neighborhoods collection. A row that matches
// by name is used as it is, draft or not; one that is missing is made as
// a draft. Only blank fields are written (fill.ts), so nothing a person
// typed is changed, and every row stays as it was published or drafted.
// Blank picture fields get the builder's photos (photos.ts), to stand in
// until the village's own are taken.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { describeError, failedAt as failed } from "@/lib/shared/describe-error";
import { getDataCollection, getItem, insertItem, queryAllItems, updateItem, type WixDataCollection, type WixDataItem } from "@/lib/wix/client";
import { writePayload } from "@/lib/villages/sync";
import { villageKey } from "@/lib/villages/ranges";
import { LAKEWOOD_PROFILE, PARRISH_PROFILE, WELLEN_PARK_PROFILE } from "@/lib/villages/profiles";
import { setSelfCheck, type Outcome } from "@/lib/community-alerts/alerts";
import { PLACES } from "@/lib/community-alerts/announcements";
import { placeKey, type NewNeighborhoodDetail } from "@/lib/community-alerts/new-neighborhoods";
import { SchoolZones, type PointZones } from "@/lib/school-zones/districts";
import { combineSchools, SCHOOL_LEVELS, type SchoolLevel } from "@/lib/school-zones/names";
import { schoolFields } from "@/lib/school-zones/pages";
import { cleanPoints, geocode, subdivisionPoints, type Point } from "@/lib/school-zones/places";
import { proposeLevel, siteIds } from "@/lib/school-zones/scan";
import { collectionLabel, ensureSchoolFields, fieldNamed, indexRows, rowNames, VILLAGE_DETAILS, VILLAGE_PAGES } from "@/lib/villages/collections";
import { detailAmenityIcons, planDetailsRow, planPagesRow, type FieldInfo, type RowData, type Schools } from "@/lib/villages/fill";
import { researchVillage, type VillageResearch } from "@/lib/villages/research";
import { photoFills, villagePhotos, wantsPhotos, type VillagePhotos } from "@/lib/villages/photos";

export interface SetupRow {
  collectionId: string;
  label: string;
  itemId: string;
  created: boolean;
  draft: boolean;
  /** The fields written, by their display names. */
  filled: string[];
}

export interface VillageSetup {
  at: string;
  wixSiteId: string;
  rows: SetupRow[];
  schools: Partial<Schools> | null;
  research: { found: boolean; sources: string[] } | null;
  problems: string[];
  leftForYou: string[];
  /** The builder photos used, where each went, as viewable URLs. */
  photos?: { where: string; src: string }[];
}

const LEFT_FOR_YOU = [
  "the village's own photos, to replace the builder's that stand in for now",
  "the video and the interactive map",
  "the nearby villages",
  "the price, size, bedroom, bathroom and garage ranges (the village ranges sync fills them from the floor plans and listings)",
];

/** How a photo's alt text names where the village is. */
const PHOTO_PLACES: Record<string, string> = {
  "lifeatlakewood.com": "Lakewood Ranch, Florida",
  "lifeinwellenpark.com": "Wellen Park, Florida",
  "lifeatparrish.com": "Parrish, Florida",
};

/** A wix:image URI as a URL a browser can show. */
const viewable = (uri: string) => {
  const id = /^wix:image:\/\/v1\/([^/#]+)/.exec(uri)?.[1];
  return id ? `https://static.wixstatic.com/media/${id}` : uri;
};

/** Where each photo went, for the card. */
function photosUsed(photos: VillagePhotos | null): { where: string; src: string }[] {
  if (!photos) return [];
  const out: { where: string; src: string }[] = [];
  if (photos.main) out.push({ where: "Main image", src: viewable(photos.main.uri) });
  if (photos.about) out.push({ where: "About background", src: viewable(photos.about.uri) });
  if (photos.amenities) out.push({ where: "Amenities background", src: viewable(photos.amenities.uri) });
  photos.gallery.forEach((g, i) => out.push({ where: `Gallery ${i + 1}: ${g.title}`, src: viewable(g.src) }));
  return out;
}

const PROFILES: Record<string, typeof LAKEWOOD_PROFILE> = {
  "lifeatlakewood.com": LAKEWOOD_PROFILE,
  "lifeinwellenpark.com": WELLEN_PARK_PROFILE,
  "lifeatparrish.com": PARRISH_PROFILE,
};

/** The row of a collection a village name matches: by name as the rows write it, else as the scans key places. */
function matchRow(items: WixDataItem[], nameKeys: (string | null)[], name: string): WixDataItem | null {
  const { byName } = indexRows(items, nameKeys);
  const exact = byName.get(villageKey(name));
  if (exact) return exact;
  const key = placeKey(name);
  return key ? (items.find((i) => rowNames(i, nameKeys).some((n) => placeKey(n) === key)) ?? null) : null;
}

/** The village's schools from the districts' zones, at its homes, or at the address the research found. */
async function villageSchools(name: string, address: string | null, problems: string[]): Promise<Partial<Schools> | null> {
  const points: Point[] = await subdivisionPoints(name);
  if (address) {
    const found = await geocode(address).catch(() => null);
    if (found) points.push({ lat: found.lat, lng: found.lng, address: found.matched });
  }
  const clean = cleanPoints(points);
  if (!clean.length) {
    problems.push("No home or address could be placed for its schools: run the school zones scan once it has listings, or give an address on the School Zones tab");
    return null;
  }
  const zones = await SchoolZones.load();
  problems.push(...zones.problems);
  const answers = (await Promise.all(clean.map((p) => zones.lookup(p.lat, p.lng).catch(() => null)))).filter((z): z is PointZones => z !== null);
  const out: Partial<Schools> = {};
  for (const level of SCHOOL_LEVELS) {
    const names = proposeLevel(answers.map((a) => a.latest[level])).names;
    if (names.length) out[level] = combineSchools(names);
  }
  return Object.keys(out).length ? out : null;
}

const toFieldInfo = (fields: { key: string; displayName?: string; type?: string }[]): FieldInfo[] =>
  fields.map((f) => ({ key: f.key, displayName: f.displayName, type: f.type }));

const completeSchools = (s: Partial<Schools> | null): Schools | null =>
  s ? { elementary: s.elementary ?? "", middle: s.middle ?? "", high: s.high ?? "" } : null;

/** Finds the row, or makes it as a draft with the fields given; then reads it back as written. */
async function rowFor(wixSiteId: string, collectionId: string, found: WixDataItem | null, first: RowData): Promise<{ item: WixDataItem; created: boolean }> {
  if (found) return { item: found, created: false };
  const made = await insertItem(wixSiteId, collectionId, first, { asDraft: true });
  return { item: (await getItem(wixSiteId, collectionId, made.id)) ?? made, created: true };
}

/** Writes the planned fields to the row, keeping it published or a draft as it was. */
async function writeFills(wixSiteId: string, collectionId: string, item: WixDataItem, fills: RowData): Promise<void> {
  if (!Object.keys(fills).length) return;
  await updateItem(wixSiteId, collectionId, item.id, writePayload(item, fills));
}

const filledNames = (fills: RowData, fields: FieldInfo[]) =>
  Object.keys(fills).map((k) => fields.find((f) => f.key === k)?.displayName ?? k);

/** Sets up the village a New Neighborhood alert names, and records what it did on the alert. */
export async function setUpVillage(alertId: string): Promise<Outcome & { setup?: VillageSetup }> {
  const { data: alert, error } = await supabase.from("ca_alerts").select("id, kind, status, name, detail").eq("id", alertId).maybeSingle();
  if (error) throw failed("reading the alert", error);
  if (!alert || alert.status !== "open" || alert.kind !== "new_neighborhood") return { ok: false, status: 404, error: "No open new neighborhood alert by that id" };
  const detail = alert.detail as NewNeighborhoodDetail & { setup?: VillageSetup };
  const site = detail.site;
  const profile = PROFILES[site];
  if (!profile) return { ok: false, status: 400, error: `Set up village does not know ${site}` };
  const ids = await siteIds(site);
  if (!ids.wixSiteId) return { ok: false, status: 400, error: "The site has no Wix site id" };
  const wixSiteId = ids.wixSiteId;
  const name = alert.name as string;
  const problems: string[] = [];

  let research: VillageResearch | null = null;
  try {
    research = await researchVillage({ name, place: PLACES[site] ?? site, builders: detail.builders ?? [], sourceUrl: detail.sourceUrl ?? null });
    if (!research.found) problems.push("No official page describes it yet: its content is left blank");
  } catch (e) {
    problems.push(`The research could not be done: ${describeError(e)}`);
  }
  const content = research?.found ? research : null;
  const schools = await villageSchools(name, content?.address || null, problems).catch((e) => {
    problems.push(`Its schools could not be looked up: ${describeError(e)}`);
    return null;
  });

  const rows: SetupRow[] = [];
  const pagesSchema = await getDataCollection(wixSiteId, VILLAGE_PAGES);
  if (!pagesSchema) return { ok: false, status: 400, error: `The site has no ${VILLAGE_PAGES} collection` };
  const pagesFields = toFieldInfo(pagesSchema.fields);
  const pagesItems = await queryAllItems(wixSiteId, VILLAGE_PAGES, { includeDrafts: true });
  const pagesTitleKey = fieldNamed(pagesSchema.fields, /^(village|neighborhood) name$/i) ?? "title";
  const pagesNameKeys = [pagesTitleKey, ...profile.titleKeys, fieldNamed(pagesSchema.fields, /^village reference name$/i)];
  const pageSchoolKeys = schoolFields(pagesSchema.fields);

  // Life At Lakewood: Village Details first, the source of truth.
  let details: { item: WixDataItem; created: boolean; keys: string[]; rows: RowData[]; schema: WixDataCollection } | null = null;
  if (site === "lifeatlakewood.com") {
    const type = pagesSchema.fields.find((f) => f.key === pageSchoolKeys.elementary)?.type;
    await ensureSchoolFields(wixSiteId, VILLAGE_DETAILS, type ?? undefined);
    const schema = await getDataCollection(wixSiteId, VILLAGE_DETAILS);
    if (!schema) return { ok: false, status: 400, error: `The site has no ${VILLAGE_DETAILS} collection` };
    const items = await queryAllItems(wixSiteId, VILLAGE_DETAILS, { includeDrafts: true });
    const found = matchRow(items, LAKEWOOD_PROFILE.titleKeys, name);
    const { item, created } = await rowFor(wixSiteId, VILLAGE_DETAILS, found, { title: name, villagesTitle: name });
    details = { item, created, keys: schema.fields.map((f) => f.key), rows: items.map((i) => i.data ?? {}), schema };
  }

  // The village pages row: matched by its Village reference to Village Details, else by name.
  const refKey = fieldNamed(pagesSchema.fields, /^village$/i, "REFERENCE");
  const refNameKey = fieldNamed(pagesSchema.fields, /^village reference name$/i);
  const filterKey = fieldNamed(pagesSchema.fields, /^(village|neighborhood) name \(for filtering\)$/i);
  const sortKey = fieldNamed(pagesSchema.fields, /^sort - (village|neighborhood) name$/i);
  const pagesFound =
    (details && refKey ? indexRows(pagesItems, [], refKey).byRef.get(details.item.id) : undefined) ?? matchRow(pagesItems, pagesNameKeys, name);
  const fixed: RowData = { [pagesTitleKey]: name };
  if (refNameKey) fixed[refNameKey] = name;
  if (filterKey) fixed[filterKey] = name;
  if (sortKey) fixed[sortKey] = name;
  if (refKey && details) fixed[refKey] = details.item.id;
  const pages = await rowFor(wixSiteId, VILLAGE_PAGES, pagesFound ?? null, fixed);

  // The builder's photos, imported only when a row has a picture field still blank.
  const wanted =
    wantsPhotos(pagesFields, pages.item.data ?? {}) || (details !== null && wantsPhotos(toFieldInfo(details.schema.fields), details.item.data ?? {}));
  const photos =
    wanted && ids.fpSiteId
      ? await villagePhotos({
          fpSiteId: ids.fpSiteId,
          wixSiteId,
          name,
          place: PHOTO_PLACES[site] ?? site,
          builders: detail.builders ?? [],
          sources: research?.sources ?? [],
          problems,
        }).catch((e) => {
          problems.push(`The builder photos could not be brought in: ${describeError(e)}`);
          return null;
        })
      : null;
  if (details) {
    // The ranges Village Details already has, copied across.
    const price = fieldNamed(pagesSchema.fields, /^price range$/i);
    const sqft = fieldNamed(pagesSchema.fields, /^square feet$/i);
    if (price && details.item.data?.priceRange) fixed[price] = details.item.data.priceRange;
    if (sqft && details.item.data?.squareFootageRange) fixed[sqft] = details.item.data.squareFootageRange;
  }
  const pagesFills: RowData = planPagesRow({
    fields: pagesFields,
    rows: pagesItems.filter((i) => i.id !== pages.item.id).map((i) => i.data ?? {}),
    current: pages.item.data ?? {},
    name,
    research: content,
    schools: completeSchools(schools),
    fixed,
    fallbackIcons: details ? detailAmenityIcons(details.keys, details.rows) : {},
  });
  Object.assign(pagesFills, photoFills(pagesFields, pages.item.data ?? {}, photos));
  await writeFills(wixSiteId, VILLAGE_PAGES, pages.item, pagesFills);
  rows.push({
    collectionId: VILLAGE_PAGES,
    label: collectionLabel(site, VILLAGE_PAGES),
    itemId: pages.item.id,
    created: pages.created,
    draft: pages.item.data?._publishStatus === "DRAFT" || pages.created,
    filled: filledNames(pagesFills, pagesFields),
  });

  if (details) {
    // The dynamic page's address, once Wix has given the row one.
    const written = (await getItem(wixSiteId, VILLAGE_PAGES, pages.item.id)) ?? pages.item;
    const link = Object.entries(written.data ?? {}).find(([k, v]) => k.startsWith("link-") && typeof v === "string" && v.startsWith("/village/"))?.[1];
    const detailFields = toFieldInfo(details.schema.fields);
    const detailFills = planDetailsRow({
      keys: details.keys,
      rows: details.rows.filter((r) => r._id !== details!.item.id),
      current: details.item.data ?? {},
      name,
      research: content,
      schools: completeSchools(schools),
      schoolKeys: {
        elementary: fieldNamed(details.schema.fields, /^village elementary school$/i) ?? "villageElementarySchool",
        middle: fieldNamed(details.schema.fields, /^village middle school$/i) ?? "villageMiddleSchool",
        high: fieldNamed(details.schema.fields, /^village high school$/i) ?? "villageHighSchool",
      },
      schoolTemplates: Object.fromEntries(
        SCHOOL_LEVELS.map((l) => [l, pagesItems.map((i) => i.data?.[pageSchoolKeys[l] ?? ""]).find((v) => typeof v === "string" && /<strong>/i.test(v))])
      ) as Partial<Record<SchoolLevel, string>>,
      pageUrl: typeof link === "string" ? `https://www.lifeatlakewood.com${link}` : null,
    });
    Object.assign(detailFills, photoFills(detailFields, details.item.data ?? {}, photos));
    await writeFills(wixSiteId, VILLAGE_DETAILS, details.item, detailFills);
    rows.unshift({
      collectionId: VILLAGE_DETAILS,
      label: collectionLabel(site, VILLAGE_DETAILS),
      itemId: details.item.id,
      created: details.created,
      draft: details.item.data?._publishStatus === "DRAFT" || details.created,
      filled: filledNames(detailFills, detailFields),
    });
  }

  const setup: VillageSetup = {
    at: new Date().toISOString(),
    wixSiteId,
    rows,
    schools,
    research: research ? { found: research.found, sources: research.sources } : null,
    problems,
    leftForYou: LEFT_FOR_YOU,
    photos: photosUsed(photos),
  };
  const { error: saveError } = await supabase
    .from("ca_alerts")
    .update({ detail: { ...detail, setup }, updated_at: setup.at })
    .eq("id", alertId);
  if (saveError) throw failed("recording the setup", saveError);
  // The new neighborhood's "row filled in" to-do (checklists.ts).
  await setSelfCheck(alertId, "village_row", true, null);
  logger.info("Village set up", { site, village: name, rows: rows.map((r) => ({ collection: r.collectionId, created: r.created, filled: r.filled.length })) });
  return { ok: true, setup };
}
