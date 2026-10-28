// Which schools a home is zoned for, from each district's own published
// zones (Jeff, 2026-10-28: "official sources to verify elementary, middle
// and high school zoning"). Both districts publish the coming school
// year's zones ahead of time, and the pages follow the latest one
// published, as Jeff's verified Lakewood pages do (Rangeland High, which
// opens for 2027-28); the school year under way is kept beside it so an
// alert can say what changes when.
//
//  - Manatee: the district's School Locator (GuideK12), one school year
//    per path, asked point by point.
//  - Sarasota: the district's zone layers on ArcGIS, one service per level
//    and year ("2027_Elementary_School_Zones_shp", "High__Zone_2026"), read
//    whole once and matched point by point here; the county's own layers
//    stand in for a year the district has not published by level.

import { cleanText, displayName, type District, type SchoolLevel } from "@/lib/school-zones/names";

const TIMEOUT_MS = 30_000;

export const MANATEE_LOCATOR = "https://www.manateeschools.net/schoollocator";
const MANATEE_API = (year: number) => `https://app.guidek12.com/manateefl/school_search/${year}/api.json`;

export const SARASOTA_SERVICES = "https://services8.arcgis.com/eexSNRRILRYnXSNf/arcgis/rest/services";
/** The district's lookup pages, one per level and year, published by its ArcGIS account; the account's gallery when one is missing. */
const SARASOTA_APPS = "https://www.arcgis.com/sharing/rest/search?q=owner%3Adiane.cominotti_SCSB%20type%3A%22Web%20Mapping%20Application%22&num=100&f=json";
export const SARASOTA_GALLERY = "https://scsb.maps.arcgis.com/home/search.html?q=School%20Zones";
/** The county's zone layers: the school year under way, kept by the county. */
const SARASOTA_COUNTY: Record<SchoolLevel, string> = {
  elementary: "https://ags3.scgov.net/server/rest/services/Hosted/ElementarySchoolZone/FeatureServer/0",
  middle: "https://ags3.scgov.net/server/rest/services/Hosted/MiddleSchoolZone/FeatureServer/0",
  high: "https://ags3.scgov.net/server/rest/services/Hosted/HighSchoolZone/FeatureServer/0",
};

export type LevelSchools = Partial<Record<SchoolLevel, string[]>>;

/** What the zones say for one point: the latest year published, and the year under way. Names as the sites write them. */
export interface PointZones {
  district: District;
  latest: LevelSchools;
  current: LevelSchools;
  /** The district's notes on the schools named, e.g. a K-8 adding one grade a year. */
  notes: string[];
}

/** Where a district's answers came from, for the scan's summary and the alerts. */
export interface ZoneSource {
  district: District;
  /** The school year each level's latest zones are for, as its first calendar year (2027 = 2027-28). */
  latest: Partial<Record<SchoolLevel, number>>;
  current: number;
  /** The district's own page to check a school by hand, by level. */
  links: Record<SchoolLevel, string>;
}

