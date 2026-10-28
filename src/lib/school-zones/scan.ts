// The school zone scan (Jeff, 2026-10-28): every October, and on demand
// from the School Zones tab, each village on each site is checked against
// the districts' zones for homes in it. A village whose page names other
// schools, or names the same schools another way, raises a school zones
// alert with what the page should say; its Apply button writes it to the
// site's Neighborhoods collection.
//
// Life At Lakewood is moving its village pages from pages built one by
// one to its Dynamic Village Pages collection (HousesforSale-DynamicPages),
// a few villages so far (Jeff, 2026-10-28). So each of its villages is
// checked where its page is now: a village with a row there is written
// with Apply, as on the other sites; one still on its static page gets a
// to-do to edit the page by hand, the page read live; only a village with
// neither gets a row, made as a draft by Apply.
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
  type WixCollectionField,
  type WixDataItem,
} from "@/lib/wix/client";
import { writePayload } from "@/lib/villages/sync";
import { villageKey, type VillageRangeProfile } from "@/lib/villages/ranges";
import { PARRISH_PROFILE, WELLEN_PARK_PROFILE } from "@/lib/villages/profiles";
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

/**
 * Where each site's villages name their schools.
 *  - rows: the collection's rows are the villages (Wellen Park, Parrish).
 *  - villages: the listings engine's villages are, each on its row of the
 *    collection, its static page, or neither (Life At Lakewood).
 */
type SchoolTarget =
  | { domain: string; source: "rows"; collectionId: string; profile: VillageRangeProfile }
  | { domain: string; source: "villages"; collectionId: string };

