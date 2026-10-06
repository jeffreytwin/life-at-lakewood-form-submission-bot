// Stanley Martin extractor: the site is a single-page app whose pages are
// an empty <div id="root"> until its scripts run, so a fetch gave Claude
// nothing to read and the Oakfield Trails connection failed three times
// (2026-10-06). A browser does no better: the community page opens on its
// Available Homes tab, and the Floor Plans tab, the only place The Sadler
// shows (it has no home for sale), is drawn only once it is clicked.
//
// Every tab is drawn from the site's own feeds, which answer a plain POST:
//
//   POST /smhWeb/neighborhood {"id":"oft"}
//     floorplans: name, productId, minBaseSalesPrice, beds, baths, size, garage
//     listings:   each home for sale (id, address, plan name, salesPrice)
//   POST /smhWeb/floorplan {"projectGroupId":"oft","productId":"003462V00"}
//     the plan's elevations and captioned photos, its description
//   POST /smhWeb/listing {"saleId":"181395"}
//     the home's own picture set and description, its plan's productId
//
// The community's id is the step of its address before its name
// (/florida/tampa/parrish/oft/oakfield-trails). A plan's page is
// .../oakfield-trails/floorplan/<productId>/<name>, a home's
// .../oakfield-trails/new-homes/<id>/<address>. No page is read by Claude.

import { logger } from "@/lib/shared/logger";
import { orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { bathsOf } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** How long one feed may take before its plan or home is left for the next run. */
const FEED_MS = 20_000;

interface SmImage {
  imageUrl?: string | null;
  caption?: string | null;
  title?: string | null;
  altText?: string | null;
}

export interface SmFloorplan {
  name?: string | null;
  productId?: string | null;
  productType?: string | null;
  minBaseSalesPrice?: number | null;
  numberBedrooms?: number | null;
  numberFullBaths?: number | null;
  numberHalfBaths?: number | null;
  numberGarageSpaces?: number | null;
  minSQFeet?: number | null;
  maxSQFeet?: number | null;
  imageUrl?: string | null;
}

export interface SmListing {
  id?: number | null;
  productName?: string | null;
  productType?: string | null;
  imageUrl?: string | null;
  address?: string | null;
  bedroomCount?: number | null;
  fullBathCount?: number | null;
  halfBathCount?: number | null;
  garageCount?: number | null;
  squareFootage?: number | null;
  salesPrice?: number | null;
  isModelHome?: boolean | null;
}

export interface SmNeighborhood {
  floorplans?: SmFloorplan[] | null;
  listings?: SmListing[] | null;
}

export interface SmFloorplanDetail {
  elevationImages?: SmImage[] | null;
  images?: SmImage[] | null;
  briefDescription?: string | null;
  productGreeting?: string | null;
  commVirTour?: string | null;
}

export interface SmListingDetail {
  productId?: string | null;
  images?: SmImage[] | null;
  description?: string | null;
  specVirTour?: string | null;
  lotNumber?: string | null;
  elevationId?: string | null;
  isContract?: boolean | null;
}

const clean = (s: unknown) => (typeof s === "string" ? s : s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
const money = (n: number | null) => (n ? "$" + n.toLocaleString("en-US") : null);
const positive = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? n : null);
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The community page's address and the id its feeds know it by. Exported for tests. */
export function communityOf(url: string): { page: string; origin: string; id: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const steps = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const id = steps[steps.length - 2];
  if (steps.length < 2 || !id || !/^[a-z0-9]{2,10}$/i.test(id)) return null;
  return { page: `${u.origin}/${steps.join("/")}`, origin: u.origin, id: id.toLowerCase() };
}

/**
 * A picture's lasting address. Every answer stamps each picture with the
 * time it was asked ("?t=1791321503") and some with an empty transform
 * ("&tr=fo-undefined"), so the same photo read the next night would have
 * been a new one; updatedAt, which changes when the photo does, stays.
 * Exported for tests.
 */
export function pictureUrl(url: string | null | undefined): string | null {
  const raw = clean(url);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.searchParams.delete("t");
    u.searchParams.delete("tr");
    return u.href;
  } catch {
    return null;
  }
}

