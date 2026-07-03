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
    homeType: attrs.type ? attrs.type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null,
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
  return [...byKey.values()];
}
