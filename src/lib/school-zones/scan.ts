// The school zone scan (Jeff, 2026-10-28): every October, and on demand
// from the School Zones tab, each village on each site is checked against
// the districts' zones for homes in it. A village whose page names other
// schools, or names the same schools another way, raises a school zones
// alert with what the page should say. On Wellen Park and Parrish the
// alert's Apply button writes it to the Neighborhoods collection; on Life
// At Lakewood, whose village pages are static, the alert is the to-do for
// the page.
//
// A village split between zones names each school with a share of its
// homes ("McNeal and Braden River Elementary", as the pages already do).

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { describeError, failedAt as failed } from "@/lib/shared/describe-error";
import { getDataCollection, getItem, queryAllItems, updateItem, WixApiError, type WixDataItem } from "@/lib/wix/client";
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
import { fetchPageSchools, readSchoolField, schoolFields, writeSchoolField, type PageSchools } from "@/lib/school-zones/pages";
import { cleanPoints, placesByHand, subdivisionPoints, villagePoints, type PlacedBy, type Point } from "@/lib/school-zones/places";
import { applyQueued, canApplySchools } from "@/lib/school-zones/apply";

/**
 * Where each site's villages name their schools. Life At Lakewood's are on
 * its static pages until its school zones are in its collection (Jeff,
 * 2026-10-28); then it becomes a collection target like the other two.
 */
type SchoolTarget =
  | { domain: string; source: "page" }
  | { domain: string; source: "collection"; collectionId: string; profile: VillageRangeProfile };

export const SCHOOL_TARGETS: SchoolTarget[] = [
  { domain: "lifeatlakewood.com", source: "page" },
  { domain: "lifeinwellenpark.com", source: "collection", collectionId: "HousesforSale-DynamicPages", profile: WELLEN_PARK_PROFILE },
  { domain: "lifeatparrish.com", source: "collection", collectionId: "HousesforSale-DynamicPages", profile: PARRISH_PROFILE },
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
  source: "page" | "collection";
  pageUrl: string | null;
  collectionId: string | null;
  wixItemId: string | null;
  /** The collection's field for each level. */
  fields: Partial<Record<SchoolLevel, string>>;
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
  error?: string;
}

export interface SchoolScan {
  id: string | null;
  startedAt: string;
  sources: ZoneSource[];
  problems: string[];
  sites: SiteScan[];
}

