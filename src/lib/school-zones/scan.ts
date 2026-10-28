// The school zone scan (Jeff, 2026-10-28): every October, and on demand
// from the School Zones tab, each village on each site is checked against
// the districts' zones for homes in it. A village whose page names other
// schools, or names the same schools another way, raises a school zones
// alert with what the page should say; its Apply button writes it to the
// site's Neighborhoods collection.
//
// Life At Lakewood's source of truth is Village Details (AmenitiesbyVillage),
// every village in it (Jeff, 2026-10-28), so its villages are checked
// there and Apply writes there, and to the village's Dynamic Village Pages
// row too when it has one. Most of its village pages are still built by
// hand: while a village's static page names other schools, its alert also
// carries a to-do to edit the page, the page read live. Village Details
// had no school fields until now; a row with none yet whose static page
// (verified 2026-10-28) already names what the zones do is filled in by
// the scan from it.
//
// A village split between zones names each school with a fair share of
// its homes ("McNeal and Braden River Elementary", as the pages already do).

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { describeError, failedAt as failed } from "@/lib/shared/describe-error";
import {
  getDataCollection,
  getItem,
  insertItem,
  queryAllItems,
  queryItems,
  updateItem,
  WixApiError,
  type WixDataItem,
} from "@/lib/wix/client";
import { writePayload } from "@/lib/villages/sync";
import { villageKey, type VillageRangeProfile } from "@/lib/villages/ranges";
import { LAKEWOOD_PROFILE, PARRISH_PROFILE, WELLEN_PARK_PROFILE } from "@/lib/villages/profiles";
import { ensureSchoolFields, fieldNamed, indexRows, rowNames, VILLAGE_DETAILS, VILLAGE_PAGES } from "@/lib/villages/collections";
import { setSelfCheck, type Outcome } from "@/lib/community-alerts/alerts";
import { SchoolZones, type PointZones, type ZoneSource } from "@/lib/school-zones/districts";
import {
  cleanText,
  combineSchools,
  compareLevel,
  SCHOOL_LEVELS,
  type District,
  type LevelVerdict,
  type SchoolLevel,
} from "@/lib/school-zones/names";
import { fetchStaticPage, readSchoolField, schoolFields, writeSchoolField, type PageSchools } from "@/lib/school-zones/pages";
import { cleanPoints, placesByHand, subdivisionPoints, villagePoints, type PlacedBy, type Point } from "@/lib/school-zones/places";
import { applyQueued, canApplySchools } from "@/lib/school-zones/apply";

/**
 * Where each site's villages name their schools: the collection's rows
 * are the villages. Life At Lakewood's are Village Details, its pages
 * collection the copy written beside it, its static pages read live.
 */
interface SchoolTarget {
  domain: string;
  collectionId: string;
  profile: VillageRangeProfile;
  /** The village pages collection written beside it, its rows matched by their Village reference. */
  pagesCollectionId?: string;
  /** Read the villages' static pages, for the ones still built by hand. */
  staticPages?: boolean;
}

export const SCHOOL_TARGETS: SchoolTarget[] = [
  { domain: "lifeatlakewood.com", collectionId: VILLAGE_DETAILS, profile: LAKEWOOD_PROFILE, pagesCollectionId: VILLAGE_PAGES, staticPages: true },
  { domain: "lifeinwellenpark.com", collectionId: VILLAGE_PAGES, profile: WELLEN_PARK_PROFILE },
  { domain: "lifeatparrish.com", collectionId: VILLAGE_PAGES, profile: PARRISH_PROFILE },
];

/** A school named for at least this share of a village's homes (and two of them) is named on its page. */
const SPLIT_SHARE = 0.2;
/** Homes asked about at once: Manatee's locator is asked one home at a time. */
const CONCURRENCY = 4;
/** A scan still unfinished after this long is taken to have died. */
const STALE_MS = 20 * 60_000;

export interface LevelDetail {
  level: SchoolLevel;
  /** What the page says. */
  page: string;
  /** What it should say, by the latest zones published. */
  proposed: string;
  verdict: LevelVerdict;
  /** What the zones say for the school year under way, when that differs. */
  thisYear: string | null;
  /** Each school the village's homes are zoned for, with how many. */
  shares: { name: string; homes: number }[];
}

