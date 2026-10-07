// M/I Homes extractor, for a community read off M/I's own pages: Seaire and
// Creeks Edge at Twin Rivers in Parrish, which no master-planned
// community's listings carry, and Palmera, read from M/I itself rather than
// Wellen Park's listings since those served a stale copy of its homes one
// night (Jeff, 2026-10-07). A community's page arrives with its overview and no
// plans, so a fetch gave Claude nothing to read (Jeff, 2026-10-06). Its
// scripts draw the plans, the homes for sale and the model from a feed,
// asked by the community's id, which the page keeps on its list
// (`<div … data-guid="25849bbc-…" data-name="Seaire">`):
//
//   GET /sitecore/api/ssc/MIHomes-Project-Website-Api-Controllers/PlansQmi/?id={guid}&type=plans&items=0
//
// It answers a page of cards at a time ({ TotalItems, Html }): five, then
// three for every "load more", `items` being how many were shown already,
// so a browser that read only what the page draws saw five of Seaire's
// twelve plans. Each card carries its facts in schema.org data — the name,
// the price, the beds, the full and half baths, the size, the picture, the
// page — and the garage, the plan a home is built on and its ready date
// beside them. Each plan's and home's own page is then read for its
// gallery, drawings and description (claude-extract.ts).
//
// The card's picture is the house — a home's front exterior, or its plan's
// elevation while it is being built — and it leads (withCardLead). A home's
// page shows M/I's "Lifestyle" pictures ahead of it, the same four people
// on a sofa beside every home at Seaire, and the queue led sixteen homes
// with them (Jeff, 2026-10-06); they are M/I's, not the home's, and are left out.