/** "<p>Discover The Sadler…</p><p>…</p>" as sentences. */
function plainText(html: string | null | undefined): string | null {
  const text = String(html ?? "")
    .replace(/<\/(?:li|p|h\d)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&rsquo;|&#39;/gi, "’")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** "10123 MORNING MEADOWLARK TRL" as a street is written: "10123 Morning Meadowlark Trl". Exported for tests. */
export function streetName(address: string | null | undefined): string {
  return clean(address)
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (_, first: string, rest: string) => first.toUpperCase() + rest);
}

/** Stanley Martin's home types as the sites file them; a kind it names that the sites do not is left to the page. */
function homeTypeOf(productType: string | null | undefined): string | null {
  const type = clean(productType);
  if (/single/i.test(type)) return "Single Family Home";
  if (/town/i.test(type)) return "Townhome";
  if (/condo/i.test(type)) return "Condominium";
  return null;
}

/**
 * A plan's gallery or a home's, in the site's order: the front leads, the
 * rooms follow as the captions name them ("Kitchen", "Primary Suite"), the
 * other elevations go last. Exported for tests.
 */
export function galleryOf(front: string | null, elevations: SmImage[], photos: SmImage[]): Pick<NormalizedPlan, "galleryImages" | "galleryMeta"> {
  const items: GalleryInput[] = [];
  const lead = pictureUrl(front);
  if (lead) items.push({ src: lead, kind: "primary" });
  for (const img of elevations) {
    const src = pictureUrl(img.imageUrl);
    if (src) items.push({ src, kind: items.length ? "exterior" : "primary", caption: clean(img.caption) || null });
  }
  for (const img of photos) {
    const src = pictureUrl(img.imageUrl);
    if (src) items.push({ src, caption: clean(img.caption) || null });
  }
  const ordered = orderGallery(items);
  return { galleryImages: ordered.urls, galleryMeta: ordered.meta };
}

/** A floor plan as the community's feed lists it, with what its own feed adds. Exported for tests. */
export function planFrom(fp: SmFloorplan, community: { page: string }, detail: SmFloorplanDetail | null): NormalizedPlan | null {
  const name = clean(fp.name);
  const productId = clean(fp.productId);
  if (!name) return null;
  const price = positive(fp.minBaseSalesPrice);
  const min = positive(fp.minSQFeet);
  const max = positive(fp.maxSQFeet);
  const elevations = detail?.elevationImages ?? [];
  // The card's picture leads where the plan's own feed gave no elevation.
  const gallery = galleryOf(elevations.length ? null : fp.imageUrl ?? null, elevations, detail?.images ?? []);
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: money(price),
    beds: positive(fp.numberBedrooms) != null ? String(fp.numberBedrooms) : "",
    baths: bathsOf(positive(fp.numberFullBaths), positive(fp.numberHalfBaths)) ?? "",
    sqft: max ?? min,
    garages: positive(fp.numberGarageSpaces) ? `${fp.numberGarageSpaces} car` : null,
    homeType: homeTypeOf(fp.productType),
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: productId ? `${community.page}/floorplan/${encodeURIComponent(productId)}/${slugOf(name)}` : community.page,
    ...gallery,
    blueprintImages: [],
    description: plainText(detail?.briefDescription) ?? plainText(detail?.productGreeting),
    virtualTourUrl: clean(detail?.commVirTour) || null,
    ...(detail ? {} : { pageUnread: true }),
    raw: { planId: productId || null },
  };
}