export interface SchoolZonesDetail {
  site: string;
  /** Where the page is: a collection row (written with Apply), or a static page (edited by hand). */
  source: "page" | "collection";
  /** A Lakewood village's page: its row, its static page, or neither yet (Apply makes the row). */
  pageSource?: "row" | "static" | "none";
  pageUrl: string | null;
  collectionId: string | null;
  /** The row to write; null when Apply makes a draft row from `newRow`. */
  wixItemId: string | null;
  /** A missing Lakewood row's fields, written as a draft with the schools. */
  newRow?: Record<string, unknown> | null;
  /** The collection's field for each level. */
  fields: Partial<Record<SchoolLevel, string>>;
  /** Each field's markup as the collection writes it, for a row whose field is empty. */
  templates?: Partial<Record<SchoolLevel, string>>;
  draft: boolean;
  district: District;
  /** The school year each level's proposal is for (2027 = 2027-28), and the one under way. */
  latestYears: Partial<Record<SchoolLevel, number>>;
  currentYear: number;
  links: Record<SchoolLevel, string>;
  levels: LevelDetail[];
  homes: number;
  sampleAddress: string | null;
  placedBy: PlacedBy;
  notes: string[];
  scannedAt: string;
  /** What the page said and what it should say, so a closed alert is not raised again for the same thing. */
  fingerprint: string;
  /** The village's row in the pages collection, written with the same schools (Life At Lakewood's Dynamic Village Pages). */
  mirror?: MirrorTarget | null;
  /** The village's static page, while it names other schools: edited by hand (the to-do). */
  staticPage?: { url: string; says: PageSchools } | null;
  /** Apply all has it queued, since when (school-zones/apply.ts). */
  applyQueuedAt?: string | null;
  /** Why Apply all could not write it. */
  applyError?: string | null;
  appliedAt?: string;
}

export interface SiteScan {
  domain: string;
  checked: number;
  matching: number;
  raised: string[];
  updated: string[];
  /** Villages whose page names no schools: left alone. */
  noSchools: string[];
  /** Villages no home could be found for: an address by hand places them. */
  unplaced: string[];
  /** Raised before for the same thing and closed: not raised again. */
  handled: string[];
  /** Rows the scan filled in itself: no schools yet, and the verified static page names what the zones do. */
  filled?: string[];
  error?: string;
}

export interface SchoolScan {
  id: string | null;
  startedAt: string;
  sources: ZoneSource[];
  problems: string[];
  sites: SiteScan[];
}

/** The collection row a village is held to, as the scan read it. */
interface RowTarget {
  collectionId: string;
  wixItemId: string | null;
  newRow: Record<string, unknown> | null;
  /** What the row's fields say now. */
  says: PageSchools;
  fields: Record<SchoolLevel, string>;
  templates: Partial<Record<SchoolLevel, string>>;
}

/** A copy of the village's row in another collection, written with the same schools. */
export interface MirrorTarget {
  collectionId: string;
  wixItemId: string;
  fields: Partial<Record<SchoolLevel, string>>;
  templates: Partial<Record<SchoolLevel, string>>;
}

