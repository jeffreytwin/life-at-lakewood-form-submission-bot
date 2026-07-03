// Mattamy extractor (json_api): the Sitecore JSS layout service exposes a
// /search-data route (public sc_apikey from the site bundle) whose Search
// component fields carry planCards and qmiCards for entire markets. Plan
// cards: title = plan name; QMI cards: title = street address with the
// base plan in planName. Cards carry a community page path in `url`, so a
// connection is scoped by its community page URL prefix. Structure
// captured in pipeline/slice/discovery/round7/mattamy-search.*.

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SC_APIKEY = "{8C3D041E-BB12-4CC6-908A-4CF43E542E5B}";

interface MattamyCard {
  id?: string;
  type?: string;
  title?: string;
  planName?: string | null;
  community?: string | null;
  url?: string;
  image?: { src?: string | null } | null;
  price?: { price?: string | null; noPriceText?: string | null } | null;
  attributes?: { icon?: string | null; label?: string | null }[] | null;
  isComingSoon?: boolean;
}

const parseMoney = (s: string | null | undefined): number | null => {
  const m = (s ?? "").replace(/[^0-9]/g, "");
  return m ? parseInt(m, 10) : null;
};

const attrNumber = (card: MattamyCard, icon: string): number | null => {
  const label = card.attributes?.find((a) => a?.icon === icon)?.label ?? "";
  const m = String(label).replace(/,/g, "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

export function normalizeMattamyCard(
  card: MattamyCard,
  { quickMoveIn }: { quickMoveIn: boolean }
): NormalizedPlan | null {
  const name = (card.title ?? "").trim();
  if (!name) return null;
  const full = attrNumber(card, "bath");
  const half = attrNumber(card, "half-baths");
  const price = parseMoney(card.price?.price);
  const image = card.image?.src ?? null;
  const sqft = attrNumber(card, "ruler");
  const garages = attrNumber(card, "car");
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: price ? "$" + price.toLocaleString("en-US") : null,
    beds: attrNumber(card, "bed") != null ? String(attrNumber(card, "bed")) : "",
    baths: full != null ? ((half ?? 0) > 0 ? `${full}.5` : String(full)) : "",
    sqft,
    garages: garages != null ? `${garages} car` : null,
    homeType: null,
    quickMoveIn,
    comingSoon: !price && /coming soon/i.test(card.price?.noPriceText ?? ""),
    sourceUrl: card.url ? `https://mattamyhomes.com${card.url}` : null,
    galleryImages: image ? [image] : [],
    blueprintImages: [],
    raw: {
      mattamyId: card.id,
      relatedPlan: quickMoveIn ? card.planName ?? null : null,
      community: card.community ?? null,
    },
  };
}

/** Pull plan/QMI cards for one community out of the search-data payload. */
export function plansFromSearchData(
  data: unknown,
  communityPath: string
): NormalizedPlan[] {
  const fields = (data as {
    sitecore?: {
      route?: { placeholders?: { "jss-main"?: { fields?: Record<string, { value?: MattamyCard[] }> }[] } };
    };
  })?.sitecore?.route?.placeholders?.["jss-main"]?.find((c) => c?.fields)?.fields;
  if (!fields) throw new Error("search-data payload missing Search component fields");
  const prefix = communityPath.replace(/\/$/, "").toLowerCase();
  const out: NormalizedPlan[] = [];
  for (const [key, quickMoveIn] of [
    ["planCards", false],
    ["qmiCards", true],
  ] as const) {
    for (const card of fields[key]?.value ?? []) {
      if (!card || typeof card !== "object") continue;
      const url = (card.url ?? "").toLowerCase();
      if (!url.startsWith(prefix + "/") && url !== prefix) continue;
      const plan = normalizeMattamyCard(card, { quickMoveIn });
      if (plan) out.push(plan);
    }
  }
  return out;
}

export async function extractMattamy(params: {
  url?: string;
  market?: string;
}): Promise<NormalizedPlan[]> {
  if (!params?.url) throw new Error("mattamy extractor requires extractor_params.url (community page)");
  const communityPath = new URL(params.url).pathname;
  const market = params.market ?? "Sarasota-Bradenton";
  const apiUrl =
    `https://mattamyhomes.com/sitecore/api/layout/render/jss?item=/search-data` +
    `&sc_apikey=${SC_APIKEY}&market=${encodeURIComponent(market)}&IsState=0`;
  const res = await fetch(apiUrl, {
    headers: {
      "user-agent": UA,
      accept: "application/json",
      referer: "https://mattamyhomes.com/search",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`mattamy search-data: ${res.status}`);
  const data = await res.json();
  const plans = plansFromSearchData(data, communityPath);
  const byKey = new Map<string, NormalizedPlan>();
  for (const p of plans) if (!byKey.has(p.planKey)) byKey.set(p.planKey, p);
  return [...byKey.values()];
}
