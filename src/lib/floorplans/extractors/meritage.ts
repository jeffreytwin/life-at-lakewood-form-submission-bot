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
  for (const community of communities) {
    const homes = await discoverHomes(community.id);
    for (const home of homes) {
      const plan = normalizeMeritageHome(home, community.url ?? params.url);
      if (plan && !byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
    }
  }
  return [...byKey.values()];
}