/** A home for sale as the community's feed lists it, with what its own feed adds. Exported for tests. */
export function homeFrom(l: SmListing, community: { page: string }, detail: SmListingDetail | null): NormalizedPlan | null {
  const street = streetName(l.address);
  const planName = clean(l.productName);
  if (!street || !/^\d+\s+\S/.test(street)) return null;
  const price = positive(l.salesPrice);
  return {
    planKey: normKey(street),
    name: street,
    price,
    priceDisplay: money(price),
    beds: positive(l.bedroomCount) != null ? String(l.bedroomCount) : "",
    baths: bathsOf(positive(l.fullBathCount), positive(l.halfBathCount)) ?? "",
    sqft: positive(l.squareFootage),
    garages: positive(l.garageCount) ? `${l.garageCount} car` : null,
    homeType: homeTypeOf(l.productType),
    quickMoveIn: true,
    comingSoon: false,
    sourceUrl: l.id != null ? `${community.page}/new-homes/${l.id}/${slugOf(clean(l.address))}` : community.page,
    // The card shows this home's own elevation; its feed adds the rooms.
    ...galleryOf(l.imageUrl ?? null, [], detail?.images ?? []),
    blueprintImages: [],
    description: plainText(detail?.description),
    virtualTourUrl: clean(detail?.specVirTour) || null,
    relatedPlanName: planName || null,
    ...(detail ? {} : { pageUnread: true }),
    raw: {
      // The home's feed names its plan by the plan's own productId; the
      // community's list names it only by a shorter name ("Cortez II" for
      // "The Cortez II").
      planId: clean(detail?.productId) || null,
      relatedPlan: planName || null,
      lot: clean(detail?.lotNumber) || null,
      elevation: clean(detail?.elevationId) || null,
      sold: detail?.isContract === true,
      model: l.isModelHome === true,
    },
  };
}

async function postFeed<T>(origin: string, path: string, body: unknown, referer: string): Promise<T> {
  const res = await fetch(`${origin}/smhWeb/${path}`, {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json", referer },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FEED_MS),
  });
  if (!res.ok) throw new Error(`${origin}/smhWeb/${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** One feed per plan or home, a few at a time; one that fails is that row's page left unread, never the run. */
async function eachDetail<T, R>(items: T[], read: (item: T) => Promise<R>, what: string): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await read(items[i]);
      } catch (error) {
        logger.warn(`Stanley Martin ${what} feed could not be read`, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return out;
}

export async function extractStanleyMartin(params: { url?: string }): Promise<NormalizedPlan[]> {
  const url = params.url?.trim();
  if (!url) throw new Error("the Stanley Martin extractor needs the community's page (extractor_params.url)");
  const community = communityOf(url);
  if (!community) throw new Error(`${url} names no community id — not a Stanley Martin community page?`);
  const hood = await postFeed<SmNeighborhood>(community.origin, "neighborhood", { id: community.id }, community.page);
  const floorplans = (hood.floorplans ?? []).filter((fp) => clean(fp.name));
  const listings = (hood.listings ?? []).filter((l) => l.id != null);
  if (!floorplans.length && !listings.length) throw new Error(`no plans or homes in Stanley Martin's feed for community ${community.id}`);

  const [planDetails, homeDetails] = await Promise.all([
    eachDetail(floorplans, (fp) => postFeed<SmFloorplanDetail>(community.origin, "floorplan", { projectGroupId: community.id, productId: clean(fp.productId) }, community.page), "floor plan"),
    eachDetail(listings, (l) => postFeed<SmListingDetail>(community.origin, "listing", { saleId: String(l.id) }, community.page), "home"),
  ]);
  const plans = floorplans.map((fp, i) => planFrom(fp, community, planDetails[i]));
  const homes = listings.map((l, i) => homeFrom(l, community, homeDetails[i]));
  const byKey = new Map<string, NormalizedPlan>();
  for (const p of [...plans, ...homes]) if (p && !byKey.has(p.planKey)) byKey.set(p.planKey, p);
  return [...byKey.values()];
}
