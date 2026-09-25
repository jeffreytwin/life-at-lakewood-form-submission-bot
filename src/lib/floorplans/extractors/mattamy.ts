// Mattamy extractor (json_api): the Sitecore JSS layout service exposes a
// /search-data route (public sc_apikey from the site bundle) whose Search
// component fields carry planCards and qmiCards for entire markets. Plan
// cards: title = plan name; QMI cards: title = street address with the
// base plan in planName. Cards carry a community page path in `url`, so a
// connection is scoped by its community page URL prefix. Structure
// captured in pipeline/slice/discovery/round7/mattamy-search.*.

import { classifyRoom, orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { standardHomeType } from "@/lib/floorplans/standardize";
import { type GalleryMeta, type NormalizedPlan, normKey } from "@/lib/floorplans/types";

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
  homeType?: string | null;
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
    homeType: standardHomeType(card.homeType ?? null),
    quickMoveIn,
    comingSoon: !price && /coming soon/i.test(card.price?.noPriceText ?? ""),
    sourceUrl: card.url ? `https://mattamyhomes.com${card.url}` : null,
    galleryImages: image ? [image] : [],
    blueprintImages: [],
    raw: {
      mattamyId: card.id,
      cardImage: image,
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
  // The community by the last two parts of its address — "wellen-park/
  // sunstone" — not the whole of it: Mattamy renamed its market in the path
  // ("sarasota-bradenton" became "sarasota", 2026-09-23) and every card of
  // a saved connection stopped matching. "sunstone-lakeside" is its own.
  const tail = communityPath.replace(/\/$/, "").toLowerCase().split("/").filter(Boolean).slice(-2).join("/");
  const out: NormalizedPlan[] = [];
  for (const [key, quickMoveIn] of [
    ["planCards", false],
    ["qmiCards", true],
  ] as const) {
    for (const card of fields[key]?.value ?? []) {
      if (!card || typeof card !== "object") continue;
      const url = (card.url ?? "").toLowerCase().replace(/\/$/, "");
      if (!tail || !(url.endsWith("/" + tail) || url.includes("/" + tail + "/"))) continue;
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
  // Where the saved address leads now, in case the site has moved it.
  const communityPath = await fetch(params.url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) })
    .then((r) => new URL(r.url || params.url!).pathname)
    .catch(() => new URL(params.url!).pathname);
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
  return mapLimit([...byKey.values()], 6, withPlanLayout);
}

interface LayoutComponent {
  componentName?: string;
  fields?: Record<string, { value?: unknown } | undefined>;
  placeholders?: Record<string, LayoutComponent[]>;
}

interface LayoutMedia {
  type?: string;
  src?: string;
  alt?: string;
  title?: string;
  /** The room Mattamy files the picture under: "Exterior", "Kitchen". */
  description?: string;
}

/** Every component of a layout, however deep its placeholders nest them. */
function componentsOf(list: LayoutComponent[] | undefined): LayoutComponent[] {
  const out: LayoutComponent[] = [];
  for (const c of list ?? []) {
    out.push(c);
    for (const inner of Object.values(c.placeholders ?? {})) out.push(...componentsOf(inner));
  }
  return out;
}

/**
 * The address a tour item of Mattamy's gallery opens: the page its iframe
 * shows ("<iframe … src='https://my.matterport.com/show/?m=of1T1UYQHiB'>"),
 * or the address itself where it gives one. Null for anything else. Pure;
 * exported for tests.
 */
export function tourAddress(src: string | null | undefined): string | null {
  const text = (src ?? "").trim();
  const framed = text.match(/\bsrc\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  const url = (framed ?? text).trim().replace(/&amp;/g, "&");
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/**
 * What a plan's own page carries, read from the layout service that draws
 * it (sitecore/api/layout/render/jss?item=<plan path>): its hero, the
 * gallery's pictures each with the room Mattamy names in its alt text
 * ("Kitchen", "Dining"), the exterior styles, the floor plan drawing, and
 * the product line ("Attached Villa") — Anclote at Sunstone, 2026-09-23.
 * The search cards carry one picture and no type. And its virtual tour:
 * the gallery's "360 Tours" tab is an item of type "tour" holding the
 * Matterport it embeds (Carmel II at Lakespur, Jeff, 2026-09-24); its
 * "Videos" tab, a Vimeo, is not one. Pure; exported for tests.
 */
export function readPlanLayout(data: unknown): {
  photos: string[];
  meta: NonNullable<NormalizedPlan["galleryMeta"]>;
  drawings: string[];
  homeType: string | null;
  tour: string | null;
} {
  const route = (data as { sitecore?: { route?: LayoutComponent & { fields?: Record<string, unknown> } } })?.sitecore?.route;
  const components = componentsOf(Object.values(route?.placeholders ?? {}).flat());
  const media = (c: LayoutComponent) => {
    const v = c.fields?.media?.value;
    return Array.isArray(v) ? (v as LayoutMedia[]) : [];
  };
  const items: GalleryInput[] = [];
  const drawings: string[] = [];
  let tour: string | null = null;
  // The exterior styles, known before the gallery is read: a style's
  // rendering the gallery shows too is still a style, not a photo, when
  // its first appearance is the one kept (orderGallery). 11898 Mandala Ct's
  // "Topsail Craftsman" is both (2026-09-25).
  const styleUrls = new Set(
    components.flatMap((c) => {
      const styles = c.fields?.styles?.value;
      return Array.isArray(styles) ? (styles as { imageUrl?: string }[]).map((st) => st.imageUrl ?? "").filter(Boolean) : [];
    })
  );
  for (const c of components) {
    if (c.componentName === "TitleDetailsBlock") {
      const hero = (c.fields?.image?.value as { src?: string; alt?: string } | undefined)?.src;
      if (hero) items.unshift({ src: hero, kind: "primary", caption: null });
    }
    for (const m of media(c)) {
      if (!m.src) continue;
      if (m.type === "floorplan") {
        if (!drawings.includes(m.src)) drawings.push(m.src);
      } else if (m.type === "tour") {
        tour = tour ?? tourAddress(m.src);
      } else if (m.type === "image") {
        const caption = (m.alt || m.title || "").trim() || null;
        // The room Mattamy files the picture under ("Exterior", "Kitchen"),
        // then its prose; one that names none leaves the file name to be
        // read. Isle Royal's alt reads "Model photos Lakeside in Sunstone
        // Isle Royal" on eighteen pictures of eighteen rooms (2026-09-23).
        const filed = (m.description ?? "").trim();
        const room = (filed && classifyRoom(filed)) || (caption && classifyRoom(caption)) || undefined;
        // A rendering Mattamy files as an elevation ("Craftsman Elevation")
        // is the house as built, a style like those listed apart: a home's
        // page lists no styles and files its own this way (11898 Mandala
        // Ct, 2026-09-25).
        if (styleUrls.has(m.src) || /\belevation\b/i.test(filed)) items.push({ src: m.src, kind: "exterior", caption: caption ?? (filed || null) });
        else items.push({ src: m.src, caption: caption ?? (filed || null), room });
      }
    }
    const styles = c.fields?.styles?.value;
    if (Array.isArray(styles)) {
      for (const style of styles as { imageUrl?: string; imageCaption?: string }[]) {
        if (style.imageUrl) items.push({ src: style.imageUrl, kind: "exterior", caption: style.imageCaption ?? null });
      }
    }
  }
  const ordered = orderGallery(items);
  const field = (name: string) => route?.fields?.[name] as { displayName?: string; fields?: { homeType?: { value?: string } } } | undefined;
  const homeType =
    standardHomeType(field("Product Line")?.displayName ?? null) ??
    standardHomeType(field("Home Type")?.fields?.homeType?.value ?? field("Home Type")?.displayName ?? null);
  return { photos: ordered.urls, meta: ordered.meta, drawings, homeType, tour };
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

/**
 * A home's pictures led by the house itself. A home's page leads with the
 * model's pictures — 11898 Mandala Ct's with a staged great room and the
 * Anclote model's front porch, a house at another address — and files the
 * rendering of the home itself, "Craftsman Elevation", among them (Jeff,
 * 2026-09-25). A page that shows one elevation is showing this home's;
 * one that shows several, or none, leaves the card's picture to lead. The
 * page's lead goes back among the photos for the sorter to place. Pure;
 * exported for tests.
 */
export function ledByHome(
  card: string | undefined,
  photos: string[],
  meta: Record<string, GalleryMeta>
): { photos: string[]; meta: Record<string, GalleryMeta> } {
  const styles = photos.filter((u) => meta[u]?.kind === "exterior");
  const lead = styles.length === 1 ? styles[0] : card;
  if (!lead || !photos.length) return { photos, meta };
  const demoted = Object.fromEntries(
    Object.entries(meta).map(([src, m]) => [src, src !== lead && m.kind === "primary" ? { ...m, kind: "photo" as const, room: null } : m])
  );
  return {
    photos: [lead, ...photos.filter((u) => u !== lead)],
    meta: { ...demoted, [lead]: { ...meta[lead], kind: "primary" as const, room: "primary" as const } },
  };
}

/**
 * A plan or a home with what its own page's layout adds; a layout that
 * will not load leaves it as its card had it, marked unread. A home's page
 * carries its own gallery — its kitchen, its dining room, staged — where
 * its card carried one picture (5038 125th Avenue E. at Windwater,
 * 2026-09-23).
 */
async function withPlanLayout(plan: NormalizedPlan): Promise<NormalizedPlan> {
  if (!plan.sourceUrl) return plan;
  const path = new URL(plan.sourceUrl).pathname;
  try {
    const res = await fetch(
      `https://mattamyhomes.com/sitecore/api/layout/render/jss?item=${encodeURIComponent(path)}&sc_apikey=${SC_APIKEY}`,
      { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30_000) }
    );
    if (!res.ok) throw new Error(`layout ${path}: ${res.status}`);
    const page = readPlanLayout(await res.json());
    const { photos, meta } = plan.quickMoveIn ? ledByHome(plan.galleryImages[0], page.photos, page.meta) : page;
    return {
      ...plan,
      galleryImages: photos.length ? photos : plan.galleryImages,
      galleryMeta: photos.length ? meta : plan.galleryMeta,
      blueprintImages: page.drawings.length ? page.drawings : plan.blueprintImages,
      homeType: plan.homeType ?? page.homeType,
      virtualTourUrl: plan.virtualTourUrl ?? page.tour,
    };
  } catch {
    return { ...plan, pageUnread: true };
  }
}
