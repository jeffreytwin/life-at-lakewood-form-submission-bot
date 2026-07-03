// DRB Homes extractor (json_api): api.drbhomes.com/api/v1/public/inventory
// is an open, paginated REST resource carrying every inventory home with
// communityName, planName, full specs, price, and typed image galleries.
// Its filter params are ignored server-side, so the extractor sweeps the
// pages and filters client-side by community. Base (to-be-built) plan
// listings are not exposed per community — DRB's Seaire presence is
// inventory homes, which is what the legacy collection tracks.
// Structure captured in pipeline/slice/discovery/round8/.

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const API = "https://api.drbhomes.com/api/v1/public/inventory";
const PAGE_SIZE = 50;
const MAX_PAGES = 40;

interface DrbImage {
  url?: string;
  type?: string;
  title?: string;
}

interface DrbInventoryItem {
  id?: number;
  communityId?: number;
  communityName?: string;
  community?: { id?: number; name?: string } | null;
  planName?: string;
  planId?: number;
  price?: number;
  beds?: number;
  fullBaths?: number;
  halfBaths?: number;
  sqFt?: number;
  garageSpaces?: number;
  stories?: number;
  homesite?: string | number;
  lotNumber?: string | number | null;
  salesStatus?: string;
  isModel?: boolean;
  websiteUrl?: string;
  marketingHeadline?: string;
  availabilityDate?: string | null;
  yearBuilt?: number;
  images?: DrbImage[];
}

const money = (n: number | null | undefined) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;

export function normalizeDrbItem(item: DrbInventoryItem, pageUrl?: string): NormalizedPlan | null {
  const planName = (item.planName ?? "").trim();
  const homesite = item.homesite ?? item.lotNumber;
  // Street addresses live only in image titles ("Front Exterior of 8320
  // Golden Beach Court"); the stable identity is plan + homesite.
  const addressFromImage = item.images
    ?.map((img) => img.title?.match(/\b(\d+\s+[A-Z][A-Za-z' ]+(?:Court|Ct|Drive|Dr|Street|St|Terrace|Ter|Lane|Ln|Way|Avenue|Ave|Boulevard|Blvd|Circle|Cir|Place|Pl|Road|Rd))\b/)?.[1])
    .find(Boolean);
  const name =
    addressFromImage ??
    (planName ? `${planName}${homesite != null ? ` (Homesite ${homesite})` : ` (${item.id ?? ""})`}` : "");
  if (!name.trim()) return null;
  const gallery = (item.images ?? [])
    .filter((img) => img.url && !/floorplan/i.test(img.type ?? ""))
    .map((img) => img.url as string)
    .filter((u, i, a) => a.indexOf(u) === i);
  const blueprints = (item.images ?? [])
    .filter((img) => img.url && /floorplan/i.test(img.type ?? ""))
    .map((img) => img.url as string);
  return {
    planKey: normKey(name),
    name: name.trim(),
    price: typeof item.price === "number" && item.price > 0 ? item.price : null,
    priceDisplay: money(item.price),
    beds: item.beds != null ? String(item.beds) : "",
    baths:
      item.fullBaths != null
        ? (item.halfBaths ?? 0) > 0
          ? `${item.fullBaths}.5`
          : String(item.fullBaths)
        : "",
    sqft: typeof item.sqFt === "number" ? item.sqFt : null,
    garages: item.garageSpaces != null ? `${item.garageSpaces} car` : null,
    homeType: null,
    quickMoveIn: true, // inventory items are specific homes
    comingSoon: (item.salesStatus ?? "").toLowerCase() === "coming_soon",
    sourceUrl: item.websiteUrl || pageUrl || null,
    galleryImages: gallery,
    blueprintImages: blueprints,
    raw: {
      drbId: item.id,
      relatedPlan: planName || null,
      homesite: homesite ?? null,
      salesStatus: item.salesStatus ?? null,
      isModel: item.isModel ?? null,
      availabilityDate: item.availabilityDate ?? null,
      headline: item.marketingHeadline?.slice(0, 200) ?? null,
    },
  };
}

function matchesCommunity(
  item: DrbInventoryItem,
  { communityId, nameKey }: { communityId?: number; nameKey: string }
): boolean {
  const itemCid = item.communityId ?? item.community?.id;
  if (communityId != null) return itemCid === communityId;
  const itemName = item.communityName ?? item.community?.name ?? "";
  return Boolean(nameKey) && normKey(itemName).includes(nameKey);
}

export async function extractDrb(params: {
  url?: string;
  communityId?: number;
  communityName?: string;
}): Promise<NormalizedPlan[]> {
  const nameKey = params.communityName ? normKey(params.communityName) : "";
  if (params.communityId == null && !nameKey) {
    throw new Error("drb extractor requires extractor_params.communityId or a community name");
  }
  const byKey = new Map<string, NormalizedPlan>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${API}?limit=${PAGE_SIZE}&page=${page}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`drb inventory page ${page}: ${res.status}`);
    const data = (await res.json()) as { items?: DrbInventoryItem[]; meta?: { totalPages?: number } };
    for (const item of data.items ?? []) {
      if (!matchesCommunity(item, { communityId: params.communityId, nameKey })) continue;
      const plan = normalizeDrbItem(item, params.url);
      if (plan && !byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
    }
    if (page >= (data.meta?.totalPages ?? 0)) break;
  }
  return [...byKey.values()];
}