interface Subject {
  name: string;
  key: string;
  /** What the row says. */
  page: PageSchools;
  pageSource: "row" | "static" | "none";
  pageUrl: string | null;
  /** The row Apply writes. */
  row: RowTarget | null;
  mirror: MirrorTarget | null;
  /** The village's static page and what it names, for one still built by hand. */
  staticPage: { url: string; says: PageSchools } | null;
  draft: boolean;
  points: Point[];
  placedBy: PlacedBy | null;
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * The schools a level names, from what each home is zoned for: every
 * school with a fair share of the homes, most homes first; at least the
 * one with the most. Pure; exported for tests.
 */
export function proposeLevel(answers: (string[] | undefined)[]): { names: string[]; shares: { name: string; homes: number }[] } {
  const counts = new Map<string, number>();
  let homes = 0;
  for (const names of answers) {
    if (!names?.length) continue;
    homes++;
    for (const n of new Set(names)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const shares = [...counts.entries()].map(([name, n]) => ({ name, homes: n })).sort((a, b) => b.homes - a.homes || a.name.localeCompare(b.name));
  const names = shares.filter((s, i) => i === 0 || (s.homes >= 2 && s.homes / homes >= SPLIT_SHARE)).map((s) => s.name);
  return { names, shares };
}

/** Each level of a village: what the page says against what its homes' zones say. Pure; exported for tests. */
export function levelDetails(page: PageSchools, zones: PointZones[]): LevelDetail[] {
  return SCHOOL_LEVELS.map((level) => {
    const latest = proposeLevel(zones.map((z) => z.latest[level]));
    const current = proposeLevel(zones.map((z) => z.current[level]));
    const proposed = latest.names.length ? combineSchools(latest.names) : cleanText(page[level]);
    const thisYearText = current.names.length ? combineSchools(current.names) : null;
    return {
      level,
      page: cleanText(page[level]),
      proposed,
      verdict: latest.names.length ? compareLevel(page[level], proposed) : "same",
      thisYear: thisYearText && thisYearText !== proposed ? thisYearText : null,
      shares: latest.shares,
    };
  });
}

/** The levels whose page does not yet say what it should. Pure; exported for tests. */
export const levelsToWrite = (levels: LevelDetail[]) => levels.filter((l) => l.proposed && l.page !== l.proposed);

export const fingerprintOf = (levels: LevelDetail[]) => levels.map((l) => `${l.level}:${l.page}>${l.proposed}`).join("|");

/** A Lakewood dynamic village page's address (/village/stillwater), as against a page built by hand. */
const isDynamicPage = (url: string) => {
  try {
    return new URL(url).pathname.startsWith("/village/");
  } catch {
    return false;
  }
};

export async function siteIds(domain: string): Promise<{ fpSiteId: string | null; lsSiteId: string | null; wixSiteId: string | null }> {
  const [{ data: fp, error: fpError }, { data: ls, error: lsError }] = await Promise.all([
    supabase.from("fp_sites").select("id, wix_site_id").eq("domain", domain).maybeSingle(),
    supabase.from("ls_sites").select("id, wix_site_id").eq("domain", domain).maybeSingle(),
  ]);
  if (fpError) throw failed(`reading ${domain}'s site`, fpError);
  if (lsError) throw failed(`reading ${domain}'s listings site`, lsError);
  return { fpSiteId: fp?.id ?? null, lsSiteId: ls?.id ?? null, wixSiteId: fp?.wix_site_id ?? ls?.wix_site_id ?? null };
}

interface LsVillage {
  id: string;
  name: string;
  page_url: string | null;
  wix_item_id: string | null;
}

async function lsVillages(lsSiteId: string | null): Promise<LsVillage[]> {
  if (!lsSiteId) return [];
  const { data, error } = await supabase.from("ls_villages").select("id, name, page_url, wix_item_id").eq("site_id", lsSiteId).order("name");
  if (error) throw failed("reading the villages", error);
  return data ?? [];
}

const rowSchools = (item: WixDataItem | null, fields: Record<SchoolLevel, string>): PageSchools => ({
  elementary: readSchoolField(item?.data?.[fields.elementary]),
  middle: readSchoolField(item?.data?.[fields.middle]),
  high: readSchoolField(item?.data?.[fields.high]),
});

const hasSchools = (p: PageSchools | null | undefined): p is PageSchools => Boolean(p && SCHOOL_LEVELS.some((l) => p[l]));

/** A site's collection: its school fields, each field's usual markup, and its rows. */
async function readCollection(wixSiteId: string, collectionId: string) {
  const collection = await getDataCollection(wixSiteId, collectionId);
  if (!collection) throw new Error(`the site has no ${collectionId} collection`);
  const found = schoolFields(collection.fields);
  if (!found.elementary || !found.middle || !found.high) throw new Error(`${collectionId} has no school fields`);
  const fields = found as Record<SchoolLevel, string>;
  const items = await queryAllItems(wixSiteId, collectionId, { includeDrafts: true });
  const templates: Partial<Record<SchoolLevel, string>> = {};
  for (const level of SCHOOL_LEVELS) {
    const sample = items.map((i) => i.data?.[fields[level]]).find((v) => typeof v === "string" && /<strong>/i.test(v));
    if (typeof sample === "string") templates[level] = sample;
  }
  return { collection, fields, items, templates };
}

/** The villages to check on a site, each with what its page says and where its homes are. */
async function subjectsOf(target: SchoolTarget, ids: Awaited<ReturnType<typeof siteIds>>, scan: SiteScan): Promise<Subject[]> {
  if (!ids.wixSiteId) throw new Error("the site has no Wix site id");
  const wixSiteId = ids.wixSiteId;
  const villages = await lsVillages(ids.lsSiteId);
  const points = ids.lsSiteId ? await villagePoints(ids.lsSiteId) : new Map<string, Point[]>();

  // The pages collection beside it, and the school fields added to the
  // collection itself if it has none yet, of the pages collection's type.
  const pages = target.pagesCollectionId ? await readCollection(wixSiteId, target.pagesCollectionId) : null;
  if (pages) {
    const type = pages.collection.fields.find((f) => f.key === pages.fields.elementary)?.type;
    await ensureSchoolFields(wixSiteId, target.collectionId, type ?? undefined);
  }
  const { fields, items, templates: own } = await readCollection(wixSiteId, target.collectionId);
  const templates = { ...(pages?.templates ?? {}), ...own };
  const pagesIndex = pages
    ? indexRows(
        pages.items,
        [fieldNamed(pages.collection.fields, /^village name$/i) ?? "title", fieldNamed(pages.collection.fields, /^village reference name$/i)],
        fieldNamed(pages.collection.fields, /^village$/i, "REFERENCE")
      )
    : null;

  // An item is its village by any of its names, a source's other name for it included.
  const aliases = new Map(Object.entries(target.profile.villageAliases).map(([from, to]) => [villageKey(from), villageKey(to)]));
  const villageByKey = new Map<string, LsVillage>();
  for (const v of villages) {
    const k = villageKey(v.name);
    villageByKey.set(aliases.get(k) ?? k, v);
  }

  const villageByWixId = new Map(villages.filter((v) => v.wix_item_id).map((v) => [v.wix_item_id as string, v]));

  const subjects: Subject[] = [];
  await mapPool(items, CONCURRENCY, async (item) => {
    const titles = rowNames(item, target.profile.titleKeys);
    const name = titles[0];
    if (!name) return;
    const says = rowSchools(item, fields);
    // The listings engine's village is the row it points at (ls_villages.wix_item_id), else by name.
    const village = villageByWixId.get(item.id) ?? titles.map((t) => villageByKey.get(villageKey(t))).find(Boolean) ?? null;
    const own = village ? (points.get(village.id) ?? []) : [];
    const pagesRow = pagesIndex ? (pagesIndex.byRef.get(item.id) ?? titles.map((t) => pagesIndex.byName.get(villageKey(t))).find(Boolean) ?? null) : null;
    const pageUrl = village?.page_url ?? (typeof item.data?.buttonLink === "string" ? item.data.buttonLink : null);

    // A village whose page is still built by hand: its static page, read
    // live. One whose dynamic page is published is on that page instead.
    let staticPage: Subject["staticPage"] = null;
    if (target.staticPages && pageUrl && !isDynamicPage(pageUrl) && pagesRow?.data?._publishStatus !== "PUBLISHED") {
      try {
        const page = await fetchStaticPage(pageUrl);
        if (page.exists && hasSchools(page.schools)) staticPage = { url: pageUrl, says: page.schools };
      } catch (error) {
        scan.error = [scan.error, `${name}'s page could not be read: ${describeError(error)}`].filter(Boolean).join("; ");
      }
    }
    // Wellen Park's and Parrish's rows name their schools or are left alone;
    // every Life At Lakewood village is held to having them.
    if (!target.pagesCollectionId && !hasSchools(says)) {
      scan.noSchools.push(name);
      return;
    }
    subjects.push({
      name,
      key: villageKey(name),
      page: says,
      pageSource: "row",
      pageUrl,
      row: { collectionId: target.collectionId, wixItemId: item.id, newRow: null, says, fields, templates },
      mirror:
        pages && pagesRow
          ? { collectionId: pages.collection.id ?? target.pagesCollectionId!, wixItemId: pagesRow.id, fields: pages.fields, templates: pages.templates }
          : null,
      staticPage,
      draft: item.data?._publishStatus === "DRAFT",
      points: own,
      placedBy: own.length ? "listings" : null,
    });
  });
  return subjects;
}

/** The row's fields with the levels' schools in them, each in the row's own markup or the collection's usual one. Pure; exported for tests. */
export function schoolWrites(
  levels: LevelDetail[],
  fields: Partial<Record<SchoolLevel, string>>,
  current: Record<string, unknown> | undefined,
  templates: Partial<Record<SchoolLevel, string>> = {}
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of levelsToWrite(levels)) {
    const key = fields[l.level];
    if (!key) continue;
    const existing = current?.[key];
    out[key] = writeSchoolField(l.level, l.proposed, typeof existing === "string" && existing.trim() ? existing : templates[l.level]);
  }
  return out;
}

/** Writes the levels to the row, or makes the row as a draft. */
async function writeRow(wixSiteId: string, row: RowTarget, levels: LevelDetail[], item: WixDataItem | null): Promise<void> {
  const writes = schoolWrites(levels, row.fields, item?.data, row.templates);
  if (item) await updateItem(wixSiteId, row.collectionId, item.id, writePayload(item, writes));
  else await insertItem(wixSiteId, row.collectionId, { ...(row.newRow ?? {}), ...writes }, { asDraft: true });
}

/** The levels as a copy's own row says them: what it is written against. Pure; exported for tests. */
export function levelsAgainst(levels: LevelDetail[], fields: Partial<Record<SchoolLevel, string>>, data: Record<string, unknown> | undefined): LevelDetail[] {
  return levels.map((l) => {
    const key = fields[l.level];
    return { ...l, page: key ? cleanText(readSchoolField(data?.[key])) : l.page };
  });
}

/** Writes the schools to the village's copy in the pages collection, whatever it says now: it follows the source of truth. */
async function writeMirror(wixSiteId: string, mirror: MirrorTarget, levels: LevelDetail[]): Promise<void> {
  const item = await getItem(wixSiteId, mirror.collectionId, mirror.wixItemId);
  if (!item) return;
  const writes = schoolWrites(levelsAgainst(levels, mirror.fields, item.data), mirror.fields, item.data, mirror.templates);
  if (Object.keys(writes).length) await updateItem(wixSiteId, mirror.collectionId, item.id, writePayload(item, writes));
}

/** The static page names a school the zones do not, at some level. Pure; exported for tests. */
export const staticDiffers = (levels: LevelDetail[], says: PageSchools) => levels.some((l) => l.proposed && cleanText(says[l.level]) !== l.proposed);

/** Raises, refreshes or leaves the village's alert. */
async function recordSubject(fpSiteId: string, subject: Subject, detail: SchoolZonesDetail, changed: boolean, scan: SiteScan): Promise<void> {
  const { data: rows, error } = await supabase
    .from("ca_alerts")
    .select("id, status, detail")
    .eq("kind", "school_zones")
    .eq("site_id", fpSiteId)
    .eq("subject_key", subject.key);
  if (error) throw failed(`reading ${subject.name}'s school alerts`, error);
  const open = (rows ?? []).find((r) => r.status === "open");
  if (open) {
    const { error: updateError } = await supabase
      .from("ca_alerts")
      .update({ name: subject.name, detail, updated_at: new Date().toISOString() })
      .eq("id", open.id);
    if (updateError) throw failed(`refreshing ${subject.name}'s school alert`, updateError);
    // A static page's to-do ticks itself once the page reads as it should.
    if (detail.source === "page") await setSelfCheck(open.id, "page_schools", !changed, null);
    scan.updated.push(subject.name);
    return;
  }
  if (!changed) return;
  if ((rows ?? []).some((r) => (r.detail as SchoolZonesDetail | null)?.fingerprint === detail.fingerprint)) {
    scan.handled.push(subject.name);
    return;
  }
  const { error: insertError } = await supabase
    .from("ca_alerts")
    .insert({ kind: "school_zones", site_id: fpSiteId, subject_key: subject.key, name: subject.name, detail });
  if (insertError && insertError.code !== "23505") throw failed(`raising ${subject.name}'s school alert`, insertError);
  if (!insertError) scan.raised.push(subject.name);
}

async function scanSite(target: SchoolTarget, zones: SchoolZones, startedAt: string): Promise<SiteScan> {
  const scan: SiteScan = {
    domain: target.domain,
    checked: 0,
    matching: 0,
    raised: [],
    updated: [],
    noSchools: [],
    unplaced: [],
    handled: [],
    filled: [],
  };
  const ids = await siteIds(target.domain);
  if (!ids.fpSiteId) throw new Error("the site is not in the Hub");
  const subjects = await subjectsOf(target, ids, scan);
  const byHand = await placesByHand();

  for (const subject of subjects) {
    const given = byHand.get(`${ids.fpSiteId}|${subject.key}`);
    if (given) {
      subject.points = [{ lat: given.lat, lng: given.lng, address: given.address }];
      subject.placedBy = "address";
    } else if (!subject.points.length) {
      subject.points = await subdivisionPoints(subject.name);
      subject.placedBy = subject.points.length ? "subdivision" : null;
    }
  }

  const fpSiteId = ids.fpSiteId;
  const wixSiteId = ids.wixSiteId as string;
  await mapPool(subjects, 2, async (subject) => {
    const points = cleanPoints(subject.points);
    if (!points.length || !subject.placedBy) {
      scan.unplaced.push(subject.name);
      return;
    }
    const answers = (await mapPool(points, CONCURRENCY, (p) => zones.lookup(p.lat, p.lng).catch(() => null))).filter(
      (z): z is PointZones => z !== null
    );
    if (!answers.length) {
      scan.unplaced.push(subject.name);
      return;
    }
    scan.checked++;
    const levels = levelDetails(subject.page, answers);
    const toWrite = levelsToWrite(levels);
    const staticWrong = subject.staticPage ? staticDiffers(levels, subject.staticPage.says) : false;

    // A row with no schools yet, whose verified static page already names
    // what the zones do: filled in from it now, its copy with it.
    if (subject.row && subject.staticPage && !staticWrong && !hasSchools(subject.page) && toWrite.length) {
      const item = await getItem(wixSiteId, subject.row.collectionId, subject.row.wixItemId!);
      if (item && !hasSchools(rowSchools(item, subject.row.fields))) {
        await writeRow(wixSiteId, subject.row, levels, item);
        if (subject.mirror) await writeMirror(wixSiteId, subject.mirror, levels);
        scan.filled!.push(subject.name);
        scan.checked++;
        scan.matching++;
        return;
      }
    }

    const changed = toWrite.length > 0 || staticWrong;
    if (!changed) scan.matching++;
    const district = answers[0].district;
    const source = zones.sources.find((s) => s.district === district);
    const detail: SchoolZonesDetail = {
      site: target.domain,
      source: subject.row ? "collection" : "page",
      pageSource: subject.pageSource,
      pageUrl: subject.pageUrl,
      collectionId: subject.row?.collectionId ?? null,
      wixItemId: subject.row?.wixItemId ?? null,
      newRow: subject.row?.newRow ?? null,
      fields: subject.row?.fields ?? {},
      templates: subject.row?.templates ?? {},
      draft: subject.draft,
      district,
      latestYears: source?.latest ?? {},
      currentYear: source?.current ?? new Date(startedAt).getFullYear(),
      links: source?.links ?? { elementary: "", middle: "", high: "" },
      levels,
      homes: answers.length,
      sampleAddress: points.find((p) => p.address)?.address ?? null,
      placedBy: subject.placedBy,
      notes: [...new Set(answers.flatMap((a) => a.notes))],
      scannedAt: startedAt,
      fingerprint: fingerprintOf(levels) + (staticWrong ? `|static:${SCHOOL_LEVELS.map((l) => subject.staticPage!.says[l]).join("/")}` : ""),
      mirror: subject.mirror,
      staticPage: staticWrong ? subject.staticPage : null,
    };
    await recordSubject(fpSiteId, subject, detail, changed, scan);
  });

  for (const list of [scan.raised, scan.updated, scan.noSchools, scan.unplaced, scan.handled, scan.filled!]) list.sort();
  return scan;
}

async function scanRunning(now: Date): Promise<boolean> {
  const { data: running, error } = await supabase
    .from("ca_school_scans")
    .select("id, started_at")
    .is("finished_at", null)
    .gte("started_at", new Date(now.getTime() - STALE_MS).toISOString())
    .limit(1);
  if (error) throw failed("reading the school scans", error);
  return Boolean(running?.length);
}

/** Every site's villages against the districts' zones; one scan at a time. */
export async function runSchoolZoneScan(trigger: "cron" | "hub"): Promise<SchoolScan> {
  const now = new Date();
  if (await scanRunning(now)) throw new Error("A school zone scan is already running; it takes a few minutes");

  const { data: row, error: insertError } = await supabase
    .from("ca_school_scans")
    .insert({ trigger, started_at: now.toISOString() })
    .select("id")
    .single();
  if (insertError) throw failed("starting the school scan", insertError);

  const result: SchoolScan = { id: row.id, startedAt: now.toISOString(), sources: [], problems: [], sites: [] };
  try {
    const zones = await SchoolZones.load(now);
    result.sources = zones.sources;
    result.problems = zones.problems;
    for (const target of SCHOOL_TARGETS) {
      try {
        result.sites.push(await scanSite(target, zones, result.startedAt));
      } catch (error) {
        logger.warn("School zone scan failed for a site", { site: target.domain, error: describeError(error) });
        result.sites.push({
          domain: target.domain,
          checked: 0,
          matching: 0,
          raised: [],
          updated: [],
          noSchools: [],
          unplaced: [],
          handled: [],
          error: describeError(error),
        });
      }
    }
  } finally {
    const { error } = await supabase
      .from("ca_school_scans")
      .update({ finished_at: new Date().toISOString(), summary: result })
      .eq("id", row.id);
    if (error) logger.warn("Could not record the school scan", { error: describeError(error) });
  }
  logger.info("School zone scan", {
    sites: result.sites.map((s) => ({ site: s.domain, checked: s.checked, raised: s.raised.length, filled: s.filled?.length ?? 0 })),
  });
  return result;
}

export interface ScanRecord {
  id: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  summary: SchoolScan | null;
}

/** The latest scans, newest first. */
export async function recentScans(limit = 5): Promise<ScanRecord[]> {
  const { data, error } = await supabase
    .from("ca_school_scans")
    .select("id, trigger, started_at, finished_at, summary")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw failed("reading the school scans", error);
  return (data ?? []).map((r) => ({
    id: r.id,
    trigger: r.trigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: (r.summary as SchoolScan | null) ?? null,
  }));
}

/**
 * Writes an alert's schools to its row in the site's collection, making
 * the row as a draft when the village has none, and closes the alert as
 * done. Refused when the row no longer says what the scan read, or a row
 * has been made since: someone changed it, so the scan is run again.
 */
export async function applySchoolZones(alertId: string): Promise<Outcome> {
  const { data: alert, error } = await supabase
    .from("ca_alerts")
    .select("id, kind, status, name, detail")
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw failed("reading the alert", error);
  if (!alert || alert.status !== "open" || alert.kind !== "school_zones") return { ok: false, status: 404, error: "No open school zones alert by that id" };
  const detail = alert.detail as SchoolZonesDetail;
  if (detail.source !== "collection" || !detail.collectionId || (!detail.wixItemId && !detail.newRow)) {
    return { ok: false, status: 400, error: "This village's page is built by hand: edit it in the Wix editor, then mark the alert complete" };
  }
  const ids = await siteIds(detail.site);
  if (!ids.wixSiteId) return { ok: false, status: 400, error: "The site has no Wix site id" };
  const fields = detail.fields as Record<SchoolLevel, string>;
  const levels = detail.levels;
  if (levelsToWrite(levels).length === 0) return { ok: false, status: 409, error: "Nothing to write: the page already matches" };

  let item: WixDataItem | null = null;
  if (detail.wixItemId) {
    item = await getItem(ids.wixSiteId, detail.collectionId, detail.wixItemId);
    if (!item) return { ok: false, status: 404, error: `${alert.name} is no longer in the collection` };
    for (const l of levels) {
      if (cleanText(readSchoolField(item.data?.[fields[l.level]])) !== l.page) {
        return { ok: false, status: 409, error: `${alert.name}'s schools changed since the scan: run the scan again` };
      }
    }
  } else {
    // A row may have been made since the scan: written twice, the village would have two.
    const ref = Object.entries(detail.newRow ?? {}).find(([, v]) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v as string));
    if (ref) {
      const { items } = await queryItems(ids.wixSiteId, detail.collectionId, { filter: { [ref[0]]: ref[1] }, limit: 1, includeDrafts: true });
      if (items.length) return { ok: false, status: 409, error: `${alert.name} has a row now: run the scan again` };
    }
  }

  const row: RowTarget = {
    collectionId: detail.collectionId,
    wixItemId: detail.wixItemId,
    newRow: detail.newRow ?? null,
    says: { elementary: "", middle: "", high: "" },
    fields,
    templates: detail.templates ?? {},
  };
  await writeRow(ids.wixSiteId, row, levels, item);
  if (detail.mirror) await writeMirror(ids.wixSiteId, detail.mirror, levels);
  const now = new Date().toISOString();
  // A static page still naming other schools is left to its to-do: the
  // alert stays open, its rows now written.
  const written = { ...detail, applyQueuedAt: null, applyError: null, appliedAt: now };
  if (detail.staticPage) {
    const levelsNow = levels.map((l) => ({ ...l, page: l.proposed, verdict: "same" as LevelVerdict }));
    const { error: keepError } = await supabase
      .from("ca_alerts")
      .update({ updated_at: now, detail: { ...written, levels: levelsNow } })
      .eq("id", alertId)
      .eq("status", "open");
    if (keepError) throw failed("recording the write", keepError);
    logger.info("School zones applied; the static page is left to its to-do", { site: detail.site, village: alert.name });
    return { ok: true };
  }
  const { error: closeError } = await supabase
    .from("ca_alerts")
    .update({ status: "done", resolved_at: now, updated_at: now, detail: written })
    .eq("id", alertId)
    .eq("status", "open");
  if (closeError) throw failed("closing the alert", closeError);
  logger.info("School zones applied", { site: detail.site, village: alert.name, created: !item });
  return { ok: true };
}

/** Sets or clears an open alert's Apply all marks, the rest of its detail as it is now. */
async function markApply(alertId: string, mark: Pick<SchoolZonesDetail, "applyQueuedAt" | "applyError">): Promise<void> {
  const { data, error } = await supabase.from("ca_alerts").select("detail").eq("id", alertId).eq("status", "open").maybeSingle();
  if (error) throw failed("reading the alert", error);
  if (!data) return;
  const { error: updateError } = await supabase
    .from("ca_alerts")
    .update({ detail: { ...(data.detail as SchoolZonesDetail), ...mark } })
    .eq("id", alertId)
    .eq("status", "open");
  if (updateError) throw failed("marking the alert", updateError);
}

/**
 * Apply all, its first half: marks every open alert Apply can write and
 * returns their ids for drainApplyAll. One already queued by a run still
 * going is left to it. Refused while a scan runs, which rewrites the
 * alerts it would write from.
 */
export async function queueApplyAll(): Promise<{ ok: true; ids: string[] } | { ok: false; status: 409; error: string }> {
  const now = new Date();
  if (await scanRunning(now)) return { ok: false, status: 409, error: "A school zone scan is running: Apply all once it has finished" };
  const { data, error } = await supabase.from("ca_alerts").select("id, name, detail").eq("kind", "school_zones").eq("status", "open").order("name");
  if (error) throw failed("reading the school zones alerts", error);
  const ids: string[] = [];
  for (const row of data ?? []) {
    const detail = row.detail as SchoolZonesDetail;
    if (!canApplySchools(detail) || applyQueued(detail, now.getTime())) continue;
    const { error: markError } = await supabase
      .from("ca_alerts")
      .update({ detail: { ...detail, applyQueuedAt: now.toISOString(), applyError: null } })
      .eq("id", row.id)
      .eq("status", "open");
    if (markError) throw failed(`queueing ${row.name}`, markError);
    ids.push(row.id);
  }
  return { ok: true, ids };
}

/**
 * Apply all, its second half, run after the answer has gone: writes each
 * queued alert as its own Apply would, one at a time (the Wix client
 * spaces the calls to stay under Wix's rate). One that cannot be written
 * keeps its card, with why. Wix still refusing after the client's own
 * cooldown ends the run: the rest are left for Apply all again.
 */
export async function drainApplyAll(ids: string[]): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let refused = 0;
  for (let i = 0; i < ids.length; i++) {
    let problem: string | null = null;
    try {
      const outcome = await applySchoolZones(ids[i]);
      if (!outcome.ok) problem = outcome.error;
    } catch (error) {
      if (error instanceof WixApiError && error.rateLimited) {
        const busy = "Wix is refusing calls for now: press Apply all again in a few minutes";
        for (const rest of ids.slice(i)) await markApply(rest, { applyQueuedAt: null, applyError: busy }).catch(() => {});
        refused += ids.length - i;
        logger.warn("Apply all stopped: Wix is throttling", { applied, left: ids.length - i });
        break;
      }
      problem = describeError(error);
    }
    if (problem) {
      refused++;
      await markApply(ids[i], { applyQueuedAt: null, applyError: problem }).catch((error) =>
        logger.warn("Could not mark an alert Apply all failed on", { id: ids[i], error: describeError(error) })
      );
    } else applied++;
  }
  logger.info("Apply all school zones", { applied, failed: refused });
  return { applied, failed: refused };
}
