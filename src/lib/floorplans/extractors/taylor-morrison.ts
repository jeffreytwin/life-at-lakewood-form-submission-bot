// Taylor Morrison extractor (json_api): community pages inline their full
// dataset as `window.TM.client.scDataStore.data = {…}` — the floor-plans
// page carries floorPlansListDataArray (base plans, price/spec ranges,
// series collections, one photo, the virtual tour link, the description)
// and the available-homes page carries availableHomesList.sections[].homes[]
// (QMIs with address, price, specs, ready dates, their collection). Plain
// fetch reads both pages fine; no Playwright needed. Structure captured in
// pipeline/slice/discovery/round7/taylor-*.
//
// The collection a plan belongs to says what it is (Jeff, 2026-09-21, at
// Esplanade at Azario): the "Twin Villa Collection" holds attached villas,
// everything else is single-family, and a townhome community says so in
// its own name.
//
// The listing carries one small photo per plan. The plan's own /gallery
// page (the plan page holds a shorter copy) files every picture by
// category: "Virtual Tour" (the Matterport link), "Interior", "Exteriors",
// "Floor Plan" (the drawings) and "Design Collections" (finish packages,
// left out on Jeff's word). Each base plan's gallery page is read on every
// run; a quick move-in keeps its listing photo.

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";
import { standardHomeType, type HomeType } from "@/lib/floorplans/standardize";
import { classifyRoom, fileNameWords, orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface TmLink {
  Url?: string;
}

interface TmFloorPlan {
  floorPlanName?: string;
  virtualTourLink?: string;
  minPrice?: number;
  minWasPrice?: number;
  priceOverrideText?: string;
  minSqFt?: number;
  maxSqFt?: number;
  minBed?: number;
  maxBed?: number;
  minFullBath?: string | number;
  maxFullBath?: string | number;
  minHalfBath?: number;
  maxHalfBath?: number;
  minGarage?: number;
  maxGarage?: number;
  minStory?: number;
  maxStory?: number;
  floorPlanDetailsLink?: TmLink;
  floorPlanDescription?: string;
  floorPlanPhotosArray?: string[];
  floorPlanHasModelHome?: boolean;
  AvailableHomesTotal?: number;
  floorPlanCollection?: string;
  uniqueSellingPoint?: string;
}

interface TmHome {
  address?: string;
  floorPlan?: string;
  floorPlanCollection?: string;
  homeSite?: string;
  isComingSoon?: boolean;
  homeReserved?: boolean;
  readyDate?: string;
  photo?: { Src?: string };
  viewHomeLink?: TmLink;
  sqft?: number;
  bed?: number;
  fullBath?: number;
  halfBath?: number;
  garages?: number;
  price?: number;
  community_Name?: string;
}

const money = (n: number | null | undefined) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;

function range(min?: number | null, max?: number | null): string {
  if (min == null || Number.isNaN(min)) return "";
  return max != null && !Number.isNaN(max) && max !== min ? `${min} - ${max}` : String(min);
}

/** Extract a balanced JSON object starting at the first "{" after `marker`. */
export function extractJsonAfter(html: string, marker: string): string | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

const imgSrc = (tag: string, origin: string): string | null => {
  const m = tag.match(/src=["']([^"']+)["']/i);
  if (!m) return null;
  const src = m[1].replace(/&amp;/g, "&");
  return src.startsWith("http") ? src : origin + src;
};

const abs = (url: string | undefined, origin: string): string | null =>
  url ? (url.startsWith("http") ? url : origin + url) : null;

/** The tour link as the sites use it: Matterport's "show?m=" form becomes "show/?m="; other links are kept as they came. */
export function tourUrl(link: string | null | undefined): string | null {
  const s = (link ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s.replace(/^(https?:\/\/my\.matterport\.com\/show)\?/i, "$1/?");
}

/** The home type a collection or community name says; single-family when neither says anything. */
export function homeTypeOf(collectionName: string | null | undefined, communityName: string | null | undefined): HomeType {
  return standardHomeType(collectionName) ?? standardHomeType(communityName) ?? "Single Family Home";
}

/** Marketing copy without its markup. */
const plainText = (html: string | null | undefined): string | null => {
  const text = (html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
};

function baths(minFull?: string | number, maxFull?: string | number, minHalf?: number, maxHalf?: number): string {
  const lo = minFull != null ? Number(minFull) + ((minHalf ?? 0) > 0 ? 0.5 : 0) : null;
  const hi = maxFull != null ? Number(maxFull) + ((maxHalf ?? 0) > 0 ? 0.5 : 0) : null;
  return range(lo, hi);
}

/** Map one scDataStore entry set to plans; exported for tests. */
export function plansFromScData(
  scData: Record<string, unknown>,
  origin: string,
  collections?: Map<string, string>
): NormalizedPlan[] {
  const out: NormalizedPlan[] = [];
  const seriesNames = collections ?? new Map<string, string>();

  for (const entry of Object.values(scData)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      communityName?: string;
      floorPlansListDataArray?: TmFloorPlan[];
      floorPlanCollections?: { id?: string; name?: string }[];
      availableHomesList?: { sections?: { sectionLabel?: string; homes?: TmHome[] }[] };
    };
    for (const c of e.floorPlanCollections ?? []) {
      if (c?.id && c?.name) seriesNames.set(c.id, c.name);
    }
    const communityName = (e.communityName ?? "").trim() || null;

    for (const fp of e.floorPlansListDataArray ?? []) {
      if (!fp || typeof fp !== "object") continue;
      const name = (fp.floorPlanName ?? "").trim();
      if (!name) continue;
      const photos = (fp.floorPlanPhotosArray ?? [])
        .map((t) => (typeof t === "string" ? imgSrc(t, origin) : null))
        .filter((u, i, a): u is string => Boolean(u) && a.indexOf(u) === i);
      const series = fp.floorPlanCollection ? seriesNames.get(fp.floorPlanCollection) ?? null : null;
      out.push({
        planKey: normKey(name),
        name,
        price: typeof fp.minPrice === "number" && fp.minPrice > 0 ? fp.minPrice : null,
        priceDisplay: money(fp.minPrice),
        beds: range(fp.minBed, fp.maxBed),
        baths: baths(fp.minFullBath, fp.maxFullBath, fp.minHalfBath, fp.maxHalfBath),
        sqft: typeof fp.minSqFt === "number" ? fp.minSqFt : null,
        garages: fp.minGarage != null ? `${range(fp.minGarage, fp.maxGarage)} car` : null,
        homeType: homeTypeOf(series, communityName),
        quickMoveIn: false,
        comingSoon: /coming soon|interest list/i.test(fp.priceOverrideText ?? ""),
        sourceUrl: abs(fp.floorPlanDetailsLink?.Url, origin),
        galleryImages: photos,
        blueprintImages: [],
        description: plainText(fp.floorPlanDescription),
        virtualTourUrl: tourUrl(fp.virtualTourLink),
        raw: {
          series,
          stories: range(fp.minStory, fp.maxStory) || null,
          hasModelHome: fp.floorPlanHasModelHome ?? null,
          availableHomes: fp.AvailableHomesTotal ?? null,
          priceOverrideText: fp.priceOverrideText || null,
        },
      });
    }

    for (const section of e.availableHomesList?.sections ?? []) {
      for (const home of section?.homes ?? []) {
        if (!home || typeof home !== "object") continue;
        const address = (home.address ?? "").trim();
        if (!address) continue;
        const link = home.viewHomeLink?.Url ?? "";
        const relatedPlan = link.match(/\/floor-plans\/([^/]+)\//)?.[1] ?? null;
        const photo = home.photo?.Src ? abs(home.photo.Src, origin) : null;
        const series = home.floorPlanCollection ? seriesNames.get(home.floorPlanCollection) ?? null : null;
        out.push({
          planKey: normKey(address),
          name: address,
          price: typeof home.price === "number" && home.price > 0 ? home.price : null,
          priceDisplay: money(home.price),
          beds: home.bed != null ? String(home.bed) : "",
          baths:
            home.fullBath != null
              ? (home.halfBath ?? 0) > 0
                ? `${home.fullBath}.5`
                : String(home.fullBath)
              : "",
          sqft: typeof home.sqft === "number" ? home.sqft : null,
          garages: home.garages != null ? `${home.garages} car` : null,
          homeType: homeTypeOf(series, (home.community_Name ?? "").trim() || communityName),
          quickMoveIn: true,
          comingSoon: home.isComingSoon === true,
          sourceUrl: abs(link, origin),
          galleryImages: photo ? [photo] : [],
          blueprintImages: [],
          raw: {
            relatedPlan,
            relatedPlanName: (home.floorPlan ?? "").trim() || null,
            series,
            homeSite: home.homeSite ?? null,
            readyDate: home.readyDate ?? null,
            reserved: home.homeReserved ?? null,
            section: section.sectionLabel ?? null,
          },
        });
      }
    }
  }
  return out;
}

interface TmGalleryImage {
  header?: string;
  subhead?: string;
  caption?: string;
  isTour?: boolean;
  vidSrc?: string;
  image?: { src?: string; alt?: string; srcSet?: { src?: string; descriptor?: string }[] | null } | null;
}

interface TmGalleryCategory {
  title?: string;
  images?: TmGalleryImage[];
}

/** The finish-package pictures a plan page shows under "Design Collections"; never a plan's own. */
const DESIGN_COLLECTIONS = /design collections?/i;

/**
 * A photo of the house from the street, which Taylor names for what it is
 * ("…-alta-model-2-ps-front-exterior.jpg"). The schematic elevations it
 * files beside them ("…alta_a_modern-mediterranean_sch_mm-1.jpg") are
 * renderings, so they are the fallback hero, not the first choice.
 */
const FRONT_EXTERIOR = /front[\s_-]?exterior|exterior[\s_-]?front/i;

/**
 * Marks the picture the sites lead with, and says whether it found one.
 *
 * Room order keeps every exterior last so a plan's extra elevations trail
 * (gallery-order.ts), which leaves the lead to whatever room ranks first —
 * the kitchen — unless one picture is marked the primary, the way Toll
 * Brothers marks each model's headshot. Taylor names no hero, so its own
 * front-exterior photo takes the slot, and failing that the first picture
 * it files under Exteriors (Jeff, 2026-09-21: plans with exteriors were
 * leading with an interior). Mutates in place; exported for tests.
 */
export function markHero(photos: GalleryInput[]): boolean {
  // Taylor files the odd interior under Exteriors — 13304 Santini Circle
  // leads that category with a living room — so a picture that names a
  // room of its own is passed over for the next one, and taken only if
  // every candidate does.
  const namesAnInterior = (p: GalleryInput) => {
    const room = classifyRoom(fileNameWords(p.src)) ?? classifyRoom(p.caption ?? "");
    return room != null && room !== "exterior";
  };
  const exteriors = photos.filter((p) => p.kind === "exterior");
  const hero =
    photos.find((p) => FRONT_EXTERIOR.test(`${p.src} ${p.caption ?? ""}`)) ??
    exteriors.find((p) => !namesAnInterior(p)) ??
    exteriors[0];
  if (!hero) return false;
  hero.kind = "primary";
  return true;
}

/**
 * The listing's own card picture as the hero, for a plan whose gallery
 * page offers no exterior at all: it is the builder's pick and the only
 * lead on offer. The same picture in another rendition is promoted where
 * it stands rather than repeated — Taylor serves one file at several
 * widths ("…-7750-16x9.jpg?mw=1800" and "?mw=900"). Exported for tests.
 */
export function withListingHero(
  photos: GalleryInput[],
  listingHero: string | undefined
): GalleryInput[] {
  if (!listingHero || photos.some((p) => p.kind === "primary")) return photos;
  const samePicture = (a: string, b: string) => {
    try {
      return new URL(a).pathname === new URL(b).pathname;
    } catch {
      return a === b;
    }
  };
  const already = photos.find((p) => samePicture(p.src, listingHero));
  if (already) {
    already.kind = "primary";
    return photos;
  }
  return [{ src: listingHero, kind: "primary", caption: null }, ...photos];
}

/** The largest rendition offered, else the picture as given; absolute. */
function bestImageSrc(im: TmGalleryImage, origin: string): string | null {
  const renditions = (im.image?.srcSet ?? [])
    .map((r) => ({ src: r?.src ?? "", width: parseInt((r?.descriptor ?? "").replace(/\D/g, ""), 10) || 0 }))
    .filter((r) => r.src);
  renditions.sort((a, b) => b.width - a.width);
  const src = (renditions[0]?.src || im.image?.src || "").replace(/&amp;/g, "&").trim();
  return src ? abs(src, origin) : null;
}

/** The builder's caption, unless it is only the file's name ("Esp at Azario LWR Roma 7750-16x9"). */
function captionOf(im: TmGalleryImage): string | null {
  const text = (im.caption ?? "").trim() || (im.subhead ?? "").trim();
  if (!text || /\b16x9\b|\d{3,}|\.(jpe?g|png|webp)$/i.test(text)) return null;
  return text;
}

export interface TaylorGallery {
  photos: GalleryInput[];
  blueprints: string[];
  tour: string | null;
}

/**
 * The plan's pictures as its gallery page files them, or null when the
 * page's data holds no gallery: interiors and exteriors as photos (the
 * exteriors marked so they trail), the "Floor Plan" drawings as blueprints,
 * the "Virtual Tour" entry's link as the tour, and nothing from "Design
 * Collections". Exported for tests.
 */
export function galleryFromScData(scData: Record<string, unknown>, origin: string): TaylorGallery | null {
  for (const entry of Object.values(scData)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { photos?: TmGalleryImage[]; imagesByCategory?: TmGalleryCategory[] };
    const categories: TmGalleryCategory[] = Array.isArray(e.imagesByCategory) && e.imagesByCategory.length
      ? e.imagesByCategory
      : Array.isArray(e.photos) && e.photos.length
        ? [{ title: "", images: e.photos }]
        : [];
    if (!categories.length) continue;
    const photos: GalleryInput[] = [];
    const blueprints: string[] = [];
    let tour: string | null = null;
    for (const cat of categories) {
      const title = (cat?.title ?? "").trim();
      for (const im of cat?.images ?? []) {
        if (!im || typeof im !== "object") continue;
        const section = title || (im.header ?? "").trim();
        if (DESIGN_COLLECTIONS.test(section) || DESIGN_COLLECTIONS.test(im.header ?? "")) continue;
        if (im.isTour || /virtual tour/i.test(section)) {
          tour = tour ?? tourUrl(im.vidSrc);
          continue;
        }
        const src = bestImageSrc(im, origin);
        if (!src) continue;
        if (/floor ?plans?/i.test(section)) {
          if (!blueprints.includes(src)) blueprints.push(src);
          continue;
        }
        const exterior = /exterior|elevation/i.test(section);
        photos.push({ src, kind: exterior ? "exterior" : "photo", caption: captionOf(im) });
      }
    }
    markHero(photos);
    return { photos, blueprints, tour };
  }
  return null;
}

/**
 * The plan with everything its own pages add: the gallery page's pictures
 * in the sites' order, the drawings, the tour. The plan page is read when
 * there is no gallery page. A page that cannot be read leaves the plan as
 * the listing had it. Also the page reader for stand-in plans built from a
 * quick move-in (sync.ts), whose home page files its pictures the same way.
 */
export async function readTaylorPlanPage(plan: NormalizedPlan): Promise<NormalizedPlan> {
  if (!plan.sourceUrl) return plan;
  const origin = new URL(plan.sourceUrl).origin;
  const base = plan.sourceUrl.replace(/\/gallery\/?$/, "").replace(/\/$/, "");
  let gallery: TaylorGallery | null = null;
  for (const url of [`${base}/gallery`, base]) {
    const scData = await fetchScData(url).catch(() => null);
    const found = scData ? galleryFromScData(scData, origin) : null;
    if (found && (found.photos.length || found.blueprints.length)) {
      gallery = found;
      break;
    }
    if (found && !gallery) gallery = found;
  }
  if (!gallery) return plan;
  const photos = gallery.photos.length ? gallery.photos : plan.galleryImages.map((src) => ({ src }));
  const ordered = orderGallery(withListingHero(photos, plan.galleryImages[0]));
  return {
    ...plan,
    galleryImages: ordered.urls.length ? ordered.urls : plan.galleryImages,
    galleryMeta: ordered.meta,
    blueprintImages: gallery.blueprints.length ? gallery.blueprints : plan.blueprintImages,
    virtualTourUrl: plan.virtualTourUrl ?? gallery.tour,
  };
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

async function fetchScData(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null; // some communities have no QMI page
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const html = await res.text();
  const raw = extractJsonAfter(html, "scDataStore.data =") ?? extractJsonAfter(html, "scDataStore.data=");
  if (!raw) throw new Error(`no scDataStore.data found at ${url} (page structure changed?)`);
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function extractTaylorMorrison(params: { url?: string }): Promise<NormalizedPlan[]> {
  if (!params?.url) throw new Error("taylor-morrison extractor requires extractor_params.url");
  // Accept the community base URL or any of its sub-pages.
  const base = params.url.replace(/\/(floor-plans|available-homes)\/?$/, "").replace(/\/$/, "");
  const origin = new URL(base).origin;
  const byKey = new Map<string, NormalizedPlan>();
  const collections = new Map<string, string>();
  for (const page of [`${base}/floor-plans`, `${base}/available-homes`]) {
    const scData = await fetchScData(page);
    if (!scData) continue;
    for (const plan of plansFromScData(scData, origin, collections)) {
      if (!byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
    }
  }
  // Every plan's own page: the supporting pictures, the drawings, the tour
  // (Jeff, 2026-09-21). A quick move-in's home page files its pictures the
  // same way, and the one photo the available-homes card gives it is
  // whichever of the base plan's pictures Taylor put on the card — a
  // kitchen or a living room as often as the house (Jeff, 2026-09-21), so
  // its page is read too. A home page with no gallery leaves the home as
  // the card had it, that card photo leading as the hero.
  const plans = [...byKey.values()];
  return mapLimit(plans, 4, (plan) => readTaylorPlanPage(plan));
}
