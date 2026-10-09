// Arthur Rutenberg (AR Homes) extractor: a community's page draws its grid
// of plans from WordPress once its scripts run, so a fetch showed Claude
// the one model home it names and none of the plans (Wild Blue at
// Waterside, Jeff 2026-09-27: "at least 6 floor plans … it only pulled in
// 1"). The page names its community's record in its <head>:
//
//   <link rel="alternate" type="application/json" href=".../wp-json/wp/v2/community/32027">
//
// That record lists the grid's plans (acf.layout[].plans_list). Each
// plan's own record has its counts, its photographs and its drawing:
//
//   GET /wp-json/wp/v2/plan?include=<ids>&per_page=50&hideBuilderPlan=false
//
// (without hideBuilderPlan=false the feed leaves out the builder's own
// plans: half of Wild Blue's twelve). A plan's tour is read off its own
// page where the record names none. Nothing here asks Claude.
//
// Prices come from Lakewood Ranch's home finder, where AR's plans are
// advertised ("Homes From $…"), not from arhomes.com: the prices in the
// community record's "featured" tiles included the lot and a pool package,
// and the page that showed them is gone (Jeff, 2026-09-28: "It means I
// don't have anything publicly advertised").
//
// The quick move-ins are the builder's "Available Homes" (Jeff,
// 2026-10-09: "an area where we can see quick move-in homes in Wild
// Blue"). The builder's page of them, /builder/<builder>/available-homes/,
// lists every home it has on offer in its script data (window.arhData),
// each titled with the plan and the community: "Custom Lago at Wild Blue",
// "Lago Model at Wild Blue". A home is the community's where the place
// its title names is in the community record's title ("Wild Blue at
// Waterside in Lakewood Ranch"). Each home's own record has its address,
// counts, photographs and drawing:
//
//   GET /wp-json/wp/v2/available-home?include=<ids>&per_page=50

import { bathsOf } from "@/lib/floorplans/standardize";
import { streetOf } from "@/lib/floorplans/extractors/cardel";
import { isTourUrl, tourLinkIn, tourUrlIn } from "@/lib/floorplans/extractors/claude-extract";
import { parseHotelCards } from "@/lib/floorplans/extractors/mpc-aggregator";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface WpImage {
  url?: string | null;
}

export interface ArPlan {
  id?: number;
  slug?: string;
  link?: string;
  title?: { rendered?: string };
  acf?: {
    bedrooms?: string | number | null;
    bathrooms?: string | number | null;
    half_baths?: string | number | null;
    square_feet?: string | number | null;
    garages?: string | number | null;
    banner_image?: WpImage | false | null;
    gallery?: WpImage[] | false | null;
    interior_gallery?: WpImage[] | false | null;
    plan_pdf_image?: WpImage | false | null;
  };
}

interface ArCommunity {
  title?: { rendered?: string };
  acf?: { layout?: { plans_list?: unknown }[] };
}

/** A home as the builder's Available Homes page lists it (window.arhData). */
export interface ArListedHome {
  id?: number;
  title?: string;
  link?: string;
}

/** A home's own record (wp-json/wp/v2/available-home). */
export interface ArHome {
  id?: number;
  link?: string;
  title?: { rendered?: string };
  acf?: {
    sale_price?: string | number | null;
    address_text?: string | null;
    bedrooms?: string | number | null;
    baths?: string | number | null;
    half_baths?: string | number | null;
    sq_ft?: string | number | null;
    garages?: string | number | null;
    banner_image?: WpImage | false | null;
    photo_gallery?: WpImage[] | false | null;
    plan_pdf_image?: WpImage | false | null;
  };
}

/** Where AR's plans are advertised with a price: Lakewood Ranch's home finder, AR only. extractor_params.priceList overrides. */
export const AR_PRICE_LIST = "https://lakewoodranch.com/home-finder/?build%5B%5D=34701&home-search=Search+Homes&submitted=1";

