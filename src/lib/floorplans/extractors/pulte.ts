// PulteGroup extractor (Pulte, Del Webb, Centex): the three brands share one
// site, and each community page loads its plans and its homes for sale
// from two feeds of its own (read off Riversong's page, 2026-09-23):
//
//   /api/plan/homeplans?communityId=211407   every plan, whole
//   /api/plan/qmiplans?communityId=211407    every home for sale, with its plan
//
// A plan's record carries its name, type ("Single Family Home"), price,
// beds, baths, half baths, size, garages, the builder's description, the
// address of its page, its Matterport tour and every picture with its
// caption, its place in the gallery and whether it shows the outside or
// the inside. A home's carries its address, price, facts, pictures and its
// plan's record. Only the floor plan drawings are missing: those are read
// off each plan's own page.
//
// Read by Claude instead, Riversong's list was an eleven-megabyte page cut
// short before its plans (twenty-three of them, one run; one, another),
// and a plan's gallery opened on whichever room its carousel drew first.

import { classifyRoom, orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface PulteImage {
  path?: string | null;
  altText?: string | null;
  caption?: string | null;
  imageRank?: number | null;
  imageType?: string | null;
}

export interface PultePlan {
  id?: number;
  planName?: string | null;
  planTypeName?: string | null;
  planTypeNameActual?: string | null;
  bedrooms?: number | null;
  maxBedrooms?: number | null;
  bathrooms?: number | null;
  halfBaths?: number | null;
  maxBathrooms?: number | null;
  maxHalfBaths?: number | null;
  squareFeet?: number | null;
  garages?: number | null;
  price?: number | null;
  priceComingSoon?: boolean | null;
  isSoldOut?: boolean | null;
  isFutureRelease?: boolean | null;
  isPlanActive?: boolean | null;
  description?: string | null;
  overview?: string | null;
  images?: PulteImage[] | null;
  pageURL?: string | null;
  virtualTour?: string | null;
  threeDTour?: string | null;
  seriesName?: string | null;
}

export interface PulteHome {
  inventoryHomeID?: number;
  address?: { street1?: string | null } | null;
  price?: number | null;
  finalPrice?: number | null;
  callForPricingFlag?: boolean | null;
  soldDate?: string | null;
  squareFeet?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  halfBaths?: number | null;
  totalBaths?: number | null;
  garages?: number | null;
  isSingleFamily?: boolean | null;
  planId?: number | null;
  planName?: string | null;
  overview?: string | null;
  plan?: PultePlan | null;
  images?: PulteImage[] | null;
  pageURL?: string | null;
}

const money = (n: number | null) => (n ? "$" + n.toLocaleString("en-US") : null);
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** "3" or "3-4": the site keeps the larger end (standardize.ts). */
const range = (low: number | null | undefined, high: number | null | undefined) => {
  if (low == null && high == null) return "";
  const a = low ?? high!;
  const b = high ?? low!;
  return a === b || b < a ? String(a) : `${a}-${b}`;
};
const baths = (full: number | null | undefined, half: number | null | undefined) =>
  full == null ? null : full + (half ? 0.5 * half : 0);

/** The community's id, the number its address ends with: ".../riversong-211407" is 211407. Exported for tests. */
export function communityIdOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").match(/-(\d{5,})$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A picture of the home itself; the community's are the community's (a home's feed leads with the amenity campus). */
const OF_THE_HOME = /^home\b/i;

/**
 * A record's pictures in the builder's order, the front of the house
 * leading, the elevations as outside views and each room by its caption.
 * Exported for tests.
 */
export function pulteGallery(images: PulteImage[] | null | undefined, address: (path: string) => string = (p) => p) {
  const pictures = (images ?? [])
    .filter((i) => i.path && (!i.imageType || OF_THE_HOME.test(i.imageType.trim())))
    .map((i, at) => ({ ...i, at }))
    .sort((a, b) => (a.imageRank ?? Infinity) - (b.imageRank ?? Infinity) || a.at - b.at);
  const outside = (i: PulteImage) => /exterior/i.test(i.imageType ?? "");
  const said = (i: PulteImage) => clean(i.caption) || clean(i.altText);
  const isElevation = (i: PulteImage) => /^elevation\b/i.test(said(i));
  // The front of the house: the first outside view that is not one of the
  // alternative elevations, or failing that the first picture.
  const lead = Math.max(0, pictures.findIndex((i) => outside(i) && !isElevation(i)));
  const items: GalleryInput[] = pictures.map((i, n) => {
    const src = address(i.path!.trim());
    const caption = said(i) || null;
    if (n === lead) return { src, kind: "primary", caption };
    if (isElevation(i)) return { src, kind: "exterior", caption };
    const room = classifyRoom(clean(i.caption)) ?? classifyRoom(clean(i.altText));
    return { src, caption, room: room ?? (outside(i) ? "exterior" : undefined) };
  });
  return orderGallery(items);
}

/** A plan as the site files it, from its feed record; null for one the builder no longer offers. Exported for tests. */
export function planFromRecord(r: PultePlan, origin: string, communityUrl: string, address?: (path: string) => string): NormalizedPlan | null {
  const name = clean(r.planName);
  if (!name || r.isSoldOut || r.isPlanActive === false) return null;
  const price = !r.priceComingSoon && r.price && r.price > 0 ? r.price : null;
  const gallery = pulteGallery(r.images, address);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: money(price),
    beds: range(r.bedrooms, r.maxBedrooms),
    baths: range(baths(r.bathrooms, r.halfBaths), baths(r.maxBathrooms, r.maxHalfBaths)),
    sqft: r.squareFeet && r.squareFeet > 0 ? r.squareFeet : null,
    garages: r.garages ? `${r.garages} car` : null,
    homeType: standardHomeType(r.planTypeNameActual ?? r.planTypeName ?? null),
    quickMoveIn: false,
    comingSoon: Boolean(r.isFutureRelease || r.priceComingSoon),
    sourceUrl: r.pageURL ? new URL(r.pageURL, origin).href : `${communityUrl.replace(/\/+$/, "")}/${slug}-${r.id}`,
    description: clean(r.description) || clean(r.overview) || null,
    virtualTourUrl: clean(r.virtualTour) || clean(r.threeDTour) || null,
    galleryImages: gallery.urls,
    galleryMeta: gallery.meta,
    blueprintImages: [],
    raw: { planId: r.id != null ? String(r.id) : null, series: clean(r.seriesName) || null },
  };
}