export const SCHOOL_TARGETS: SchoolTarget[] = [
  { domain: "lifeatlakewood.com", source: "villages", collectionId: "HousesforSale-DynamicPages" },
  { domain: "lifeinwellenpark.com", source: "rows", collectionId: "HousesforSale-DynamicPages", profile: WELLEN_PARK_PROFILE },
  { domain: "lifeatparrish.com", source: "rows", collectionId: "HousesforSale-DynamicPages", profile: PARRISH_PROFILE },
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

interface Subject {
  name: string;
  key: string;
  /** What the page says: the row, or a Lakewood village's static page. */
  page: PageSchools;
  pageSource: "row" | "static" | "none";
  pageUrl: string | null;
  /** The row Apply writes or makes; null for a static page, edited by hand. */
  row: RowTarget | null;
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

async function siteIds(domain: string): Promise<{ fpSiteId: string | null; lsSiteId: string | null; wixSiteId: string | null }> {
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

const fieldNamed = (fields: WixCollectionField[], name: RegExp, type?: string) =>
  fields.find((f) => name.test(f.displayName ?? "") && (!type || f.type === type))?.key ?? null;

/** A reference field's value, whether Wix gives it as the id or the referenced item. */
function referenceId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>)._id ?? (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
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
  const villages = await lsVillages(ids.lsSiteId);
  const points = ids.lsSiteId ? await villagePoints(ids.lsSiteId) : new Map<string, Point[]>();
  const { collection, fields, items, templates } = await readCollection(ids.wixSiteId, target.collectionId);
  const subjects: Subject[] = [];

  if (target.source === "villages") {
    // A row is its village by its Village reference, else by either of its names.
    const titleKey = fieldNamed(collection.fields, /^village name$/i) ?? "title";
    const refKey = fieldNamed(collection.fields, /^village$/i, "REFERENCE");
    const refNameKey = fieldNamed(collection.fields, /^village reference name$/i);
    const byRef = new Map<string, WixDataItem>();
    const byId = new Map(items.map((i) => [i.id, i]));
    const byName = new Map<string, WixDataItem>();
    for (const item of items) {
      const ref = refKey ? referenceId(item.data?.[refKey]) : null;
      if (ref && !byRef.has(ref)) byRef.set(ref, item);
      for (const key of [refNameKey, titleKey]) {
        const name = key ? item.data?.[key] : null;
        if (typeof name === "string" && name.trim() && !byName.has(villageKey(name))) byName.set(villageKey(name), item);
      }
    }

    await mapPool(villages, CONCURRENCY, async (v) => {
      const base = { name: v.name, key: villageKey(v.name), pageUrl: v.page_url, points: points.get(v.id) ?? [], placedBy: points.get(v.id)?.length ? ("listings" as const) : null };
      // The village's Wix id is its row's Village reference, or the row's own id.
      const item =
        (v.wix_item_id ? (byRef.get(v.wix_item_id) ?? byId.get(v.wix_item_id)) : undefined) ?? byName.get(villageKey(v.name)) ?? null;
      if (item) {
        const says = rowSchools(item, fields);
        subjects.push({
          ...base,
          page: says,
          pageSource: "row",
          row: { collectionId: target.collectionId, wixItemId: item.id, newRow: null, says, fields, templates },
          draft: item.data?._publishStatus === "DRAFT",
        });
        return;
      }

      // No row: the village's static page, if it has one (a /village/ address is the dynamic page, still to be made).
      if (v.page_url && !isDynamicPage(v.page_url)) {
        let page: Awaited<ReturnType<typeof fetchStaticPage>>;
        try {
          page = await fetchStaticPage(v.page_url);
        } catch (error) {
          scan.error = [scan.error, `${v.name}'s page could not be read: ${describeError(error)}`].filter(Boolean).join("; ");
          return;
        }
        if (page.exists) {
          if (!hasSchools(page.schools)) {
            scan.noSchools.push(v.name);
            return;
          }
          subjects.push({ ...base, page: page.schools, pageSource: "static", row: null, draft: false });
          return;
        }
      }

      // Neither: Apply makes the row, as a draft.
      const newRow: Record<string, unknown> = { [titleKey]: v.name };
      if (refNameKey) newRow[refNameKey] = v.name;
      if (refKey && v.wix_item_id) newRow[refKey] = v.wix_item_id;
      const none: PageSchools = { elementary: "", middle: "", high: "" };
      subjects.push({
        ...base,
        page: none,
        pageSource: "none",
        row: { collectionId: target.collectionId, wixItemId: null, newRow, says: none, fields, templates },
        draft: true,
      });
    });
    return subjects;
  }

  // An item is its village by any of its names, a source's other name for it included.
  const aliases = new Map(Object.entries(target.profile.villageAliases).map(([from, to]) => [villageKey(from), villageKey(to)]));
  const villageByKey = new Map<string, LsVillage>();
  for (const v of villages) {
    const k = villageKey(v.name);
    villageByKey.set(aliases.get(k) ?? k, v);
  }
  for (const item of items) {
    const titles = target.profile.titleKeys.map((k) => item.data?.[k]).filter((t): t is string => typeof t === "string" && t.trim() !== "");
    const name = titles[0]?.trim();
    if (!name) continue;
    const says = rowSchools(item, fields);
    if (!hasSchools(says)) {
      scan.noSchools.push(name);
      continue;
    }
    const village = titles.map((t) => villageByKey.get(villageKey(t))).find(Boolean) ?? null;
    const own = village ? (points.get(village.id) ?? []) : [];
    subjects.push({
      name,
      key: villageKey(name),
      page: says,
      pageSource: "row",
      pageUrl: village?.page_url ?? null,
      row: { collectionId: target.collectionId, wixItemId: item.id, newRow: null, says, fields, templates },
      draft: item.data?._publishStatus === "DRAFT",
      points: own,
      placedBy: own.length ? "listings" : null,
    });
  }
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
    const changed = toWrite.length > 0;
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
      fingerprint: fingerprintOf(levels),
    };
    await recordSubject(fpSiteId, subject, detail, changed, scan);
  });

  for (const list of [scan.raised, scan.updated, scan.noSchools, scan.unplaced, scan.handled]) list.sort();
  return scan;
}

/** Every site's villages against the districts' zones; one scan at a time. */
export async function runSchoolZoneScan(trigger: "cron" | "hub"): Promise<SchoolScan> {
  const now = new Date();
  const { data: running, error: runningError } = await supabase
    .from("ca_school_scans")
    .select("id, started_at")
    .is("finished_at", null)
    .gte("started_at", new Date(now.getTime() - STALE_MS).toISOString())
    .limit(1);
  if (runningError) throw failed("reading the school scans", runningError);
  if (running?.length) throw new Error("A school zone scan is already running; it takes a few minutes");

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
    sites: result.sites.map((s) => ({ site: s.domain, checked: s.checked, raised: s.raised.length })),
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
  const now = new Date().toISOString();
  const { error: closeError } = await supabase
    .from("ca_alerts")
    .update({ status: "done", resolved_at: now, updated_at: now, detail: { ...detail, appliedAt: now } })
    .eq("id", alertId)
    .eq("status", "open");
  if (closeError) throw failed("closing the alert", closeError);
  logger.info("School zones applied", { site: detail.site, village: alert.name, created: !item });
  return { ok: true };
}
