// Highland Homes extractor: a community's page draws its plans and its
// homes for sale from a feed it posts to once its scripts run, so a fetch
// gave Claude one plan of seven (Aviary at Rutland Ranch, 2026-09-23). The
// page names the community's id in a hidden field
// (`<input name="communityid" value="2">`), and the feed answers by it:
//
//   POST /components/CommunityDetailSearch.cfc?method=getCommunity&returnFormat=json&…&communityid=2
//
// Each record is a plan or a home for sale on one ("Parsyn", lot
// AV3-00-419, 7027 161st Terrace East, Move-In Ready): its price, beds,
// baths and half baths, garage, size and tour. Each plan's and home's own
// page is then read for its gallery, drawings and description
// (claude-extract.ts); its address is the one the community page links.

import { fetchPage, readPlanPages } from "@/lib/floorplans/extractors/claude-extract";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface HighlandRecord {
  name?: string | null;
  price?: number | null;
  bed?: number | null;
  maxbed?: number | null;
  bath?: number | null;
  halfbath?: number | null;
  garage?: number | null;
  totalsqft?: number | null;
  address?: string | null;
  lot?: string | null;
  inventoryhomesid?: number | null;
  modelid?: number | null;
  status?: string | null;
  virtualtour?: string | null;
  active?: number | null;
}

