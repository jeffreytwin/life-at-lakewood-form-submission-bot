// Homes by WestBay extractor: a community's page draws its plans and its
// homes for sale from the site's own feeds once its scripts run, and a
// fetch sees none of them (Crosswind Ranch fetched as seventeen thousand
// characters without a price, 2026-09-23). The page names the community's
// id (`:community="24"`, Star Farms), and the feeds answer by it:
//
//   /api/residences?community=24&page=1   every plan offered in the community,
//                                          at its price there: name ("Sandpiper
//                                          at Star Farms at Lakewood Ranch"),
//                                          series, beds, baths, size, garage,
//                                          its page in the community, its front
//   /api/homes?community=24&page=1         every home for sale: address, plan,
//                                          price, facts, its page, its front
//
// (/api/plans answers all eighty-four of WestBay's plans whatever
// community it is asked for, at their prices anywhere.)
//
// Each plan's and home's own page is then read for its gallery, drawings,
// tour and description, as every other connection's are (claude-extract.ts).
// Before this, the connection read the series pages by their addresses,
// and WestBay renamed them (".../artisan" became ".../artisan-oakfield-60s").

import { fetchPage, readPlanPages } from "@/lib/floorplans/extractors/claude-extract";
import { standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface WestBayPlan {
  id?: number;
  cover?: string | null;
  coverAlt?: string | null;
  name?: string | null;
  series_name?: string | null;
  price?: number | null;
  beds?: number | string | null;
  baths?: number | string | null;
  sqft?: number | string | null;
  garage?: number | string | null;
  floors?: number | null;
  url?: string | null;
}

export interface WestBayHome {
  id?: number;
  cover?: { hd?: string; large?: string; original?: string } | null;
  coverAlts?: { default?: string | null } | null;
  title?: string | null;
  series_name?: string | null;
  address?: string | null;
  price?: number | null;
  beds?: number | string | null;
  baths?: number | string | null;
  sqft?: number | string | null;
  garage?: number | string | null;
  url?: string | null;
  availability_headline?: string | null;
  is_coming_soon?: string | boolean | null;
}

const clean = (s: unknown) => (typeof s === "string" ? s : s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
const money = (n: number | null) => (n ? "$" + n.toLocaleString("en-US") : null);

/** "3 - 4" as "3-4", 5 as "5". */
const range = (v: unknown) => clean(v).replace(/\s*[-–]\s*/, "-");

/** The size a plan is built from: "3,418 - 3,626" is 3,418. */
const size = (v: unknown): number | null => {
  const n = Number(clean(v).split(/\s*[-–]\s*/)[0].replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The community's id, as its page hands it to the lists it draws. Exported for tests. */
export function communityIdIn(html: string): string | null {
  return html.match(/:community(?:-id)?=["'](\d+)["']/)?.[1] ?? html.match(/:context-community=["'](\d+)["']/)?.[1] ?? null;
}

/** A plan as the residences feed files it, named without the community it is offered in. Exported for tests. */
export function planFromRecord(r: WestBayPlan): NormalizedPlan | null {
  const name = residenceName(r as Record<string, unknown>);
  if (!name) return null;
  const price = r.price && r.price > 0 ? r.price : null;
  const cover = clean(r.cover);
  const series = clean(r.series_name) || null;
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: money(price),
    beds: range(r.beds),
    baths: range(r.baths),
    sqft: size(r.sqft),
    garages: clean(r.garage) ? `${clean(r.garage)} car` : null,
    // WestBay builds single-family homes in these communities; a series of
    // villas or townhomes says so in its name.
    homeType: standardHomeType(/villa|town/i.test(series ?? "") ? series : "Single Family Home"),
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: clean(r.url) || null,
    galleryImages: cover ? [cover] : [],
    galleryMeta: cover ? { [cover]: { kind: "primary", caption: clean(r.coverAlt) || null } } : undefined,
    blueprintImages: [],
    raw: { planId: r.id != null ? String(r.id) : null, series },
  };
}

/** A home for sale as the feed files it; its plan is the title's before " at ": "Egret III at Star Farms at Lakewood Ranch". Exported for tests. */
export function homeFromRecord(r: WestBayHome): NormalizedPlan | null {
  const street = clean(r.address);
  if (!street) return null;
  const price = r.price && r.price > 0 ? r.price : null;
  const cover = clean(r.cover?.hd ?? r.cover?.large ?? r.cover?.original);
  const planName = clean(clean(r.title).split(/\s+at\s+/i)[0]) || null;
  const series = clean(r.series_name) || null;
  return {
    planKey: normKey(street),
    name: street,
    price,
    priceDisplay: money(price),
    beds: range(r.beds),
    baths: range(r.baths),
    sqft: size(r.sqft),
    garages: clean(r.garage) ? `${clean(r.garage)} car` : null,
    homeType: standardHomeType(/villa|town/i.test(series ?? "") ? series : "Single Family Home"),
    quickMoveIn: true,
    comingSoon: false,
    sourceUrl: clean(r.url) || null,
    relatedPlanName: planName,
    galleryImages: cover ? [cover] : [],
    galleryMeta: cover ? { [cover]: { kind: "primary", caption: clean(r.coverAlts?.default) || null } } : undefined,
    blueprintImages: [],
    raw: { relatedPlan: planName, series, homeId: r.id ?? null, availability: clean(r.availability_headline) || null },
  };
}

/**
 * The plan a residence record is of, however the feed names it: its own
 * name, its plan's, or its title before " at " ("Egret III at Star Farms").
 * Exported for tests.
 */
export function residenceName(r: Record<string, unknown>): string {
  const plan = r.plan as { name?: unknown } | undefined;
  const named = [r.plan_name, r.floorplan_name, plan?.name, r.name, r.title].map(clean).find(Boolean) ?? "";
  return clean(named.split(/\s+at\s+/i)[0]);
}

/** Every page of one of the site's lists. */
async function everyPage<T>(origin: string, path: string, community: string, referer: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${origin}${path}?community=${community}&page=${page}`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", referer }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const body = (await res.json()) as { data?: T[]; last_page?: number; next_page_url?: string | null };
    all.push(...(body.data ?? []));
    if (!body.next_page_url || (body.last_page != null && page >= body.last_page) || !body.data?.length) break;
  }
  return all;
}

export async function extractWestBay(params: { url?: string; communityId?: string | number; runDeadline?: number }): Promise<NormalizedPlan[]> {
  const url = params.url?.trim();
  if (!url) throw new Error("the Homes by WestBay extractor needs the community's page (extractor_params.url)");
  const origin = new URL(url).origin;
  let id = params.communityId != null ? String(params.communityId) : null;
  if (!id) {
    const page = await fetchPage(url);
    id = communityIdIn(page.html);
    if (!id) throw new Error(`${url} names no community id (":community=") — not a WestBay community page?`);
  }
  const [planRecords, homeRecords] = await Promise.all([
    everyPage<WestBayPlan>(origin, "/api/residences", id, url),
    everyPage<WestBayHome>(origin, "/api/homes", id, url),
  ]);
  // One plan once; a plan the feed lists in two series keeps its first.
  const byKey = new Map<string, NormalizedPlan>();
  for (const p of [...planRecords.map(planFromRecord), ...homeRecords.map(homeFromRecord)]) {
    if (p && !byKey.has(p.planKey)) byKey.set(p.planKey, p);
  }
  if (!byKey.size) throw new Error(`no plans or homes in WestBay's feeds for community ${id}`);
  return readPlanPages([...byKey.values()], { read: fetchPage, atOnce: 6, runDeadline: params.runDeadline });
}
