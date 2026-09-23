// D.R. Horton extractor: the pages are Sitecore, drawn on the server, and
// regular enough to read without a model (Oakfield, 2026-09-23).
//
// A community page carries every home it has for sale as data — one
// object per home with its plan's name and code, its address, beds, baths,
// size, garages, price and status — and links each of its floor plans at
// ".../floor-plans/<code>". A plan's page carries its gallery in a
// PropertyGallery block, fifteen pictures each titled for its room
// ("Allex Exterior", "Kitchen", "Primary Bedroom"), its facts in a
// schema.org FloorPlan block, its price ("starting at $293,990"), the
// builder's description under "About this floor plan", and a Zillow 3D
// tour. A home's page carries its own gallery the same way.
//
// Read by Claude instead, Oakfield's two pages of seventeen and fifteen
// plans and forty-odd homes ran past seven minutes and brought nothing
// back. Read here, it is a fetch per page.

import { mergeRepeatedPlan, tourUrlIn } from "@/lib/floorplans/extractors/claude-extract";
import { classifyRoom, orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ORIGIN = "https://www.drhorton.com";

const money = (n: number | null | undefined) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;

const decode = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");

const words = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** A home for sale as the community page carries it. */
interface DrhHome {
  PlanName?: string;
  PlanCode?: string;
  Address?: string;
  SquareFootage?: number;
  NumberOfBedrooms?: number;
  NumberOfBathrooms?: number;
  NumberOfGarages?: number;
  Price?: number;
  OriginalPrice?: number;
  Status?: string;
  Url?: string;
  Thumbnail?: string;
  JdeIsSold?: boolean;
  JdeIsClosed?: boolean;
  LotNumber?: string;
  MonthlyPricing?: { JdeIsUnderContract?: boolean; IsPending?: boolean } | null;
}

/**
 * Every JSON object the page carries that opens with the given key, read
 * whole by matching its braces (the objects nest, and sit inside a script
 * whose shape is not otherwise needed).
 */
function objectsOpening(html: string, key: string): unknown[] {
  const out: unknown[] = [];
  const opener = `{"${key}":`;
  let from = 0;
  for (;;) {
    const start = html.indexOf(opener, from);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break;
    try {
      out.push(JSON.parse(html.slice(start, end + 1)));
    } catch {
      // not an object after all
    }
    from = end + 1;
  }
  return out;
}

/** The homes for sale a community page lists: available ones, not those under contract or sold. Exported for tests. */
export function homesOnPage(html: string): DrhHome[] {
  const seen = new Set<string>();
  return objectsOpening(html, "ItemId")
    .filter((o): o is DrhHome => {
      const h = o as DrhHome;
      return typeof h.Address === "string" && Boolean(h.Address.trim()) && typeof h.PlanName === "string";
    })
    .filter((h) => {
      const gone = h.JdeIsSold || h.JdeIsClosed || h.MonthlyPricing?.JdeIsUnderContract || h.MonthlyPricing?.IsPending;
      const available = !h.Status || /^available$/i.test(h.Status.trim());
      const key = normKey(h.Address ?? "");
      if (gone || !available || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The floor plan pages a community page links, beneath its own address. Exported for tests. */
export function planLinks(html: string, pageUrl: string): string[] {
  const community = new URL(pageUrl).pathname.replace(/\/+$/, "");
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"']*\/floor-plans\/[a-z0-9-]+)\/?["']/gi)) {
    try {
      const url = new URL(decode(m[1]), ORIGIN);
      if (url.pathname.toLowerCase().startsWith(`${community.toLowerCase()}/floor-plans/`)) out.add(url.origin + url.pathname);
    } catch {
      // not a link
    }
  }
  return [...out];
}

/** A picture's own address, without the size the page asked for: ".../allex_front.jpg?as=1&w=494&…" is ".../allex_front.jpg". */
const original = (src: string) => {
  const url = new URL(decode(src), ORIGIN);
  return url.origin + url.pathname;
};

/**
 * What a plan's or a home's own page carries: the gallery in the page's
 * order with each picture's title, the schema.org facts, the price, the
 * description and the tour. Pure; exported for tests.
 */
export function readDrhPage(html: string): {
  name: string | null;
  price: number | null;
  beds: string;
  baths: string;
  sqft: number | null;
  garages: string | null;
  description: string | null;
  tour: string | null;
  gallery: { src: string; caption: string }[];
  drawings: string[];
  homeType: string | null;
} {
  const start = html.indexOf('class="PropertyGallery');
  const stop = start >= 0 ? html.indexOf('class="mobile-carousel"', start) : -1;
  const block = start >= 0 ? html.slice(start, stop > start ? stop : start + 60_000) : "";
  const gallery: { src: string; caption: string }[] = [];
  const drawings: string[] = [];
  const seen = new Set<string>();
  for (const m of block.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\sdata-lazy="([^"]+)"/i)?.[1] ?? tag.match(/\ssrc="([^"]+)"/i)?.[1];
    if (!src || src.startsWith("data:")) continue;
    let url: string;
    try {
      url = original(src);
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const caption = decode(tag.match(/\salt="([^"]*)"/i)?.[1] ?? "").trim();
    if (/\bfloor ?plan\b/i.test(caption)) drawings.push(url);
    else gallery.push({ src: url, caption });
  }

  // schema.org's FloorPlan block: the plan's own facts.
  let facts: { numberOfBedrooms?: number; numberOfBathroomsTotal?: number; floorSize?: number } = {};
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      if (data?.["@type"] === "FloorPlan") facts = data;
    } catch {
      // another block
    }
  }
  const text = words(html.slice(html.search(/<h1\b/i) >= 0 ? html.search(/<h1\b/i) : 0));
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const price = text.match(/starting at \$\s?([\d,]+)/i)?.[1] ?? text.match(/^[^$]{0,200}\$\s?([\d,]{6,})/)?.[1];
  const garages = text.match(/(\d+)\s*Garage/i)?.[1];
  // The builder's words sit in their own block under "About this floor plan".
  const about =
    html.match(/class="about-this-plan"[^>]*>\s*<h\d[^>]*>[^<]*<\/h\d>([\s\S]*?)<\/div>/i)?.[1] ??
    html.match(/About this (?:floor plan|home)\s*<\/h\d>([\s\S]*?)<(?:h\d|\/section|\/div)\b/i)?.[1];
  const description = about ? words(about) || null : null;
  const specBaths = text.match(/(\d+(?:\.\d)?)\s*Bath/i)?.[1];
  const specBeds = text.match(/(\d+)\s*Bed/i)?.[1];
  const specSqft = text.match(/([\d,]{3,6})\s*Sq\.?\s*Ft/i)?.[1];
  return {
    name: h1 ? words(h1) : null,
    price: price ? Number(price.replace(/,/g, "")) || null : null,
    beds: facts.numberOfBedrooms != null ? String(facts.numberOfBedrooms) : specBeds ?? "",
    baths: facts.numberOfBathroomsTotal != null ? String(facts.numberOfBathroomsTotal) : specBaths ?? "",
    sqft: facts.floorSize ?? (specSqft ? Number(specSqft.replace(/,/g, "")) : null),
    garages: garages ? `${garages} car` : null,
    description,
    tour: tourUrlIn(html),
    gallery,
    drawings,
    // A townhome community says so; anything else is left to the builder's default.
    homeType: /\btown ?homes?\b/i.test(`${h1 ?? ""} ${description ?? ""}`) ? standardHomeType("Townhome") : null,
  };
}

/** A plan's name out of its page's heading: "Oakfield Lakes Allex Floor Plan" is Allex. Exported for tests. */
export function planNameFrom(heading: string, communityWords: string[]): string {
  let name = heading.replace(/\s+floor\s*plan\s*$/i, "").trim();
  for (const community of communityWords.filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (name.toLowerCase().startsWith(community.toLowerCase() + " ")) {
      name = name.slice(community.length).trim();
      break;
    }
  }
  return name;
}

/** A page's gallery in the site's order: the front of the house leads, the rooms by what the page titles them, the other views last. */
function galleryOf(gallery: { src: string; caption: string }[]) {
  const items: GalleryInput[] = gallery.map((g, i) => {
    const room = classifyRoom(g.caption);
    if (i === 0) return { src: g.src, kind: "primary", caption: g.caption || null };
    if (room === "exterior") return { src: g.src, kind: "exterior", caption: g.caption || null };
    return { src: g.src, caption: g.caption || null, room: room ?? undefined };
  });
  return orderGallery(items);
}

async function fetchHtml(url: string): Promise<{ html: string; url: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return { html: await res.text(), url: res.url || url };
}

/** Runs `fn` over the items a few at a time, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function extractDrHorton(params: {
  url?: string;
  listUrls?: string[];
  communityName?: string;
  runDeadline?: number;
}): Promise<NormalizedPlan[]> {
  const pages = (params.listUrls?.length ? params.listUrls : params.url ? [params.url] : []).map((u) => u.trim()).filter(Boolean);
  if (!pages.length) throw new Error("the D.R. Horton extractor needs the community's page (extractor_params.url)");
  const deadline = params.runDeadline ?? Infinity;

  const planUrls = new Set<string>();
  const homes = new Map<string, DrhHome>();
  const communityWords = [params.communityName ?? ""];
  for (const page of pages) {
    const { html, url } = await fetchHtml(page);
    for (const link of planLinks(html, url)) planUrls.add(link);
    for (const home of homesOnPage(html)) homes.set(normKey(home.Address ?? ""), home);
    const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    if (heading) communityWords.push(words(heading).replace(/^homes for sale at\s+/i, ""));
  }
  if (!planUrls.size && !homes.size) throw new Error(`no floor plans or homes on ${pages.join(", ")}`);

  const plans = await mapLimit([...planUrls], 8, async (planUrl): Promise<NormalizedPlan | null> => {
    if (Date.now() + 30_000 > deadline) return null;
    try {
      const { html } = await fetchHtml(planUrl);
      const page = readDrhPage(html);
      const name = page.name ? planNameFrom(page.name, communityWords) : null;
      if (!name) return null;
      const ordered = galleryOf(page.gallery);
      return {
        planKey: normKey(name),
        name,
        price: page.price,
        priceDisplay: money(page.price),
        beds: page.beds,
        baths: page.baths,
        sqft: page.sqft,
        garages: page.garages,
        homeType: page.homeType,
        quickMoveIn: false,
        comingSoon: false,
        sourceUrl: planUrl,
        description: page.description,
        virtualTourUrl: page.tour,
        galleryImages: ordered.urls,
        galleryMeta: ordered.meta,
        blueprintImages: page.drawings,
        raw: { planCode: planUrl.split("/").pop()?.toUpperCase() ?? null },
      };
    } catch {
      return null;
    }
  });

  const homePlans = await mapLimit([...homes.values()], 8, async (home): Promise<NormalizedPlan> => {
    const address = (home.Address ?? "").trim();
    const sourceUrl = home.Url ? new URL(home.Url, ORIGIN).href : null;
    const base: NormalizedPlan = {
      planKey: normKey(address),
      name: address,
      price: home.Price && home.Price > 0 ? home.Price : null,
      priceDisplay: money(home.Price),
      beds: home.NumberOfBedrooms != null ? String(home.NumberOfBedrooms) : "",
      baths: home.NumberOfBathrooms != null ? String(home.NumberOfBathrooms) : "",
      sqft: home.SquareFootage ?? null,
      garages: home.NumberOfGarages ? `${home.NumberOfGarages} car` : null,
      homeType: null,
      quickMoveIn: true,
      comingSoon: false,
      sourceUrl,
      relatedPlanName: home.PlanName?.trim() || null,
      galleryImages: home.Thumbnail ? [original(home.Thumbnail)] : [],
      blueprintImages: [],
      raw: { relatedPlan: home.PlanName?.trim() || null, planCode: home.PlanCode ?? null, lot: home.LotNumber?.trim() ?? null },
    };
    if (!sourceUrl || Date.now() + 30_000 > deadline) return { ...base, pageUnread: Boolean(sourceUrl) };
    try {
      const page = readDrhPage((await fetchHtml(sourceUrl)).html);
      if (!page.gallery.length) return { ...base, description: page.description, virtualTourUrl: page.tour };
      const ordered = galleryOf(page.gallery);
      return {
        ...base,
        description: page.description,
        virtualTourUrl: page.tour,
        galleryImages: ordered.urls,
        galleryMeta: ordered.meta,
        blueprintImages: page.drawings,
      };
    } catch {
      return { ...base, pageUnread: true };
    }
  });

  // One plan once: a plan both of a community's pages list is one plan at
  // the lower price (mergeRepeatedPlan), and a home once.
  const byKey = new Map<string, NormalizedPlan>();
  for (const plan of [...plans.filter((p): p is NormalizedPlan => Boolean(p)), ...homePlans]) {
    const twin = byKey.get(plan.planKey);
    if (!twin) byKey.set(plan.planKey, plan);
    else if (!plan.quickMoveIn && !twin.quickMoveIn) byKey.set(plan.planKey, mergeRepeatedPlan(twin, plan));
  }
  return [...byKey.values()];
}
