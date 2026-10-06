// Meritage extractor (json_api): the site itself hard-403s non-browser
// clients (TLS fingerprinting), but its data lives in Sitecore Discover —
// a third-party search API that plain fetch reaches fine (verified from a
// GitHub runner, round-6 replay). One POST per community (Salesforce
// community id) returns every listed home: floorplan name, address, price,
// beds/baths/sqft, photo gallery, and an interactive floor plan image.
// Salt Meadows sells inventory homes only ("QMI Only"), so each item maps
// to a quick move-in record named by street address (Lennar/Toll
// convention) with the base plan in raw.relatedPlan.
//
// The Discover authorization value and customer key below are the public
// client-side credentials embedded in meritagehomes.com's own JS bundle,
// captured in pipeline/slice/discovery/round6/.
//
// The floor plans are not in Discover: it holds homes only, so every plan
// at Oakfield had to be made from its homes in the Hub, though the
// community's page shows all fourteen under "See our thoughtfully designed
// floorplans" (Jeff, 2026-10-06). The site, which turned non-browser
// clients away in round 6, now answers a plain fetch, and each series
// page carries its plans in its Next.js data (communityPlans): name,
// beds, baths, size, photos, the drawing and the 3D tour. A plan has no
// price or garage there; it takes its homes' (quick-move-ins.ts prices a
// plan from its cheapest home; garages here). A page that cannot be read
// fails the run rather than leave its plans out, so they are never taken
// for gone.

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const DISCOVER_URL = "https://discover.sitecorecloud.io/discover/v2/173266879";
const DISCOVER_AUTH = "01-dec3a440-8879157175b163c5989f6b77622e5db6db864b6c";

interface MeritageCommunity {
  /** Salesforce community id, e.g. "a078a0000115gcVAAQ". */
  id: string;
  /** Public community page, used as the record source URL. */
  url?: string;
}

// Known connections whose Salesforce ids were captured during discovery.
// extractor_params.communities overrides; this keeps onboarding one-click
// for the communities we already audited.
const KNOWN_COMMUNITIES: Record<string, MeritageCommunity[]> = {
  "salt-meadows": [
    { id: "a078a0000115gcVAAQ", url: "https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series" },
    { id: "a078a0000115gcGAAQ", url: "https://www.meritagehomes.com/state/fl/tampa/salt-meadows-premier-series" },
  ],
};

interface PagePlan {
  name?: string;
  bedrooms?: string | number;
  bathrooms?: string | number;
  sqFootage?: string | number;
  images?: { src?: string; alt?: string }[];
  floorplanDiagram?: { src?: string; alt?: string } | null;
  virtualTourUrl?: string | null;
  hasVirtualTourLink?: boolean;
}

interface DiscoverHome {
  id?: string;
  sfid?: string;
  floorplan_name?: string;
  floorplan_description?: string;
  address?: string;
  city?: string;
  status?: string;
  price?: number;
  bedrooms?: number;
  full_bathrooms?: number;
  half_bathrooms?: number;
  garages?: number;
  sqft?: number;
  image_url?: string;
  image_urls?: string[];
  interactive_floorplan_image?: string;
  community_sheet_name?: string;
  community_sheet_status?: string;
  completion_estimated?: number;
  construction_stage?: string;
  movein_timeframe?: string;
}

const money = (n: number | null) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;

/** Query one community's homes from Sitecore Discover. */
async function discoverHomes(communityId: string): Promise<DiscoverHome[]> {
  const body = {
    context: {
      page: { uri: "/" },
      user: { uuid: `173266879-fp-sync-${Date.now()}` },
    },
    widget: {
      items: [
        {
          rfk_id: "rfkid_503",
          entity: "home",
          sources: ["xm_cloud_public_website"],
          search: {
            content: {},
            offset: 0,
            limit: 100,
            filter: {
              type: "and",
              filters: [
                { type: "eq", name: "community_id", value: communityId },
                { type: "anyOf", name: "status", values: ["Available", "Inventory"] },
              ],
            },
          },
        },
      ],
    },
  };
  const res = await fetch(DISCOVER_URL, {
    method: "POST",
    headers: {
      authorization: DISCOVER_AUTH,
      "content-type": "application/json",
      origin: "https://www.meritagehomes.com",
      referer: "https://www.meritagehomes.com/",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`discover query for ${communityId}: ${res.status}`);
  const data = (await res.json()) as {
    widgets?: { rfk_id?: string; content?: DiscoverHome[] }[];
  };
  return data.widgets?.find((w) => Array.isArray(w.content))?.content ?? [];
}

export function normalizeMeritageHome(h: DiscoverHome, pageUrl?: string): NormalizedPlan | null {
  const planName = (h.floorplan_name ?? "").trim();
  const address = (h.address ?? "").trim();
  const name = address || (planName ? `${planName} (${h.id ?? ""})`.trim() : "");
  if (!name) return null;
  const half = h.half_bathrooms ?? 0;
  const baths =
    h.full_bathrooms != null ? (half > 0 ? `${h.full_bathrooms}.5` : String(h.full_bathrooms)) : "";
  const photos = [h.image_url, ...(h.image_urls ?? [])].filter(
    (u, i, a): u is string => Boolean(u) && /^https?:\/\//.test(u ?? "") && a.indexOf(u) === i
  );
  return {
    planKey: normKey(name),
    name,
    price: typeof h.price === "number" && h.price > 0 ? h.price : null,
    priceDisplay: money(h.price ?? null),
    beds: h.bedrooms != null ? String(h.bedrooms) : "",
    baths,
    sqft: typeof h.sqft === "number" ? h.sqft : null,
    garages: h.garages != null ? `${h.garages} car` : null,
    homeType: null,
    quickMoveIn: true, // Discover items are specific homes on lots
    comingSoon: false,
    sourceUrl: pageUrl ?? null,
    galleryImages: photos,
    blueprintImages: h.interactive_floorplan_image ? [h.interactive_floorplan_image] : [],
    raw: {
      meritageId: h.id ?? h.sfid,
      relatedPlan: planName || null,
      status: h.status,
      series: h.community_sheet_name,
      constructionStage: h.construction_stage,
      moveInTimeframe: h.movein_timeframe,
    },
  };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const isUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim());

/** The floor plans a series page carries in its Next.js data. Exported for tests. */
export function communityPlans(html: string): PagePlan[] {
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) return [];
  let data: { props?: { pageProps?: { componentProps?: Record<string, unknown> } } };
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const out: PagePlan[] = [];
  for (const component of Object.values(data.props?.pageProps?.componentProps ?? {})) {
    const plans = (component as { data?: { floorplans?: unknown } } | null)?.data?.floorplans;
    if (Array.isArray(plans)) out.push(...plans.filter((p): p is PagePlan => Boolean(p) && typeof p === "object"));
  }
  return out;
}

/** "2", "2.5" or 2 as the sites write baths; "" when not given. */
const countOf = (v: unknown): string => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? String(n) : "";
};