/** A plan as Lakewood Ranch lists it: its name, its price where it gives one, and its page there. */
export interface ListedPrice {
  name: string;
  price: number | null;
  page: string | null;
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const number = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The community's record, as its page names it. Exported for tests. */
export function communityRecordIn(html: string): string | null {
  return html.match(/href=["']([^"']*\/wp-json\/wp\/v2\/community\/\d+)["']/i)?.[1] ?? null;
}

/** The grid's plans, by id, in the order the community lists them. Exported for tests. */
export function planIdsOf(community: ArCommunity): number[] {
  const ids: number[] = [];
  for (const block of community.acf?.layout ?? []) {
    const list = Array.isArray(block.plans_list) ? block.plans_list : [];
    for (const item of list) {
      const id = typeof item === "number" ? item : number((item as { ID?: unknown; id?: unknown } | null)?.ID ?? (item as { id?: unknown } | null)?.id ?? item);
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** A plan's name without its article or its number: "The Avila 1427" is the Avila. */
const planName = (name: string) => normKey(name.replace(/^\s*the\s+/i, "").replace(/\s+\d{3,5}$/, ""));

/**
 * The plans Lakewood Ranch's home finder lists in a village: its cards
 * name each plan, say "Homes From $…" (parseHotelCards) and link the
 * plan's page there, which carries its tour where AR's does not (Jeff,
 * 2026-09-28). A home already built is left out; a plan is priced as a
 * plan. Pure; exported for tests.
 */
export function listedPrices(html: string, village: string): ListedPrice[] {
  const wanted = normKey(village);
  return parseHotelCards(html, "https://lakewoodranch.com")
    .filter((c) => normKey(c.village.replace(/[–—]/g, "-")) === wanted && !c.plan.quickMoveIn)
    .map((c) => ({ name: c.plan.name, price: c.plan.price || null, page: c.plan.sourceUrl }));
}

const url = (img: WpImage | false | null | undefined) => (img && typeof img.url === "string" && img.url ? img.url : null);

/** One plan's record as a plan, priced as Lakewood Ranch advertises it, where it does. Pure; exported for tests. */
export function normalizeArPlan(plan: ArPlan, prices: ListedPrice[]): NormalizedPlan | null {
  const name = decode(plan.title?.rendered ?? "");
  if (!name) return null;
  const a = plan.acf ?? {};
  const tile = prices.find((t) => planName(t.name) === planName(name));
  const price = tile?.price ?? null;
  const photos = [url(a.banner_image), ...(a.gallery || []).map(url), ...(a.interior_gallery || []).map(url)].filter(
    (u, i, all): u is string => Boolean(u) && all.indexOf(u) === i
  );
  const drawing = url(a.plan_pdf_image);
  const garages = number(a.garages);
  const beds = number(a.bedrooms);
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: price ? "$" + price.toLocaleString("en-US") : null,
    beds: beds ? String(beds) : "",
    baths: bathsOf(number(a.bathrooms), number(a.half_baths)) ?? "",
    sqft: number(a.square_feet),
    garages: garages ? `${garages} car` : null,
    homeType: "Single Family Home",
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: plan.link ?? null,
    galleryImages: photos,
    blueprintImages: drawing ? [drawing] : [],
    description: null,
    // A tour the plan's record carries, in whatever field (its page's
    // "Virtual Tour" is read where the record has none: planTour).
    virtualTourUrl: tourUrlIn(JSON.stringify(plan)),
    // Its page on Lakewood Ranch's site, read for a tour where AR's is silent.
    ...(tile?.page ? { raw: { listedPage: tile.page } } : {}),
  };
}

/** The builder's Available Homes page, from its community's page: ".../builder/nelson-homes-inc/communities/…" → ".../builder/nelson-homes-inc/available-homes/". Pure; exported for tests. */
export function availableHomesPage(communityUrl: string): string | null {
  const m = communityUrl.match(/^(https?:\/\/[^/]+\/builder\/[^/]+\/)communities\//i);
  return m ? `${m[1]}available-homes/` : null;
}

/** The homes an Available Homes page lists in its script data. Pure; exported for tests. */
export function homesListedIn(html: string): ArListedHome[] {
  const out: ArListedHome[] = [];
  for (const m of html.matchAll(/window\.arhData\s*\[\s*'[^']*'\s*\]\s*=\s*(\{.*?\});\s*$/gm)) {
    try {
      const data = JSON.parse(m[1]) as { results?: unknown };
      for (const r of Array.isArray(data.results) ? data.results : []) {
        const home = r as ArListedHome;
        if (typeof home?.id === "number" && !out.some((h) => h.id === home.id)) out.push(home);
      }
    } catch {
      // Another block of script data, not the list.
    }
  }
  return out;
}

/**
 * Whether a home is in the community: the place its title names after
 * "at" ("Custom Lago at Wild Blue") is in the community's own title
 * ("Wild Blue at Waterside in Lakewood Ranch"). Pure; exported for tests.
 */
export function homeIsIn(homeTitle: string, communityTitle: string): boolean {
  const place = normKey(decode(homeTitle).match(/\sat\s+(.+)$/i)?.[1] ?? "");
  return Boolean(place) && `-${normKey(decode(communityTitle))}-`.includes(`-${place}-`);
}

/** The plan a home is built from, as its title names it: "Custom Lago at Wild Blue" and "Lago Model at Wild Blue" are the Lago. */
const homePlanName = (title: string) =>
  decode(title)
    .replace(/\s+at\s+.+$/i, "")
    .replace(/^\s*custom\s+/i, "")
    .replace(/\s+model(?:\s+home)?\s*$/i, "")
    .trim();

/**
 * One home's record as a quick move-in, named by its street address. A
 * home with no price is left out: the page keeps a home it has sold, at
 * $0 (Creekside Model at Holliday Farms). Pure; exported for tests.
 */
export function normalizeArHome(home: ArHome): NormalizedPlan | null {
  const a = home.acf ?? {};
  const address = (a.address_text ?? "").trim();
  const price = number(a.sale_price);
  if (!address || !price) return null;
  const name = streetOf(address);
  const photos = [url(a.banner_image), ...(a.photo_gallery || []).map(url)].filter(
    (u, i, all): u is string => Boolean(u) && all.indexOf(u) === i
  );
  const drawing = url(a.plan_pdf_image);
  const garages = number(a.garages);
  const beds = number(a.bedrooms);
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: "$" + price.toLocaleString("en-US"),
    beds: beds ? String(beds) : "",
    baths: bathsOf(number(a.baths), number(a.half_baths)) ?? "",
    sqft: number(a.sq_ft),
    garages: garages ? `${garages} car` : null,
    homeType: "Single Family Home",
    quickMoveIn: true,
    comingSoon: false,
    relatedPlanName: homePlanName(home.title?.rendered ?? "") || null,
    sourceUrl: home.link ?? null,
    galleryImages: photos,
    blueprintImages: drawing ? [drawing] : [],
    description: null,
  };
}

/**
 * The community's homes on offer, from the builder's Available Homes page.
 * A builder with no such page has none; a page or feed that cannot be read
 * otherwise stops the run, as the prices do: read as no homes, every home
 * would be proposed away.
 */
async function communityHomes(communityUrl: string, communityTitle: string): Promise<NormalizedPlan[]> {
  const page = availableHomesPage(communityUrl);
  if (!page) return [];
  const res = await fetch(page, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`fetch ${page}: ${res.status}`);
  const ids = homesListedIn(await res.text())
    .filter((h) => homeIsIn(h.title ?? "", communityTitle))
    .map((h) => h.id as number);
  if (!ids.length) return [];
  const feed = new URL("/wp-json/wp/v2/available-home", communityUrl);
  feed.searchParams.set("include", ids.join(","));
  feed.searchParams.set("per_page", "50");
  const homes = await getJson<ArHome[]>(feed.href);
  return homes.map(normalizeArHome).filter((h): h is NormalizedPlan => h !== null);
}

/**
 * The tour a plan's page offers: one embedded in it, or behind the link it
 * labels "Virtual Tour" — Eventide's page has one and the record did not
 * say (Jeff, 2026-09-28). A link that is a tour is taken as it is; one to
 * a page of the builder's own is read for the tour it holds. Null when the
 * page offers none. Exported for tests.
 */
export async function planTour(pageUrl: string, read: (url: string) => Promise<string>): Promise<string | null> {
  const html = await read(pageUrl);
  const embedded = tourUrlIn(html);
  if (embedded) return embedded;
  const link = tourLinkIn(html);
  if (!link) return null;
  if (isTourUrl(link)) return link;
  try {
    return tourUrlIn(await read(link));
  } catch {
    return null;
  }
}

async function getText(address: string): Promise<string> {
  const res = await fetch(address, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`fetch ${address}: ${res.status}`);
  return res.text();
}

async function getJson<T>(address: string): Promise<T> {
  const res = await fetch(address, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`fetch ${address}: ${res.status}`);
  return (await res.json()) as T;
}

export async function extractArHomes(params: { url?: string; priceList?: string; communityName?: string }): Promise<NormalizedPlan[]> {
  if (!params.url) throw new Error("this extractor requires extractor_params.url (the community's page)");
  const res = await fetch(params.url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`fetch ${params.url}: ${res.status}`);
  const record = communityRecordIn(await res.text());
  if (!record) throw new Error(`${params.url} names no community record (wp-json/wp/v2/community/…)`);
  const community = await getJson<ArCommunity>(new URL(record, params.url).href);
  const ids = planIdsOf(community);
  if (!ids.length) throw new Error(`the community record ${record} lists no plans`);
  const feed = new URL("/wp-json/wp/v2/plan", params.url);
  feed.searchParams.set("include", ids.join(","));
  feed.searchParams.set("per_page", "50");
  feed.searchParams.set("hideBuilderPlan", "false");
  const plans = await getJson<ArPlan[]>(feed.href);
  // A list that cannot be read stops the run: read as no prices, every
  // plan's price would be proposed away.
  const prices = listedPrices(await getText(params.priceList || AR_PRICE_LIST), params.communityName ?? "");
  const byId = new Map(plans.map((p) => [p.id, p]));
  const normalized = ids
    .map((id) => byId.get(id))
    .filter((p): p is ArPlan => Boolean(p))
    .map((p) => normalizeArPlan(p, prices))
    .filter((p): p is NormalizedPlan => p !== null);
  // Each plan's page for the tour its record does not name, on AR's site
  // and then on Lakewood Ranch's, a few at a time. A page that cannot be read costs the tour, never the plan, and
  // a run that finds none does not take a working tour away (diff.ts).
  const out: NormalizedPlan[] = [];
  for (let i = 0; i < normalized.length; i += 4) {
    out.push(
      ...(await Promise.all(
        normalized.slice(i, i + 4).map(async (plan) => {
          if (plan.virtualTourUrl) return plan;
          const listed = typeof plan.raw?.listedPage === "string" ? plan.raw.listedPage : null;
          let tour: string | null = null;
          for (const page of [plan.sourceUrl, listed]) {
            if (!page || tour) continue;
            tour = await planTour(page, getText).catch(() => null);
          }
          return tour ? { ...plan, virtualTourUrl: tour } : plan;
        })
      ))
    );
  }
  out.push(...(await communityHomes(params.url, community.title?.rendered ?? "")));
  return out;
}