import { fetchPage, type PageReader, readPlanPages } from "@/lib/floorplans/extractors/claude-extract";
import { orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { bathsOf, standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FEED = "/sitecore/api/ssc/MIHomes-Project-Website-Api-Controllers/PlansQmi/";

/** More pages of one feed than any community has; a feed that keeps answering is not followed forever. */
const MAX_PAGES = 30;

/** Whether a page is one of M/I's own. */
export const isMiHomesPage = (url: unknown): boolean => typeof url === "string" && /^https?:\/\/(?:www\.)?mihomes\.com\//i.test(url.trim());

/** The community's id, as its page keeps it for the feed. Exported for tests. */
export function communityGuidIn(html: string): string | null {
  const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  return (
    html.match(new RegExp(String.raw`\bdata-guid=["'](${guid.source})["']`, "i"))?.[1] ??
    html.match(new RegExp(String.raw`PlansQmi[\s\S]{0,400}?%7B(${guid.source})%7D`, "i"))?.[1] ??
    html.match(new RegExp(String.raw`\bid\s*=\s*'%7B(${guid.source})%7D'`, "i"))?.[1] ??
    null
  )?.toLowerCase() ?? null;
}

interface SchemaRange {
  value?: number | string | null;
  minValue?: number | string | null;
  maxValue?: number | string | null;
}

interface MiCardData {
  "@type"?: string;
  additionalType?: string;
  name?: string;
  sku?: string;
  image?: string[] | string;
  url?: string;
  offers?: { price?: string | number | null; url?: string } | null;
  numberOfBedrooms?: SchemaRange | null;
  numberOfFullBathrooms?: SchemaRange | null;
  numberOfPartialBathrooms?: SchemaRange | null;
  floorSize?: SchemaRange | null;
}

export interface MiCard {
  kind: "plans" | "inventory" | "models";
  data: MiCardData;
  /** The card's own facts beside the data: "Garage" → "3", "Plan" → "Coral Xl - B". */
  meta: Record<string, string>;
  flags: string[];
}

const clean = (s: unknown) =>
  (typeof s === "string" ? s : s == null ? "" : String(s))
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** The low and high ends of a schema.org count, a single value being both. */
const ends = (r: SchemaRange | null | undefined): [number | null, number | null] => {
  if (!r) return [null, null];
  const one = num(r.value);
  if (one != null) return [one, one];
  const lo = num(r.minValue);
  const hi = num(r.maxValue);
  return [lo ?? hi, hi ?? lo];
};

const span = (lo: number | null, hi: number | null): string =>
  lo == null ? "" : hi != null && hi > lo ? `${lo}-${hi}` : String(lo);

/** The bathrooms a schema.org entry gives as full and half counts: "3.5", or "2.5-3.5" for a range. */
function bathsFrom(full: SchemaRange | null | undefined, partial: SchemaRange | null | undefined): string {
  const [fullLo, fullHi] = ends(full);
  const [halfLo, halfHi] = ends(partial);
  const lo = bathsOf(fullLo, halfLo);
  const hi = bathsOf(fullHi, halfHi);
  return lo == null ? "" : hi && hi !== lo ? `${lo}-${hi}` : lo;
}

/**
 * The bathrooms a plan's or home's own page gives itself, from the
 * schema.org entry whose url is the page; the page's other entries are its
 * homes for sale. A plan's card in M/I's feed counts the half baths as full
 * ones: Palmera's Bismark, 3 full and 1 half on its page, came as 4 full and
 * none, and Foxtail's 2 and 1 as 3 (Jeff, 2026-10-07). Null where no entry is
 * the page's. Pure; exported for tests.
 */
export function pageBaths(html: string, pageUrl: string): string | null {
  const own = pageUrl.replace(/\/+$/, "").toLowerCase();
  for (const m of html.matchAll(/<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const entry of (Array.isArray(data) ? data : [data]) as (MiCardData | null)[]) {
      if (!entry || clean(entry.url).replace(/\/+$/, "").toLowerCase() !== own) continue;
      const baths = bathsFrom(entry.numberOfFullBathrooms, entry.numberOfPartialBathrooms);
      if (baths) return baths;
    }
  }
  return null;
}

/** The cards of one answer of the feed, with what each says. Exported for tests. */
export function cardsIn(html: string): MiCard[] {
  const out: MiCard[] = [];
  const starts = [...html.matchAll(/<div\s+class=["']home-card home-card--(plans|inventory|models)\b[^"']*["']/gi)];
  starts.forEach((m, i) => {
    const body = html.slice(m.index!, starts[i + 1]?.index ?? html.length);
    const json = body.match(/<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/i)?.[1];
    if (!json) return;
    let data: MiCardData;
    try {
      data = JSON.parse(json) as MiCardData;
    } catch {
      return;
    }
    const meta: Record<string, string> = {};
    for (const item of body.matchAll(/<p\s+class=["']home-card-meta-item[^"']*["']\s*>([\s\S]*?)<span\s+class=["']home-card-meta-value["']\s*>([\s\S]*?)<\/span>/gi)) {
      const label = clean(item[1]);
      if (label) meta[label] = clean(item[2]);
    }
    const flags = [...body.matchAll(/<li\s+class=["']home-card__flag[^"']*["']\s*>([\s\S]*?)<\/li>/gi)].map((f) => clean(f[1])).filter(Boolean);
    out.push({ kind: m[1].toLowerCase() as MiCard["kind"], data, meta, flags });
  });
  return out;
}

/** "SingleFamilyResidence" as words the standard types know. */
function homeTypeOf(additionalType: string | undefined): string {
  const words = (additionalType ?? "").split("/").pop()!.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (/single family/i.test(words)) return "Single Family Home";
  return standardHomeType(words) ?? "Single Family Home";
}

/** The page a card links, absolute. */
const pageOf = (card: MiCard, origin: string): string | null => {
  const link = clean(card.data.url) || clean(card.data.offers?.url);
  if (!link) return null;
  try {
    return new URL(link, origin).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
};

/**
 * A plan or a home for sale as its card files it; null for the model, which
 * M/I shows but does not sell, and for a card without a name. Exported for
 * tests.
 */
export function fromCard(card: MiCard, origin: string, plansByPage: Map<string, string> = new Map()): NormalizedPlan | null {
  if (card.kind === "models") return null;
  const d = card.data;
  const home = card.kind === "inventory";
  const name = clean(d.name).replace(/\s+Plan$/i, "");
  if (!name) return null;
  const sourceUrl = pageOf(card, origin);
  const price = num(d.offers?.price);
  const [bedLo, bedHi] = ends(d.numberOfBedrooms);
  const [sqft] = ends(d.floorSize);
  const garage = (card.meta.Garage ?? "").replace(/\s+/g, "");
  const images = (Array.isArray(d.image) ? d.image : d.image ? [d.image] : []).map(clean).filter((u) => /^https?:\/\//i.test(u));
  // A home's page sits under its plan's (".../seaire/coral-xl-plan/8928-deep-horizon-loop"),
  // which names the plan the way the plan's own card does; the card's
  // "Plan" ("Coral Xl - B") adds the elevation and spells it its own way.
  const planPage = home && sourceUrl ? sourceUrl.replace(/\/[^/]+$/, "") : null;
  const relatedPlanName = home
    ? (planPage ? plansByPage.get(planPage) : undefined) ??
      (planPage?.split("/").pop()?.replace(/-plan$/i, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || null) ??
      (card.meta.Plan?.replace(/\s+-\s+[A-Z0-9]{1,2}$/, "") || null)
    : undefined;
  const readyDate = card.meta["Estimated Move in Date"] || null;
  return {
    planKey: normKey(name),
    name,
    price: price && price > 0 ? price : null,
    priceDisplay: price && price > 0 ? "$" + Math.round(price).toLocaleString("en-US") : null,
    beds: span(bedLo, bedHi),
    baths: bathsFrom(d.numberOfFullBathrooms, d.numberOfPartialBathrooms),
    sqft: sqft && sqft > 0 ? sqft : null,
    garages: garage && /\d/.test(garage) ? `${garage} car` : null,
    homeType: homeTypeOf(d.additionalType),
    quickMoveIn: home,
    comingSoon: card.flags.some((f) => /coming soon/i.test(f)),
    sourceUrl,
    relatedPlanName,
    galleryImages: images.slice(0, 1),
    blueprintImages: [],
    raw: {
      planId: clean(d.sku) || null,
      relatedPlan: home ? relatedPlanName ?? null : null,
      readyDate: home ? readyDate : null,
      flags: card.flags.length ? card.flags : null,
    },
  };
}

/** Every card of one kind the feed holds for a community, page after page. */
async function feedCards(origin: string, guid: string, type: "plans" | "homes", referer: string): Promise<MiCard[]> {
  const seen = new Set<string>();
  const cards: MiCard[] = [];
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && cards.length < total; page++) {
    const url = `${origin}${FEED}?id=%7B${guid}%7D&type=${type}&items=${cards.length}`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", referer }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const body = (await res.json()) as { TotalItems?: number; Html?: string };
    total = typeof body.TotalItems === "number" ? body.TotalItems : 0;
    const fresh = cardsIn(body.Html ?? "").filter((c) => {
      const key = clean(c.data.url) || clean(c.data.sku) || clean(c.data.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) break;
    cards.push(...fresh);
  }
  return cards;
}

/** M/I's own marketing pictures, captioned for what they sell rather than what they show. */
const STOCK_CAPTION = /^\s*lifestyle\s*$/i;

/** The same picture whatever size or version the address asks for. */
const samePicture = (a: string, b: string) => {
  try {
    return new URL(a).pathname === new URL(b).pathname;
  } catch {
    return a === b;
  }
};

/**
 * The plan's gallery without M/I's Lifestyle pictures, led by the picture
 * its card shows: promoted where the page has it, put first where it does
 * not. A plan whose card had no picture keeps its page's order. Pure;
 * exported for tests.
 */
export function withCardLead(plan: NormalizedPlan, cardPicture: string | null | undefined): NormalizedPlan {
  const meta = plan.galleryMeta ?? {};
  const kept = plan.galleryImages.filter((src) => !STOCK_CAPTION.test(meta[src]?.caption ?? ""));
  const lead = cardPicture ? kept.find((src) => samePicture(src, cardPicture)) ?? cardPicture : null;
  if (!lead && kept.length === plan.galleryImages.length) return plan;
  const items: GalleryInput[] = [
    ...(lead ? [{ src: lead, kind: "primary" as const, caption: meta[lead]?.caption ?? null }] : []),
    ...kept
      .filter((src) => src !== lead)
      .map((src) => ({
        src,
        caption: meta[src]?.caption ?? null,
        // The page's own lead steps aside for the card's.
        kind: meta[src]?.kind === "primary" && lead ? ("exterior" as const) : meta[src]?.kind,
        ...(meta[src] && meta[src].room !== "primary" ? { room: meta[src].room ?? null } : {}),
      })),
  ];
  const ordered = orderGallery(items);
  return { ...plan, galleryImages: ordered.urls, galleryMeta: ordered.meta };
}

export async function extractMiHomes(params: { url?: string; runDeadline?: number }): Promise<NormalizedPlan[]> {
  const url = params.url?.trim();
  if (!url) throw new Error("the M/I Homes extractor needs the community's page (extractor_params.url)");
  const page = await fetchPage(url);
  const guid = communityGuidIn(page.html);
  if (!guid) throw new Error(`${url} keeps no community id for M/I's plan feed — not an M/I community page?`);
  const origin = new URL(page.url || url).origin;
  const [planCards, homeCards] = await Promise.all([
    feedCards(origin, guid, "plans", url),
    feedCards(origin, guid, "homes", url),
  ]);

  const byKey = new Map<string, NormalizedPlan>();
  for (const card of planCards) {
    const plan = fromCard(card, origin);
    if (plan && !byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
  }
  const plansByPage = new Map([...byKey.values()].filter((p) => p.sourceUrl).map((p) => [p.sourceUrl!, p.name] as const));
  for (const card of homeCards) {
    const home = fromCard(card, origin, plansByPage);
    if (home && !byKey.has(home.planKey)) byKey.set(home.planKey, home);
  }
  if (!byKey.size) throw new Error(`no plans or homes in M/I's feed for ${url} (community ${guid})`);
  const cardPictures = new Map([...byKey.values()].map((p) => [p.planKey, p.galleryImages[0] ?? null] as const));
  // Each page as it was read, for the bathrooms it gives itself (pageBaths).
  const pageOfPlan = new Map([...byKey.values()].map((p) => [p.planKey, p.sourceUrl] as const));
  const pages = new Map<string, string>();
  const readKept: PageReader = async (pageUrl, opts) => {
    const got = await fetchPage(pageUrl, opts);
    pages.set(pageUrl, got.html);
    return got;
  };
  const read = await readPlanPages([...byKey.values()], { read: readKept, atOnce: 6, runDeadline: params.runDeadline, listPages: new Set([url]) });
  return read.map((p) => {
    const pageUrl = pageOfPlan.get(p.planKey);
    const html = pageUrl ? pages.get(pageUrl) : undefined;
    const baths = html && pageUrl ? pageBaths(html, pageUrl) : null;
    return withCardLead(baths ? { ...p, baths } : p, cardPictures.get(p.planKey));
  });
}
