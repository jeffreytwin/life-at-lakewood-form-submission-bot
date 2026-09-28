// Arthur Rutenberg (AR Homes) extractor: a community's page draws its grid
// of plans from WordPress once its scripts run, so a fetch showed Claude
// the one model home it names and none of the plans (Wild Blue at
// Waterside, Jeff 2026-09-27: "at least 6 floor plans … it only pulled in
// 1"). The page names its community's record in its <head>:
//
//   <link rel="alternate" type="application/json" href=".../wp-json/wp/v2/community/32027">
//
// That record lists the grid's plans (acf.layout[].plans_list) and, in its
// "featured" tiles, each plan's price with the lot and outdoor package
// ("Avila 1427 … 3 Bedrooms | 3 Bathrooms | 3,134 Sq. Ft. | $2,255,300").
// Each plan's own record has its counts, its photographs and its drawing:
//
//   GET /wp-json/wp/v2/plan?include=<ids>&per_page=50&hideBuilderPlan=false
//
// (without hideBuilderPlan=false the feed leaves out the builder's own
// plans: half of Wild Blue's twelve). A plan's tour is read off its own
// page where the record names none. Nothing here asks Claude.

import { bathsOf } from "@/lib/floorplans/standardize";
import { isTourUrl, tourLinkIn, tourUrlIn } from "@/lib/floorplans/extractors/claude-extract";
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

interface ArTile {
  title?: string;
  description?: string;
}

interface ArCommunity {
  acf?: { layout?: { plans_list?: unknown; tiles?: ArTile[] }[] };
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

/**
 * Each featured tile's price, by the plan it names: "Avila 1427" is the
 * Avila, and its link ".../plan/avila-1427/" says the same. Exported for
 * tests.
 */
export function tilePrices(community: ArCommunity): { name: string; slug: string | null; price: number }[] {
  const out: { name: string; slug: string | null; price: number }[] = [];
  for (const block of community.acf?.layout ?? []) {
    for (const tile of block.tiles ?? []) {
      const text = decode(String(tile.description ?? "").replace(/<[^>]+>/g, " "));
      const price = number(text.match(/\$\s?\d{1,3}(?:,\d{3})+/)?.[0]);
      if (!price) continue;
      const name = decode(String(tile.title ?? "")).replace(/\s+\d{3,5}$/, "");
      const slug = String(tile.description ?? "").match(/\/plan\/([a-z0-9-]+)\/?["']/i)?.[1]?.replace(/-\d{3,5}$/, "") ?? null;
      out.push({ name, slug, price });
    }
  }
  return out;
}

const url = (img: WpImage | false | null | undefined) => (img && typeof img.url === "string" && img.url ? img.url : null);

/** One plan's record as a plan, priced by its tile where the community gives one. Pure; exported for tests. */
export function normalizeArPlan(plan: ArPlan, prices: ReturnType<typeof tilePrices>): NormalizedPlan | null {
  const name = decode(plan.title?.rendered ?? "");
  if (!name) return null;
  const a = plan.acf ?? {};
  const slug = (plan.slug ?? "").toLowerCase();
  const tile = prices.find((t) => normKey(t.name) === normKey(name) || (t.slug !== null && slug !== "" && t.slug === slug));
  const photos = [url(a.banner_image), ...(a.gallery || []).map(url), ...(a.interior_gallery || []).map(url)].filter(
    (u, i, all): u is string => Boolean(u) && all.indexOf(u) === i
  );
  const drawing = url(a.plan_pdf_image);
  const garages = number(a.garages);
  const beds = number(a.bedrooms);
  return {
    planKey: normKey(name),
    name,
    price: tile?.price ?? null,
    priceDisplay: tile ? "$" + tile.price.toLocaleString("en-US") : null,
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
  };
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

export async function extractArHomes(params: { url?: string }): Promise<NormalizedPlan[]> {
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
  const prices = tilePrices(community);
  const byId = new Map(plans.map((p) => [p.id, p]));
  const normalized = ids
    .map((id) => byId.get(id))
    .filter((p): p is ArPlan => Boolean(p))
    .map((p) => normalizeArPlan(p, prices))
    .filter((p): p is NormalizedPlan => p !== null);
  // Each plan's page for the tour its record does not name, a few at a
  // time. A page that cannot be read costs the tour, never the plan, and
  // a run that finds none does not take a working tour away (diff.ts).
  const out: NormalizedPlan[] = [];
  for (let i = 0; i < normalized.length; i += 4) {
    out.push(
      ...(await Promise.all(
        normalized.slice(i, i + 4).map(async (plan) => {
          if (plan.virtualTourUrl || !plan.sourceUrl) return plan;
          const tour = await planTour(plan.sourceUrl, getText).catch(() => null);
          return tour ? { ...plan, virtualTourUrl: tour } : plan;
        })
      ))
    );
  }
  return out;
}