/**
 * A plan from its series page: its photos once each, in the page's order,
 * its drawing, its tour. No price or garages: its homes give those
 * (withPlanFactsFromHomes). Exported for tests.
 */
export function normalizeMeritagePlan(p: PagePlan, pageUrl?: string): NormalizedPlan | null {
  const name = (p.name ?? "").trim();
  if (!name) return null;
  const sqft = parseInt(String(p.sqFootage ?? "").replace(/[^0-9]/g, ""), 10);
  const photos = (p.images ?? [])
    .map((im) => im?.src?.trim())
    .filter((u, i, all): u is string => isUrl(u) && all.indexOf(u) === i);
  const drawing = p.floorplanDiagram?.src?.trim();
  const tour = p.virtualTourUrl?.trim();
  return {
    planKey: normKey(name),
    name,
    price: null,
    priceDisplay: null,
    beds: countOf(p.bedrooms),
    baths: countOf(p.bathrooms),
    sqft: Number.isFinite(sqft) && sqft > 0 ? sqft : null,
    garages: null,
    homeType: null,
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: pageUrl ?? null,
    galleryImages: photos,
    blueprintImages: isUrl(drawing) ? [drawing] : [],
    virtualTourUrl: isUrl(tour) ? tour : null,
    raw: {},
  };
}

/** The plan's garages, from the most any of its homes has, where the page gives none. Pure; exported for tests. */
export function withPlanFactsFromHomes(plans: NormalizedPlan[]): NormalizedPlan[] {
  return plans.map((plan) => {
    if (plan.quickMoveIn || plan.garages) return plan;
    const garages = plans
      .filter((h) => h.quickMoveIn && normKey(String(h.raw?.relatedPlan ?? "")) === plan.planKey)
      .map((h) => parseInt(h.garages ?? "", 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return garages.length ? { ...plan, garages: `${Math.max(...garages)} car` } : plan;
  });
}

async function readSeriesPage(url: string): Promise<PagePlan[]> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Meritage page ${url}: ${res.status} (its floor plans could not be read)`);
  return communityPlans(await res.text());
}

function resolveCommunities(params: {
  communities?: MeritageCommunity[];
  url?: string;
  communityName?: string;
}): MeritageCommunity[] {
  if (params.communities?.length) return params.communities;
  const url = params.url ?? "";
  const nameKey = params.communityName ? normKey(params.communityName) : "";
  for (const [slug, communities] of Object.entries(KNOWN_COMMUNITIES)) {
    if (url.includes(slug) || (nameKey && slug === nameKey)) return communities;
  }
  return [];
}

export async function extractMeritage(params: {
  communities?: MeritageCommunity[];
  url?: string;
  communityName?: string;
}): Promise<NormalizedPlan[]> {
  const communities = resolveCommunities(params);
  if (!communities.length) {
    throw new Error(
      "meritage extractor needs extractor_params.communities ([{id, url}] with Salesforce community ids) or a known community page URL"
    );
  }
  const byKey = new Map<string, NormalizedPlan>();
  // The plans first, from each series page, so a plan keeps its own row
  // ahead of any home of the same name.
  for (const url of new Set(communities.map((c) => c.url ?? params.url).filter(isUrl))) {
    for (const page of await readSeriesPage(url)) {
      const plan = normalizeMeritagePlan(page, url);
      if (plan && !byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
    }
  }
  for (const community of communities) {
    const homes = await discoverHomes(community.id);
    for (const home of homes) {
      const plan = normalizeMeritageHome(home, community.url ?? params.url);
      if (plan && !byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
    }
  }
  return withPlanFactsFromHomes([...byKey.values()]);
}
