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
// the inside, the floor plan drawings among them ("Plan Floorplan-New"). A
// home's carries its address, its page, price, facts, its own pictures
// ("Inventory Elevation", "Inventory Interior") and its plan's record.
// Where a plan's record has no drawings, its page is read for them.
//
// Read by Claude instead, Riversong's list was an eleven-megabyte page cut
// short before its plans (twenty-three of them, one run; one, another),
// and a plan's gallery opened on whichever room its carousel drew first.

import { classifyRoom, orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { bathsOf, standardHomeType } from "@/lib/floorplans/standardize";
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
  inventoryPageURL?: string | null;
  inventoryDescription?: string | null;
  virtualTour?: string | null;
  threeDTour?: string | null;
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
/** "4.5" or "3.5-4": the site keeps the larger end (standardize.ts, bathsOf and largestInRange). */
const bathsRange = (low: string | null, high: string | null) => {
  if (low == null && high == null) return "";
  const a = low ?? high!;
  const b = high ?? low!;
  return a === b || Number(b) < Number(a) ? a : `${a}-${b}`;
};

/** The community's id, the number its address ends with: ".../riversong-211407" is 211407. Exported for tests. */
export function communityIdOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").match(/-(\d{5,})$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A picture of the home or the plan ("Home Exterior", "Inventory Elevation"); the community's are the community's. */
const OF_THE_HOME = /^(home|inventory)\b/i;
/** A floor plan drawing ("Plan Floorplan-New"). */
const DRAWING = /floor ?plan/i;

/** A record's floor plan drawings, in the builder's order. Exported for tests. */
export function pulteDrawings(images: PulteImage[] | null | undefined, address: (path: string) => string = (p) => p): string[] {
  return (images ?? [])
    .filter((i) => i.path && DRAWING.test(i.imageType ?? ""))
    .map((i, at) => ({ ...i, at }))
    .sort((a, b) => (a.imageRank ?? Infinity) - (b.imageRank ?? Infinity) || a.at - b.at)
    .map((i) => address(i.path!.trim()));
}

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
  const outside = (i: PulteImage) => /exterior|elevation/i.test(i.imageType ?? "");
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

/**
 * A plan as the site files it, from its feed record; null for one the
 * builder no longer offers — unless homes built on it are still for sale
 * (`withHomes`): Longmeadow's sold-out plan has three (North River Ranch,
 * 2026-09-23). Exported for tests.
 */
export function planFromRecord(r: PultePlan, origin: string, communityUrl: string, address?: (path: string) => string, withHomes = false): NormalizedPlan | null {
  const name = clean(r.planName);
  if (!name || ((r.isSoldOut || r.isPlanActive === false) && !withHomes)) return null;
  const price = !r.priceComingSoon && r.price && r.price > 0 ? r.price : null;
  const gallery = pulteGallery(r.images, address);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: money(price),
    beds: range(r.bedrooms, r.maxBedrooms),
    baths: bathsRange(bathsOf(r.bathrooms, r.halfBaths), bathsOf(r.maxBathrooms, r.maxHalfBaths)),
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
    blueprintImages: pulteDrawings(r.images, address),
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
  const total = bathsOf(r.bathrooms, r.halfBaths) ?? (r.totalBaths != null ? String(r.totalBaths) : null);
  return {
    planKey: normKey(street),
    name: street,
    price,
    priceDisplay: money(price),
    beds: r.bedrooms != null ? String(r.bedrooms) : "",
    baths: total ?? "",
    sqft: r.squareFeet && r.squareFeet > 0 ? r.squareFeet : null,
    garages: r.garages ? `${r.garages} car` : null,
    homeType: standardHomeType(r.plan?.planTypeNameActual ?? r.plan?.planTypeName ?? (r.isSingleFamily ? "Single Family Home" : null)),
    quickMoveIn: true,
    comingSoon: false,
    sourceUrl: r.inventoryPageURL ? new URL(r.inventoryPageURL, origin).href : r.plan?.pageURL ? new URL(r.plan.pageURL, origin).href : null,
    relatedPlanName: planName,
    description: clean(r.inventoryDescription) || clean(r.overview) || null,
    virtualTourUrl: clean(r.virtualTour) || clean(r.threeDTour) || null,
    galleryImages: gallery.urls,
    galleryMeta: gallery.meta,
    blueprintImages: pulteDrawings(r.images, address),
    raw: { planId: r.planId != null ? String(r.planId) : null, relatedPlan: planName, inventoryHomeId: r.inventoryHomeID ?? null },
  };
}

/**
 * The floor plan drawings a plan's page shows where the feed has none: its
 * floor plan section draws each floor as a figure in a "floor-container"
 * (Daylen at Riversong, 2026-09-23: "First Floor", pultegroup.cdn.picturepark.com/v/0w56AjBu/).
 * A plan offered only through the interactive floor plan tool has none.
 * Exported for tests.
 */
export function pageDrawings(html: string): string[] {
  const found: string[] = [];
  const add = (src: string | undefined) => {
    const url = src?.replace(/&amp;/g, "&").trim();
    if (url && /^https?:\/\//.test(url) && !found.includes(url)) found.push(url);
  };
  for (const m of html.matchAll(/class="[^"]*\bfloor-container\b[^"]*"/g)) {
    const img = html.slice(m.index!, m.index! + 3000).match(/<img\b[^>]*>/)?.[0];
    add(img?.match(/\bdata-name="([^"]+)"/)?.[1]);
  }
  if (!found.length) add(html.match(/\bdata-ifp-id="([^"]+)"/)?.[1]);
  return found;
}

/** Each plan the feed gives no drawings, with the drawings its page shows; a page that cannot be read is left as it was. */
async function withPageDrawings(plans: NormalizedPlan[], runDeadline?: number): Promise<NormalizedPlan[]> {
  const wanting = plans.filter((p) => !p.quickMoveIn && !p.blueprintImages.length && p.sourceUrl);
  const found = new Map<string, string[]>();
  let next = 0;
  const worker = async () => {
    while (next < wanting.length) {
      const plan = wanting[next++];
      if (runDeadline && Date.now() > runDeadline - 30_000) return;
      try {
        const res = await fetch(plan.sourceUrl!, {
          headers: { "user-agent": UA, accept: "text/html" },
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) found.set(plan.planKey, pageDrawings(await res.text()));
      } catch {
        // left without drawings, as the feed gave it
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, wanting.length) }, worker));
  return plans.map((p) => (found.get(p.planKey)?.length ? { ...p, blueprintImages: found.get(p.planKey)! } : p));
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
  const onSale = new Set(homeRecords.filter((h) => !h.soldDate && (h.planId ?? h.plan?.id) != null).map((h) => String(h.planId ?? h.plan?.id)));
  // A home for sale on a plan the plans feed no longer lists brings its
  // plan's record with it: Longmeadow's three homes on the Coral
  // (North River Ranch, 2026-09-23).
  const listed = new Set(planRecords.map((r) => String(r.id)));
  const brought = new Map<string, PultePlan>();
  for (const h of homeRecords) {
    const id = h.planId ?? h.plan?.id;
    if (h.soldDate || id == null || listed.has(String(id)) || brought.has(String(id)) || !h.plan?.planName) continue;
    brought.set(String(id), { ...h.plan, id });
  }
  const plans = await withPageDrawings(
    [...planRecords, ...brought.values()]
      .map((r) => planFromRecord(r, origin, url, undefined, r.id != null && onSale.has(String(r.id))))
      .filter((p): p is NormalizedPlan => Boolean(p)),
    params.runDeadline,
  );
  // A home is built to its plan's drawings where it has none of its own.
  const drawingsOf = new Map(plans.map((p) => [String(p.raw?.planId), p.blueprintImages]));
  const homes = homeRecords
    .map((r) => homeFromRecord(r, origin))
    .filter((p): p is NormalizedPlan => Boolean(p))
    .map((h) => (h.blueprintImages.length ? h : { ...h, blueprintImages: drawingsOf.get(String(h.raw?.planId)) ?? [] }));
  if (!plans.length && !homes.length) throw new Error(`no plans or homes in ${origin}'s feeds for community ${id}`);
  // One plan once: a plan listed in two series keeps its first record.
  const byKey = new Map<string, NormalizedPlan>();
  for (const p of [...plans, ...homes]) if (!byKey.has(p.planKey)) byKey.set(p.planKey, p);
  return [...byKey.values()];
}