/** A home for sale as the site files it, from its feed record; null for one sold. Exported for tests. */
export function homeFromRecord(r: PulteHome, origin: string, address?: (path: string) => string): NormalizedPlan | null {
  const street = clean(r.address?.street1);
  if (!street || r.soldDate) return null;
  const price = r.callForPricingFlag ? null : (r.finalPrice && r.finalPrice > 0 ? r.finalPrice : r.price && r.price > 0 ? r.price : null);
  const gallery = pulteGallery(r.images, address);
  const planName = clean(r.planName ?? r.plan?.planName) || null;
  const total = r.totalBaths ?? baths(r.bathrooms, r.halfBaths);
  return {
    planKey: normKey(street),
    name: street,
    price,
    priceDisplay: money(price),
    beds: r.bedrooms != null ? String(r.bedrooms) : "",
    baths: total != null ? String(total) : "",
    sqft: r.squareFeet && r.squareFeet > 0 ? r.squareFeet : null,
    garages: r.garages ? `${r.garages} car` : null,
    homeType: standardHomeType(r.plan?.planTypeNameActual ?? r.plan?.planTypeName ?? (r.isSingleFamily ? "Single Family Home" : null)),
    quickMoveIn: true,
    comingSoon: false,
    sourceUrl: r.pageURL ? new URL(r.pageURL, origin).href : r.plan?.pageURL ? new URL(r.plan.pageURL, origin).href : null,
    relatedPlanName: planName,
    description: clean(r.overview) || null,
    galleryImages: gallery.urls,
    galleryMeta: gallery.meta,
    blueprintImages: [],
    raw: { planId: r.planId != null ? String(r.planId) : null, relatedPlan: planName, inventoryHomeId: r.inventoryHomeID ?? null },
  };
}

async function feed<T>(url: string, referer: string): Promise<T[]> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json", referer },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function extractPulteGroup(params: { url?: string; runDeadline?: number }): Promise<NormalizedPlan[]> {
  const url = params.url?.trim();
  if (!url) throw new Error("the PulteGroup extractor needs the community's page (extractor_params.url)");
  const id = communityIdOf(url);
  if (!id) throw new Error(`no community id at the end of ${url} (a PulteGroup community's address ends "-211407")`);
  const origin = new URL(url).origin;
  const [planRecords, homeRecords] = await Promise.all([
    feed<PultePlan>(`${origin}/api/plan/homeplans?communityId=${id}`, url),
    feed<PulteHome>(`${origin}/api/plan/qmiplans?communityId=${id}`, url),
  ]);
  const plans = planRecords.map((r) => planFromRecord(r, origin, url)).filter((p): p is NormalizedPlan => Boolean(p));
  const homes = homeRecords.map((r) => homeFromRecord(r, origin)).filter((p): p is NormalizedPlan => Boolean(p));
  if (!plans.length && !homes.length) throw new Error(`no plans or homes in ${origin}'s feeds for community ${id}`);
  // One plan once: a plan listed in two series keeps its first record.
  const byKey = new Map<string, NormalizedPlan>();
  for (const p of [...plans, ...homes]) if (!byKey.has(p.planKey)) byKey.set(p.planKey, p);
  return [...byKey.values()];
}
