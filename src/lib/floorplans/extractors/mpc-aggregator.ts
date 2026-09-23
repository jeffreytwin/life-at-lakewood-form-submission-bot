// Master-planned-community aggregator extractor (json_api-ish: parses
// server-rendered HTML). The MPC marketing sites (wellenpark.com, and the
// same platform on lakewoodranch.com) list every builder's homes on one
// home-search page, each as an <article data-comp="property" …> card with
// data attributes for builder / neighborhood / price / beds / baths / sqft /
// availability, plus <h3> (address for move-in-ready, plan name for
// to-be-built), <h4> (price), an image, and a detail link.
//
// This is the alternate source for builders that block their own sites
// (M/I Homes, ICI Homes, Neal Signature) — the MPC site is a different
// origin, so those blocks don't apply. One extractor, parameterized per
// connection by which aggregator + builder slug + neighborhood slug.
//
// Structure captured in pipeline/slice/discovery/mpc3/wellenpark-card-raw.html.

import { standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SOURCES: Record<string, { origin: string; listPath: string }> = {
  wellenpark: { origin: "https://www.wellenpark.com", listPath: "/available-homes/" },
  lakewoodranch: { origin: "https://www.lakewoodranch.com", listPath: "/home-finder/" },
};

// Builder display name → the site's data-builder-name slug. Extend as needed;
// extractor_params.builderSlug always overrides.
const BUILDER_SLUGS: Record<string, string> = {
  "M/I Homes": "mi-homes",
  "ICI Homes": "ici-homes",
  "Neal Signature Homes": "neal-signature-homes",
  "Neal Communities": "neal-communities",
  "Mattamy Homes": "mattamy-homes",
  "Taylor Morrison": "taylor-morrison",
  "Toll Brothers": "toll-brothers",
  Lennar: "lennar",
  "Lee Wetherington": "lee-wetherington-homes",
  "Pulte Homes": "pulte-homes",
  "Homes by WestBay": "homes-by-westbay",
  "Homes by Towne": "homes-by-towne",
  "David Weekley Homes": "david-weekley-homes",
  "DR Horton": "dr-horton",
  "John Cannon Homes": "john-cannon-homes",
};

interface Card {
  attrs: Record<string, string>;
  h3: string;
  h4: string;
  detail: string | null;
  img: string | null;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Parse every <article data-comp="property"> card out of the list HTML. */
export function parseCards(html: string): Card[] {
  const cards: Card[] = [];
  for (const m of html.matchAll(/<article\b([^>]*data-comp=["']property["'][^>]*)>([\s\S]*?)<\/article>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/data-([a-z0-9_-]+)=["']([^"']*)["']/gi)) attrs[a[1].toLowerCase()] = a[2];
    const inner = m[2];
    cards.push({
      attrs,
      h3: stripTags(inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ""),
      h4: stripTags(inner.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? ""),
      detail:
        inner.match(/href=["']([^"']+\/home\/[^"']+)["']/i)?.[1] ??
        inner.match(/href=["']([^"']*detail[^"']*)["']/i)?.[1] ??
        null,
      img: inner.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null,
    });
  }
  return cards;
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * The site's home type for what the aggregator calls a home. Wellen Park
 * files M/I's Palm, Sabal, Foxtail and Bismark as "Multi-Family", and the
 * site carries every one of them as a townhome (2026-09-23).
 */
export function mpcHomeType(label: string | null | undefined): string | null {
  const text = (label ?? "").replace(/-/g, " ").trim();
  if (!text) return null;
  return standardHomeType(text) ?? (/\bmulti\s*family\b/i.test(text) ? "Townhome" : text.replace(/\b\w/g, (c) => c.toUpperCase()));
}

export function normalizeCard(card: Card): NormalizedPlan | null {
  const { attrs } = card;
  const availability = (attrs.availability ?? "").trim();
  const quickMoveIn = availability === "move-in-ready" || availability === "quick-move-in";
  const name = card.h3.trim();
  if (!name) return null;
  // Price: h4 is exact ("$684,690") or ranged ("FROM $429,990"); the data
  // attribute is in thousands and lossy, so prefer h4.
  const price = num(card.h4);
  const beds = num(attrs.beds);
  const baths = num(attrs.baths);
  const sqft = num(attrs.sqft);
  const garage = num(attrs.garage);
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: price ? "$" + price.toLocaleString("en-US") : null,
    beds: beds != null ? String(beds) : "",
    baths: baths != null ? String(baths) : "",
    sqft: sqft != null ? sqft : null,
    garages: garage ? `${garage} car` : null,
    homeType: mpcHomeType(attrs.type),
    quickMoveIn,
    comingSoon: /coming soon|from\s+price/i.test(card.h4),
    sourceUrl: card.detail,
    galleryImages: card.img ? [card.img] : [],
    blueprintImages: [],
    raw: {
      mpcHomeId: attrs.home_id ?? null,
      neighborhood: attrs.neighborhood ?? null,
      builderSlug: attrs["builder-name"] ?? null,
      stories: attrs.stories ?? null,
      is55: attrs.is55 === "true",
      // For QMIs the plan name isn't in the card; the address is the identity.
      relatedPlan: quickMoveIn ? null : name,
    },
  };
}

/**
 * What a home's own page on the aggregator adds to its card: the whole
 * gallery, the floor plan drawing and the tour. The card carries one
 * picture; the page carries seventeen of them under the home's heading, a
 * drawing (an .svg from the same folder), and an "Interactive Plan" link
 * to a Matterport (wellenpark.com/home/3911998/detail, 2026-09-23). Only
 * the part of the page about this home is read — from its heading to the
 * "More Homes in …" row of other homes — so a neighbour's picture is never
 * taken. Pure; exported for tests.
 */
export function readDetailPage(html: string): {
  photos: string[];
  drawings: string[];
  tour: string | null;
  homeType: string | null;
  description: string | null;
} {
  // The type sits over the name ("<p>Multi-Family</p> … <h1>Palm</h1>"),
  // and the description under a bold "Description".
  const header = html.match(/<p>\s*([^<]{3,40}?)\s*<\/p>(?:(?!<\/?p\b)[\s\S]){0,400}?<h1\b/i)?.[1] ?? null;
  const described = html.match(/<strong>\s*Description\s*<\/strong>\s*(?:<br\s*\/?>)?([\s\S]*?)<\/p>/i)?.[1];
  const description = described ? stripTags(described).replace(/&#0?39;|&rsquo;/g, "'") || null : null;
  const start = html.search(/<h1\b/i);
  const rest = start >= 0 ? html.slice(start) : html;
  const end = rest.search(/>\s*More Homes in\b|>\s*GETTING social\b/i);
  const own = end > 0 ? rest.slice(0, end) : rest;
  const pictures = [
    ...new Set(
      [...own.matchAll(/https?:\/\/[^"'\s()<>]+?\/Images\/Homes\/[^"'\s()<>]+?\.(?:jpe?g|png|webp|svg)/gi)].map((m) => m[0])
    ),
  ];
  const tour = own.match(/https?:\/\/my\.matterport\.com\/show\/\?m=[A-Za-z0-9]+/i)?.[0] ?? null;
  return {
    photos: pictures.filter((u) => !/\.svg$/i.test(u)),
    drawings: pictures.filter((u) => /\.svg$/i.test(u)),
    tour,
    homeType: mpcHomeType(header),
    description,
  };
}

/** The builder's folder a listing picture sits in: ".../Images/Homes/NealC9425/82211950.jpg" is "nealc9425". Exported for tests. */
export function folderOf(url: string): string | null {
  return url.match(/\/Images\/Homes\/([^/]+)\//i)?.[1]?.toLowerCase() ?? null;
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

/** The home with what its own page adds; a page that will not load leaves it as its card had it. */
async function withDetailPage(plan: NormalizedPlan, origin: string): Promise<NormalizedPlan> {
  if (!plan.sourceUrl) return plan;
  const url = new URL(plan.sourceUrl, origin).href;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const page = readDetailPage(await res.text());
    // Only the builder's own pictures: a to-be-built page with no gallery
    // of its own shows other builders' homes instead, and Ravenna came back
    // with 258 of Mattamy's, Toll's and Lennar's (Everly, 2026-09-23). The
    // listing files each builder's under its own folder.
    const folder = folderOf(plan.galleryImages[0] ?? "") ?? folderOf(page.photos[0] ?? "");
    const ours = (u: string) => !folder || folderOf(u) === folder;
    const photos = [...plan.galleryImages, ...page.photos.filter(ours)].filter((u, i, all) => all.indexOf(u) === i);
    const drawings = page.drawings.filter(ours);
    return {
      ...plan,
      sourceUrl: url,
      galleryImages: photos,
      blueprintImages: drawings.length ? drawings : plan.blueprintImages,
      virtualTourUrl: plan.virtualTourUrl ?? page.tour,
      homeType: plan.homeType ?? page.homeType,
      description: plan.description ?? page.description,
    };
  } catch {
    return { ...plan, sourceUrl: url, pageUnread: true };
  }
}

function resolveBuilderSlug(builderName: string, override?: string): string | null {
  if (override) return override;
  if (BUILDER_SLUGS[builderName]) return BUILDER_SLUGS[builderName];
  const k = normKey(builderName);
  // Fall back to a best-effort slug (e.g. "Foo Homes" → "foo-homes").
  return k || null;
}

export async function extractMpcAggregator(params: {
  source?: string;
  builderName?: string;
  builderSlug?: string;
  communityName?: string;
  neighborhood?: string;
  url?: string;
}): Promise<NormalizedPlan[]> {
  const sourceKey = params.source ?? "wellenpark";
  const source = SOURCES[sourceKey];
  if (!source) throw new Error(`unknown MPC source "${sourceKey}" (expected wellenpark|lakewoodranch)`);
  const builderSlug = resolveBuilderSlug(params.builderName ?? "", params.builderSlug);
  if (!builderSlug) {
    throw new Error("mpc-aggregator extractor needs a builder to filter on (builderName or extractor_params.builderSlug)");
  }
  // Neighborhood scope: explicit slug, else derived from the community's
  // short name (e.g. "Waterside - Wild Blue" → "wild-blue").
  const communityShort = (params.communityName ?? "").split(/\s*-\s*/).pop() ?? "";
  const neighborhood = (params.neighborhood ?? normKey(communityShort)) || null;

  const listUrl = params.url ?? source.origin + source.listPath;
  const res = await fetch(listUrl, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`fetch ${listUrl}: ${res.status}`);
  const html = await res.text();
  const cards = parseCards(html);
  if (!cards.length) {
    throw new Error(
      `no property cards at ${listUrl} — the site may render homes client-side (needs a browser engine)`
    );
  }

  const byKey = new Map<string, NormalizedPlan>();
  for (const card of cards) {
    if ((card.attrs["builder-name"] ?? "") !== builderSlug) continue;
    if (neighborhood && (card.attrs.neighborhood ?? "") !== neighborhood) continue;
    const plan = normalizeCard(card);
    if (plan && !byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
  }
  // Each home's own page, for its gallery, its drawing and its tour.
  return mapLimit([...byKey.values()], 4, (plan) => withDetailPage(plan, new URL(listUrl).origin));
}