/** The school year under way, by its first calendar year: August starts a new one. */
export function schoolYearOf(now: Date): number {
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

/** 2027 → "2027-28". */
export function schoolYearLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- Manatee

const MANATEE_LEVEL: Record<string, SchoolLevel> = { ELEM: "elementary", MIDD: "middle", HIGH: "high" };

interface GuideK12School {
  id: number;
  school_label: string;
  attr?: { SCHOOL_TYPE?: string[]; NOTE?: string[] };
}

interface ManateeYear {
  year: number;
  schools: Map<number, { name: string; level: SchoolLevel | null; notes: string[] }>;
}

async function guideK12<T>(year: number, body: Record<string, unknown>): Promise<T> {
  const data = await getJson<{ status: string; messages?: string[]; result: T }>(MANATEE_API(year), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (data.status !== "OK") throw new Error(`Manatee's School Locator: ${data.messages?.join(" ") || data.status}`);
  return data.result;
}

/** A school year's schools in the locator; null when the district has not published that year. */
async function manateeYear(year: number): Promise<ManateeYear | null> {
  let list: GuideK12School[];
  try {
    list = await guideK12<GuideK12School[]>(year, { mode: "list_schools" });
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  const schools = new Map<number, { name: string; level: SchoolLevel | null; notes: string[] }>();
  for (const s of list) {
    schools.set(s.id, {
      name: displayName("manatee", s.school_label),
      level: MANATEE_LEVEL[s.attr?.SCHOOL_TYPE?.[0] ?? ""] ?? null,
      notes: (s.attr?.NOTE ?? []).map(cleanText).filter(Boolean),
    });
  }
  return { year, schools };
}

async function manateePoint(y: ManateeYear, lat: number, lng: number): Promise<{ schools: LevelSchools; notes: string[] } | null> {
  const result = await guideK12<{ in_district: boolean; school_results: { id: number }[] }>(y.year, {
    mode: "schools_spatial",
    attr: {},
    grades: [],
    spatial_args: { wkt: `POINT(${lng} ${lat})`, srid: 4326, type: "point" },
    zones: ["attendance"],
  });
  if (!result?.in_district) return null;
  const schools: LevelSchools = {};
  const notes: string[] = [];
  for (const r of result.school_results ?? []) {
    const s = y.schools.get(r.id);
    if (!s?.level) continue;
    (schools[s.level] ??= []).push(s.name);
    notes.push(...s.notes);
  }
  return { schools, notes };
}

// --------------------------------------------------------------- Sarasota

type Ring = number[][];
interface Zone {
  name: string;
  rings: Ring[];
}

/** Inside a polygon of these rings, holes and separate parts included (even-odd). Pure. */
export function pointInRings(lng: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface ZoneService {
  name: string;
  level: SchoolLevel;
  year: number;
}

/** The district's zone services by level and year, from their names. Pure. */
export function readZoneServices(services: { name: string; type: string }[]): ZoneService[] {
  const out: ZoneService[] = [];
  for (const s of services) {
    if (s.type !== "FeatureServer" || !/zone/i.test(s.name)) continue;
    const year = s.name.match(/(20\d\d)/)?.[1];
    const level: SchoolLevel | null = /elem/i.test(s.name) ? "elementary" : /midd/i.test(s.name) ? "middle" : /high/i.test(s.name) ? "high" : null;
    if (year && level) out.push({ name: s.name, level, year: Number(year) });
  }
  return out;
}

const NAME_KEYS = ["school_nam", "school_name", "Sch_na_vis", "SCHOOL_NAM", "SCHOOL_NAME", "SchoolName", "Name", "NAME"];

/** The school a zone feature is for. Pure; exported for tests. */
export function zoneName(attributes: Record<string, unknown>): string | null {
  for (const key of NAME_KEYS) {
    const v = attributes[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const v of Object.values(attributes)) {
    if (typeof v === "string" && /zone|school|elementary|middle|high|k-8/i.test(v)) return v.trim();
  }
  return null;
}

async function loadZones(layerUrl: string): Promise<Zone[]> {
  const url = `${layerUrl}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.00005&f=json`;
  const data = await getJson<{ features?: { attributes: Record<string, unknown>; geometry?: { rings?: Ring[] } }[]; error?: { message?: string } }>(url);
  if (data.error) throw new Error(`Sarasota's zones: ${data.error.message ?? "unreadable"}`);
  const zones: Zone[] = [];
  for (const f of data.features ?? []) {
    const name = zoneName(f.attributes ?? {});
    if (name && f.geometry?.rings?.length) zones.push({ name: displayName("sarasota", name), rings: f.geometry.rings });
  }
  if (zones.length === 0) throw new Error(`Sarasota's zones: no zones in ${layerUrl}`);
  return zones;
}

/** The district's lookup page for each level's year, from the apps' titles ("2027-28 Elementary Attendance Zone Lookup"). Pure. */
export function lookupLinks(apps: { title: string; url?: string | null }[], years: Partial<Record<SchoolLevel, number>>): Record<SchoolLevel, string> {
  const links = { elementary: SARASOTA_GALLERY, middle: SARASOTA_GALLERY, high: SARASOTA_GALLERY };
  for (const level of ["elementary", "middle", "high"] as SchoolLevel[]) {
    const year = years[level];
    if (!year) continue;
    const word = level === "elementary" ? /elementary/i : level === "middle" ? /middle/i : /high/i;
    const app = apps.find((a) => a.url && a.title.startsWith(schoolYearLabel(year)) && word.test(a.title));
    if (app?.url) links[level] = app.url;
  }
  return links;
}

const zonesAt = (zones: Zone[], lat: number, lng: number) => zones.filter((z) => pointInRings(lng, lat, z.rings)).map((z) => z.name);

// ------------------------------------------------------------------ Both

/**
 * Both districts' zones, ready to ask. Sarasota's are matched here, so a
 * point is tried there first; a point outside them is asked of Manatee.
 */
export class SchoolZones {
  private constructor(
    private readonly sarasota: { latest: Record<SchoolLevel, Zone[]>; current: Record<SchoolLevel, Zone[]> } | null,
    private readonly manatee: { latest: ManateeYear; current: ManateeYear } | null,
    readonly sources: ZoneSource[],
    /** Why a district could not be read; its points go unanswered. */
    readonly problems: string[]
  ) {}

  static async load(now = new Date()): Promise<SchoolZones> {
    const year = schoolYearOf(now);
    const sources: ZoneSource[] = [];
    const problems: string[] = [];

    let sarasota: SchoolZones["sarasota"] = null;
    try {
      const listing = await getJson<{ services?: { name: string; type: string }[] }>(`${SARASOTA_SERVICES}?f=json`);
      const services = readZoneServices(listing.services ?? []);
      const latest = {} as Record<SchoolLevel, Zone[]>;
      const current = {} as Record<SchoolLevel, Zone[]>;
      const latestYears: Partial<Record<SchoolLevel, number>> = {};
      for (const level of ["elementary", "middle", "high"] as SchoolLevel[]) {
        const ofLevel = services.filter((s) => s.level === level).sort((a, b) => b.year - a.year);
        const newest = ofLevel[0] && ofLevel[0].year >= year ? ofLevel[0] : null;
        const thisYear = ofLevel.find((s) => s.year === year) ?? null;
        current[level] = await loadZones(thisYear ? `${SARASOTA_SERVICES}/${thisYear.name}/FeatureServer/0` : SARASOTA_COUNTY[level]);
        latest[level] = newest && newest !== thisYear ? await loadZones(`${SARASOTA_SERVICES}/${newest.name}/FeatureServer/0`) : current[level];
        latestYears[level] = newest?.year ?? year;
      }
      sarasota = { latest, current };
      const apps = await getJson<{ results?: { title: string; url?: string | null }[] }>(SARASOTA_APPS).catch(() => ({ results: [] }));
      sources.push({ district: "sarasota", latest: latestYears, current: year, links: lookupLinks(apps.results ?? [], latestYears) });
    } catch (error) {
      problems.push(`Sarasota County Schools' zones could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }

    let manatee: SchoolZones["manatee"] = null;
    const [thisYear, nextYear] = await Promise.all([manateeYear(year), manateeYear(year + 1)]);
    const latestYear = nextYear ?? thisYear;
    if (latestYear) {
      manatee = { latest: latestYear, current: thisYear ?? latestYear };
      sources.push({
        district: "manatee",
        latest: { elementary: latestYear.year, middle: latestYear.year, high: latestYear.year },
        current: year,
        links: { elementary: MANATEE_LOCATOR, middle: MANATEE_LOCATOR, high: MANATEE_LOCATOR },
      });
    } else {
      problems.push("Manatee's School Locator could not be read");
    }

    return new SchoolZones(sarasota, manatee, sources, problems);
  }

  /** The schools a point is zoned for; null outside both districts, or where a district could not be read. */
  async lookup(lat: number, lng: number): Promise<PointZones | null> {
    if (this.sarasota) {
      const latest: LevelSchools = {};
      const current: LevelSchools = {};
      for (const level of ["elementary", "middle", "high"] as SchoolLevel[]) {
        const now = zonesAt(this.sarasota.latest[level], lat, lng);
        if (now.length) latest[level] = now;
        const then = zonesAt(this.sarasota.current[level], lat, lng);
        if (then.length) current[level] = then;
      }
      if (Object.keys(latest).length || Object.keys(current).length) return { district: "sarasota", latest, current, notes: [] };
    }
    if (this.manatee) {
      const latest = await manateePoint(this.manatee.latest, lat, lng);
      if (!latest) return null;
      const current =
        this.manatee.current === this.manatee.latest ? latest : ((await manateePoint(this.manatee.current, lat, lng)) ?? { schools: {}, notes: [] });
      return { district: "manatee", latest: latest.schools, current: current.schools, notes: [...new Set([...latest.notes, ...current.notes])] };
    }
    return null;
  }
}