interface Subject {
  name: string;
  key: string;
  page: PageSchools;
  pageUrl: string | null;
  wixItemId: string | null;
  fields: Partial<Record<SchoolLevel, string>>;
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

export const fingerprintOf = (levels: LevelDetail[]) => levels.map((l) => `${l.level}:${l.page}>${l.proposed}`).join("|");

async function siteIds(domain: string): Promise<{ fpSiteId: string | null; lsSiteId: string | null; wixSiteId: string | null }> {
  const [{ data: fp, error: fpError }, { data: ls, error: lsError }] = await Promise.all([
    supabase.from("fp_sites").select("id, wix_site_id").eq("domain", domain).maybeSingle(),
    supabase.from("ls_sites").select("id, wix_site_id").eq("domain", domain).maybeSingle(),
  ]);
  if (fpError) throw failed(`reading ${domain}'s site`, fpError);
  if (lsError) throw failed(`reading ${domain}'s listings site`, lsError);
  return { fpSiteId: fp?.id ?? null, lsSiteId: ls?.id ?? null, wixSiteId: fp?.wix_site_id ?? ls?.wix_site_id ?? null };
}

async function lsVillages(lsSiteId: string | null): Promise<{ id: string; name: string; page_url: string | null }[]> {
  if (!lsSiteId) return [];
  const { data, error } = await supabase.from("ls_villages").select("id, name, page_url").eq("site_id", lsSiteId).order("name");
  if (error) throw failed("reading the villages", error);
  return data ?? [];
}

/** The villages to check on a site, each with what its page says and where its homes are. */
async function subjectsOf(target: SchoolTarget, ids: Awaited<ReturnType<typeof siteIds>>, scan: SiteScan): Promise<Subject[]> {
  const villages = await lsVillages(ids.lsSiteId);
  const points = ids.lsSiteId ? await villagePoints(ids.lsSiteId) : new Map<string, Point[]>();
  const subjects: Subject[] = [];

  if (target.source === "page") {
    await mapPool(villages, CONCURRENCY, async (v) => {
      if (!v.page_url) return;
      let page: PageSchools | null;
      try {
        page = await fetchPageSchools(v.page_url);
      } catch (error) {
        scan.error = [scan.error, `${v.name}'s page could not be read: ${describeError(error)}`].filter(Boolean).join("; ");
        return;
      }
      if (!page) {
        scan.noSchools.push(v.name);
        return;
      }
      subjects.push({
        name: v.name,
        key: villageKey(v.name),
        page,
        pageUrl: v.page_url,
        wixItemId: null,
        fields: {},
        draft: false,
        points: points.get(v.id) ?? [],
        placedBy: points.get(v.id)?.length ? "listings" : null,
      });
    });
    return subjects;
  }

  if (!ids.wixSiteId) throw new Error("the site has no Wix site id");
  const collection = await getDataCollection(ids.wixSiteId, target.collectionId);
  if (!collection) throw new Error(`the site has no ${target.collectionId} collection`);
  const fields = schoolFields(collection.fields);
  if (!fields.elementary || !fields.middle || !fields.high) throw new Error(`${target.collectionId} has no school fields`);
  const items = await queryAllItems(ids.wixSiteId, target.collectionId, { includeDrafts: true });

  // An item is its village by any of its names, a source's other name for it included.
  const aliases = new Map(Object.entries(target.profile.villageAliases).map(([from, to]) => [villageKey(from), villageKey(to)]));
  const villageByKey = new Map<string, (typeof villages)[number]>();
  for (const v of villages) {
    const k = villageKey(v.name);
    villageByKey.set(aliases.get(k) ?? k, v);
  }
  for (const item of items as WixDataItem[]) {
    const titles = target.profile.titleKeys.map((k) => item.data?.[k]).filter((t): t is string => typeof t === "string" && t.trim() !== "");
    const name = titles[0]?.trim();
    if (!name) continue;
    const page: PageSchools = {
      elementary: readSchoolField(item.data?.[fields.elementary]),
      middle: readSchoolField(item.data?.[fields.middle]),
      high: readSchoolField(item.data?.[fields.high]),
    };
    if (!SCHOOL_LEVELS.some((l) => page[l])) {
      scan.noSchools.push(name);
      continue;
    }
    const village = titles.map((t) => villageByKey.get(villageKey(t))).find(Boolean) ?? null;
    const own = village ? (points.get(village.id) ?? []) : [];
    subjects.push({
      name,
      key: villageKey(name),
      page,
      pageUrl: village?.page_url ?? null,
      wixItemId: item.id,
      fields,
      draft: item.data?._publishStatus === "DRAFT",
      points: own,
      placedBy: own.length ? "listings" : null,
    });
  }
  return subjects;
}

/** Raises, refreshes or leaves the village's alert. */
async function recordSubject(
  fpSiteId: string,
  subject: Subject,
  detail: SchoolZonesDetail,
  changed: boolean,
  scan: SiteScan
): Promise<void> {
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
  const scan: SiteScan = { domain: target.domain, checked: 0, matching: 0, raised: [], updated: [], noSchools: [], unplaced: [], handled: [] };
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
    const district = answers[0].district;
    const source = zones.sources.find((s) => s.district === district);
    const levels = levelDetails(subject.page, answers);
    const changed = levels.some((l) => l.verdict !== "same");
    if (!changed) scan.matching++;
    const detail: SchoolZonesDetail = {
      site: target.domain,
      source: target.source,
      pageUrl: subject.pageUrl,
      collectionId: target.source === "collection" ? target.collectionId : null,
      wixItemId: subject.wixItemId,
      fields: subject.fields,
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
  logger.info("School zone scan", { sites: result.sites.map((s) => ({ site: s.domain, checked: s.checked, raised: s.raised.length })) });
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
 * Writes an alert's schools to its row in the site's Neighborhoods
 * collection and closes it as done. Refused when the row no longer says
 * what the scan read: someone changed it since, so the scan is run again.
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
  if (detail.source !== "collection" || !detail.collectionId || !detail.wixItemId) {
    return { ok: false, status: 400, error: "This site's pages are updated by hand: work the list and mark it complete" };
  }
  const ids = await siteIds(detail.site);
  if (!ids.wixSiteId) return { ok: false, status: 400, error: "The site has no Wix site id" };
  const item = await getItem(ids.wixSiteId, detail.collectionId, detail.wixItemId);
  if (!item) return { ok: false, status: 404, error: `${alert.name} is no longer in the collection` };

  const after: Record<string, unknown> = {};
  for (const level of detail.levels) {
    if (level.verdict === "same") continue;
    const key = detail.fields[level.level];
    if (!key) return { ok: false, status: 400, error: `No field for the ${level.level} school` };
    if (cleanText(readSchoolField(item.data?.[key])) !== level.page) {
      return { ok: false, status: 409, error: `${alert.name}'s schools changed since the scan: run the scan again` };
    }
    after[key] = writeSchoolField(level.level, level.proposed, item.data?.[key]);
  }
  if (Object.keys(after).length === 0) return { ok: false, status: 409, error: "Nothing to write: the page already matches" };

  await updateItem(ids.wixSiteId, detail.collectionId, detail.wixItemId, writePayload(item, after));
  const now = new Date().toISOString();
  const { error: closeError } = await supabase
    .from("ca_alerts")
    .update({ status: "done", resolved_at: now, updated_at: now, detail: { ...detail, applyQueuedAt: null, applyError: null, appliedAt: now } })
    .eq("id", alertId)
    .eq("status", "open");
  if (closeError) throw failed("closing the alert", closeError);
  logger.info("School zones applied", { site: detail.site, village: alert.name, fields: Object.keys(after) });
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