const clean = (s: unknown) => (typeof s === "string" ? s : s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
const money = (n: number | null) => (n ? "$" + n.toLocaleString("en-US") : null);
const positive = (n: number | null | undefined) => (n != null && n > 0 ? n : null);

/** The community's id, as its page keeps it for the feed. Exported for tests. */
export function communityIdIn(html: string): string | null {
  return html.match(/<input\b[^>]*\bname=["']communityid["'][^>]*\bvalue=["'](\d+)["']/i)?.[1] ?? html.match(/<input\b[^>]*\bvalue=["'](\d+)["'][^>]*\bname=["']communityid["']/i)?.[1] ?? null;
}

/** Whether a record is a home standing on a lot, not a plan. */
const isHome = (r: HighlandRecord) => Boolean(clean(r.lot) && /^\d+\s+\S/.test(clean(r.address)));

/** A name as a link spells it: "Westin II" and the site's own "Summerlyn ll" are both "…-ii". */
const slugKey = (s: string) => normKey(s.replace(/-/g, " ").replace(/\bll\b/gi, "ii"));

/**
 * Each plan's page and each home's, from the community page's links: a
 * plan's sits one step under the community (".../aviary-at-rutland-ranch/
 * westin-ii"), a home's one step under its plan's (".../parker/avi-00-004").
 * Exported for tests.
 */
export function pageLinks(html: string, communityUrl: string): { base: string; plans: Map<string, string>; homes: Map<string, string> } {
  const base = new URL(communityUrl);
  const under = base.pathname.replace(/\/+$/, "");
  const plans = new Map<string, string>();
  const homes = new Map<string, string>();
  for (const m of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (url.host !== base.host || !url.pathname.startsWith(`${under}/`)) continue;
    const rest = url.pathname.slice(under.length + 1).replace(/\/+$/, "").split("/");
    if (rest.length === 1 && rest[0]) plans.set(slugKey(rest[0]), `${url.origin}${under}/${rest[0]}`);
    if (rest.length === 2) homes.set(rest[1].toLowerCase(), `${url.origin}${under}/${rest[0]}/${rest[1]}`);
  }
  return { base: `${base.origin}${under}`, plans, homes };
}

/** A plan's name as the site writes it in an address: "Westin II" is "westin-ii", "Summerlyn ll" "summerlyn-ii". */
const slugOf = (name: string) =>
  name.toLowerCase().replace(/\bll\b/g, "ii").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const tourIn = (iframe: unknown) => clean(iframe).match(/\bsrc=["']([^"']+)["']/)?.[1] ?? null;

/** A plan or a home as the feed files it. Exported for tests. */
export function fromRecord(r: HighlandRecord, links: ReturnType<typeof pageLinks>): NormalizedPlan | null {
  const planName = clean(r.name);
  if (!planName) return null;
  const home = isHome(r);
  const street = clean(r.address).split(",")[0].trim();
  const name = home ? street : planName;
  const price = positive(r.price);
  const full = positive(r.bath);
  const baths = full != null ? full + (positive(r.halfbath) ? 0.5 * r.halfbath! : 0) : null;
  const beds = positive(r.bed);
  const maxBeds = positive(r.maxbed);
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: money(price),
    beds: beds == null ? "" : maxBeds && maxBeds > beds ? `${beds}-${maxBeds}` : String(beds),
    baths: baths == null ? "" : String(baths),
    sqft: positive(r.totalsqft),
    garages: positive(r.garage) ? `${r.garage} car` : null,
    // Highland builds single-family homes; its feed names no other kind.
    homeType: "Single Family Home",
    quickMoveIn: home,
    comingSoon: false,
    // The page's own link where it has one; the feed's cards are drawn by
    // script, so failing that the address the site gives every plan
    // (".../aviary-at-rutland-ranch/westin-ii") and home (".../parsyn/AV3-00-419").
    sourceUrl: home
      ? (links.homes.get(clean(r.lot).toLowerCase()) ?? `${links.base}/${slugOf(planName)}/${clean(r.lot)}`)
      : (links.plans.get(slugKey(planName)) ?? `${links.base}/${slugOf(planName)}`),
    relatedPlanName: home ? planName : undefined,
    virtualTourUrl: tourIn(r.virtualtour),
    galleryImages: [],
    blueprintImages: [],
    raw: { planId: r.modelid != null ? String(r.modelid) : null, relatedPlan: home ? planName : null, lot: clean(r.lot) || null, status: clean(r.status) || null },
  };
}

export async function extractHighland(params: { url?: string; runDeadline?: number }): Promise<NormalizedPlan[]> {
  const url = params.url?.trim();
  if (!url) throw new Error("the Highland Homes extractor needs the community's page (extractor_params.url)");
  const page = await fetchPage(url);
  const id = communityIdIn(page.html);
  if (!id) throw new Error(`${url} keeps no community id — not a Highland community page?`);
  const origin = new URL(page.url || url).origin;
  const feed = `${origin}/components/CommunityDetailSearch.cfc?method=getCommunity&returnFormat=json&s=1&metroarea=0&lowPrice=0&highprice=0&bed=0&bath=0&lowSqft=0&highsqft=0&amenities=&garage=0&additionalrooms=&hometype=&cityid=0&communityid=${id}`;
  const res = await fetch(feed, { method: "POST", headers: { "user-agent": UA, accept: "application/json", referer: url }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${feed}: ${res.status}`);
  const records = (await res.json()) as HighlandRecord[];
  if (!Array.isArray(records)) throw new Error(`${feed} answered with no list`);
  const links = pageLinks(page.html, page.url || url);
  const byKey = new Map<string, NormalizedPlan>();
  for (const r of records) {
    if (r.active === 0) continue;
    const p = fromRecord(r, links);
    if (p && !byKey.has(p.planKey)) byKey.set(p.planKey, p);
  }
  // A plan the feed lists only through its homes still has its page linked.
  for (const [key, planUrl] of links.plans) {
    const named = [...byKey.values()].find((p) => !p.quickMoveIn && slugKey(p.name) === key);
    if (!named && [...byKey.values()].some((p) => p.quickMoveIn && slugKey(p.relatedPlanName ?? "") === key)) {
      const name = planUrl.split("/").pop()!.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bIi\b/g, "II");
      byKey.set(normKey(name), { planKey: normKey(name), name, price: null, priceDisplay: null, beds: "", baths: "", sqft: null, garages: null, homeType: "Single Family Home", quickMoveIn: false, comingSoon: false, sourceUrl: planUrl, galleryImages: [], blueprintImages: [] });
    }
  }
  if (!byKey.size) throw new Error(`no plans or homes in Highland's feed for community ${id}`);
  return readPlanPages([...byKey.values()], { read: fetchPage, atOnce: 6, runDeadline: params.runDeadline, listPages: new Set([url]) });
}
