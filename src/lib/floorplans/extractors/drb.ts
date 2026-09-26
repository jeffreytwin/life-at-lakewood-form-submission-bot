// DRB Homes extractor (json_api): api.drbhomes.com/api/v1/public/inventory
// is an open, paginated REST resource carrying every inventory home with
// communityName, planName, full specs, price, and typed image galleries.
// Its filter params are ignored server-side, so the extractor sweeps the
// pages and filters client-side by community. Structure captured in
// pipeline/slice/discovery/round8/.
//
// The plans a community builds come from the same API's plan resource
// (api/v1/public/plan), which names the communities each plan is offered
// in (availableLocations): the homes alone left Biscayne Landing at Seaire
// with no floor plans at all (Jeff, 2026-09-26).

import { classifyRoom, orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { bathsOf } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const API = "https://api.drbhomes.com/api/v1/public/inventory";
const PLAN_API = "https://api.drbhomes.com/api/v1/public/plan";
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
  // Every picture comes titled — "Front Exterior of 8320 Golden Beach
  // Court", "Kitchen" — so the gallery is put in the site's order from what
  // DRB says each one is: the front of the house leads, the rooms follow,
  // the other outside views go last (gallery-order.ts).
  const photos = (item.images ?? []).filter((img) => img.url && !/floorplan/i.test(img.type ?? ""));
  const said = (img: DrbImage) => (img.title || img.type || "").trim();
  const front = photos.find((img) => /\bfront\b/i.test(said(img)) && classifyRoom(said(img)) === "exterior");
  const ordered = orderGallery(
    photos.map((img): GalleryInput => {
      const caption = said(img) || null;
      if (img === front) return { src: img.url!, kind: "primary", caption };
      if (caption && classifyRoom(caption) === "exterior") return { src: img.url!, kind: "exterior", caption };
      return { src: img.url!, caption };
    })
  );
  const gallery = ordered.urls;
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
    galleryMeta: ordered.meta,
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

interface DrbPlanImage {
  url?: string;
  title?: string;
  sequence?: number;
  status?: string;
}

interface DrbPlan {
  id?: number;
  name?: string;
  marketingName?: string | null;
  isTemplate?: boolean;
  status?: string;
  basePrice?: number | null;
  bedsMin?: number | null;
  bedsMax?: number | null;
  bathsFullMin?: number | null;
  bathsFullMax?: number | null;
  bathsHalfMin?: number | null;
  bathsHalfMax?: number | null;
  sqFtMin?: number | null;
  sqFtMax?: number | null;
  garageSpacesMin?: number | null;
  garageSpacesMax?: number | null;
  marketingHeadline?: string | null;
  marketingDescription?: string | null;
  websiteUrl?: string | null;
  planType?: { label?: string; valueForFeed?: string } | null;
  elevationImages?: DrbPlanImage[];
  interiorImages?: DrbPlanImage[];
  floorplanImages?: DrbPlanImage[];
  availableLocations?: ({ communityName?: string; id?: number } | string)[];
}

/** A plan's pictures of one kind, active and in DRB's own order. */
const inOrder = (images: DrbPlanImage[] | undefined): string[] =>
  (images ?? [])
    .filter((img) => img.url && (img.status ?? "active") === "active")
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((img) => img.url as string);

/** "<ul><li>Open kitchen…</li>…</ul>" as sentences. */
function plainText(html: string | null | undefined): string | null {
  const text = String(html ?? "")
    .replace(/<\/(?:li|p)>/gi, ". ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/([.!?])\.+/g, "$1")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
  return text ? `${text}.` : null;
}

/**
 * One of DRB's plans as the site files a floor plan: the top of each
 * range DRB gives (bedsMax, the full and half baths at their most), the
 * base price, its elevations leading its pictures and its drawings as
 * blueprints. Pure; exported for tests.
 */
export function normalizeDrbPlan(plan: DrbPlan, pageUrl?: string): NormalizedPlan | null {
  const name = (plan.marketingName || plan.name || "").trim();
  if (!name) return null;
  const top = (max: number | null | undefined, min: number | null | undefined) => (typeof max === "number" ? max : typeof min === "number" ? min : null);
  const beds = top(plan.bedsMax, plan.bedsMin);
  const garages = top(plan.garageSpacesMax, plan.garageSpacesMin);
  const photos = [...inOrder(plan.elevationImages), ...inOrder(plan.interiorImages)].filter((u, i, all) => all.indexOf(u) === i);
  const elevations = new Set(inOrder(plan.elevationImages));
  const ordered = orderGallery(photos.map((src, i): GalleryInput => ({ src, kind: i === 0 ? "primary" : elevations.has(src) ? "exterior" : undefined })));
  return {
    planKey: normKey(name),
    name,
    price: typeof plan.basePrice === "number" && plan.basePrice > 0 ? plan.basePrice : null,
    priceDisplay: money(plan.basePrice),
    beds: beds != null ? String(beds) : "",
    baths: bathsOf(top(plan.bathsFullMax, plan.bathsFullMin), top(plan.bathsHalfMax, plan.bathsHalfMin)) ?? "",
    sqft: top(plan.sqFtMax, plan.sqFtMin),
    garages: garages != null ? `${garages} car` : null,
    homeType: plan.planType?.valueForFeed ?? plan.planType?.label ?? null,
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: plan.websiteUrl?.trim() || pageUrl || null,
    description: plainText(plan.marketingDescription) ?? plan.marketingHeadline?.trim() ?? null,
    galleryImages: ordered.urls,
    galleryMeta: ordered.meta,
    blueprintImages: inOrder(plan.floorplanImages),
    raw: { drbPlanId: plan.id ?? null },
  };
}

/** Whether DRB offers a plan in this community, by the communities it names. */
export function planOfferedIn(plan: DrbPlan, nameKey: string): boolean {
  return Boolean(nameKey) && (plan.availableLocations ?? []).some((l) => normKey(typeof l === "string" ? l : l?.communityName ?? "").includes(nameKey));
}

/** The community's page of plans, from its overview page's address. */
export function plansPageOf(url: string | undefined): string | undefined {
  return url?.replace(/\/(?:overview|home-plans|available-homes)\/?$/i, "/home-plans");
}

/** One page of a DRB resource; a page that is slow to answer is asked once more. */
async function drbPage<T>(url: string): Promise<{ items?: T[]; meta?: { totalPages?: number } }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return (await res.json()) as { items?: T[]; meta?: { totalPages?: number } };
    } catch (error) {
      if (attempt >= 2) throw new Error(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Every plan DRB offers in the community: the plan resource swept, three pages at a time. */
async function drbPlans(nameKey: string, pageUrl?: string): Promise<NormalizedPlan[]> {
  const first = await drbPage<DrbPlan>(`${PLAN_API}?limit=${PAGE_SIZE}&page=1`);
  const pages = Math.min(first.meta?.totalPages ?? 1, MAX_PAGES);
  const rest: DrbPlan[][] = [];
  for (let from = 2; from <= pages; from += 3) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(3, pages - from + 1) }, (_, n) => drbPage<DrbPlan>(`${PLAN_API}?limit=${PAGE_SIZE}&page=${from + n}`).then((d) => d.items ?? []))
    );
    rest.push(...batch);
  }
  const byKey = new Map<string, NormalizedPlan>();
  for (const plan of [...(first.items ?? []), ...rest.flat()]) {
    if ((plan.status ?? "active") !== "active" || !planOfferedIn(plan, nameKey)) continue;
    const normalized = normalizeDrbPlan(plan, plansPageOf(pageUrl));
    if (!normalized) continue;
    // A plan and the template it was made from may both name the
    // community: the one with a price and pictures stands.
    const had = byKey.get(normalized.planKey);
    const worth = (p: NormalizedPlan) => (p.price ? 100 : 0) + p.galleryImages.length + p.blueprintImages.length;
    if (!had || worth(normalized) > worth(had)) byKey.set(normalized.planKey, normalized);
  }
  return [...byKey.values()];
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
  // The plans beside the homes; a plan resource that cannot be read fails
  // the run rather than leave the community with its homes and no plans.
  // Its failure is held until the homes are read: a rejection nothing is
  // waiting on yet stops the whole process (the check's build, 2026-09-26).
  const plansRead: Promise<{ plans: NormalizedPlan[] } | { error: unknown }> = (nameKey ? drbPlans(nameKey, params.url) : Promise.resolve([])).then(
    (plans) => ({ plans }),
    (error: unknown) => ({ error })
  );
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
  const read = await plansRead;
  if ("error" in read) throw new Error(`drb plans: ${read.error instanceof Error ? read.error.message : String(read.error)}`);
  const offered = read.plans;
  return [...offered, ...[...byKey.values()].filter((home) => !offered.some((p) => p.planKey === home.planKey))];
}
