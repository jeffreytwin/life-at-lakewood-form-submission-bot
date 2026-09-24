// Lennar extractor (json_api): community pages embed Apollo state in
// __NEXT_DATA__ (props.pageProps.initialApolloState). PlanType entities are
// base plans; HomesiteType entities are quick move-in inventory referencing
// their plan. Supports params.url or params.urls[] (series/collection pages
// merged, deduped by planKey).
//
// A community page carries a plan in brief — its hero picture and the
// first of its elevations (the cache key is `elevationImages({"first":1})`,
// which is why a plan used to arrive with one picture and no drawing).
// Each plan's own page carries it whole: every elevation, a walkthrough of
// named rooms each with its picture, the floor plan drawings, the builder's
// overview, the garages and the tour (Prosperity Lakes, 2026-09-23). So
// every plan's page is read too — a plain fetch and a parse, no model.

import { classifyRoom, orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";
import { standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type ApolloEntity = Record<string, unknown>;
type Apollo = Record<string, ApolloEntity>;

const money = (n: unknown) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;

/** An image node's address, however Lennar nests it: {url}, {image: {url}}, or a floor's {default: {image: {url}}}. */
const imgUrl = (node: unknown): string | null => {
  const n = node as { image?: { url?: string }; url?: string; default?: { image?: { url?: string } } } | null;
  return n?.image?.url ?? n?.url ?? n?.default?.image?.url ?? null;
};

/** A field of an Apollo entity, including one cached under arguments: `elevationImages({"first":1})`. */
function field(e: ApolloEntity, name: string): unknown {
  if (e[name] !== undefined) return e[name];
  const key = Object.keys(e).find((k) => k.startsWith(`${name}(`));
  return key ? e[key] : undefined;
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * What a community says it builds — its `types` and its name ("The
 * Townhomes", "Veranda Condominiums", "Coach Homes") — as the site's home
 * type. Exported for tests.
 */
export function communityHomeType(community: ApolloEntity | undefined): string | null {
  if (!community) return null;
  const types = list(community.types)
    .map((t) => (typeof t === "string" ? t : typeof t === "object" && t ? Object.values(t).filter((v) => typeof v === "string").join(" ") : ""))
    .join(" ")
    .replace(/_/g, " ");
  // The collection's name first: "Coach Homes" says more than "Single Family".
  const name = String(community.name ?? "");
  // Lennar's condominiums go by the names of their buildings: the "Veranda"
  // and "Terrace" collections at Calusa Country Club (2026-09-23).
  const condominium = /\b(veranda|terrace)\b/i.test(name) ? "Condominium" : null;
  return standardHomeType(name) ?? condominium ?? standardHomeType(types);
}

/**
 * A plan's pictures in the site's order: the first elevation leads (the
 * front of the house), then each room of the walkthrough by its name, the
 * hero where it is not already one of them, and the other elevations last.
 * Exported for tests.
 */
export function planGallery(e: ApolloEntity): { urls: string[]; meta: NonNullable<NormalizedPlan["galleryMeta"]> } {
  const items: GalleryInput[] = [];
  const elevations = list(field(e, "elevationImages"))
    .map((el) => ({ src: imgUrl(el), caption: String((el as { title?: string })?.title ?? "") || null }))
    .filter((el): el is { src: string; caption: string | null } => Boolean(el.src));
  if (elevations[0]) items.push({ src: elevations[0].src, kind: "primary", caption: elevations[0].caption });
  const walkthrough = field(e, "walkthrough") as { allRooms?: unknown[] } | null | undefined;
  for (const room of list(walkthrough?.allRooms)) {
    const r = room as { name?: string; content?: { hero?: unknown; roomImageGallery?: unknown[] } };
    const name = String(r.name ?? "");
    const kind = classifyRoom(name);
    for (const picture of [r.content?.hero, ...list(r.content?.roomImageGallery)]) {
      const src = imgUrl(picture);
      if (src) items.push({ src, caption: name || null, room: kind });
    }
  }
  const hero = imgUrl(field(e, "heroImage"));
  if (hero) {
    const alt = String((field(e, "heroImage") as { alt?: string } | null)?.alt ?? "");
    items.push({ src: hero, caption: alt || null });
  }
  for (const el of elevations.slice(1)) items.push({ src: el.src, kind: "exterior", caption: el.caption });
  const ordered = orderGallery(items);
  return { urls: ordered.urls, meta: ordered.meta };
}

/** A plan's floor plan drawings: each floor's drawing, then its reversed version. Exported for tests. */
export function planDrawings(e: ApolloEntity): string[] {
  const out: string[] = [];
  for (const floor of list(field(e, "floorplans"))) {
    const f = floor as { default?: unknown; reversed?: unknown };
    for (const src of [imgUrl(f.default) ?? imgUrl(floor), imgUrl(f.reversed)]) {
      if (src && !out.includes(src)) out.push(src);
    }
  }
  return out;
}

export function plansFromPage(apollo: Apollo, pagePath: string): NormalizedPlan[] {
  const out: NormalizedPlan[] = [];
  const planNames = new Map<string, string>();
  const planTypes = new Map<string, string | null>();

  for (const [key, e] of Object.entries(apollo)) {
    if (!key.startsWith("PlanType:")) continue;
    const url = String(e.url ?? "");
    if (!url.startsWith(pagePath)) continue; // only this community's plans
    const name = String(e.name ?? "").trim();
    if (!name) continue;
    planNames.set(key, name);
    const communityRef = (e.community as { __ref?: string } | null)?.__ref;
    const homeType = communityHomeType(communityRef ? apollo[communityRef] : undefined);
    planTypes.set(key, homeType);
    const gallery = planGallery(e);
    const garages = e.garages != null ? String(e.garages) : null;
    const tour = typeof e.virtualTourUrl === "string" && e.virtualTourUrl ? e.virtualTourUrl : null;
    out.push({
      planKey: normKey(name),
      name,
      price: typeof e.startingPrice === "number" && e.startingPrice > 0 ? e.startingPrice : null,
      priceDisplay: money(e.startingPrice),
      beds: e.beds != null ? String(e.beds) : "",
      baths: e.halfBaths ? `${e.baths}.5` : e.baths != null ? String(e.baths) : "",
      sqft: typeof e.sqft === "number" ? e.sqft : null,
      garages: garages ? `${garages} car` : null,
      homeType,
      quickMoveIn: false,
      comingSoon: String(e.status ?? "").toLowerCase().includes("coming"),
      sourceUrl: `https://www.lennar.com${url}`,
      description: typeof e.overview === "string" && e.overview.trim() ? e.overview.trim() : null,
      virtualTourUrl: tour,
      galleryImages: gallery.urls,
      galleryMeta: gallery.meta,
      blueprintImages: planDrawings(e),
      raw: { lennarId: e.id, planId: key },
    });
  }

  for (const [key, e] of Object.entries(apollo)) {
    if (!key.startsWith("HomesiteType:")) continue;
    const planRef = (e.plan as { __ref?: string } | null)?.__ref;
    const planName = planRef ? planNames.get(planRef) : null;
    if (!planName) continue; // only homesites for this community's plans
    const address = String(e.address ?? e.streetAddress ?? "").trim();
    const name = address || `${planName} (Quick Move-In ${String(e.id ?? "")})`;
    const price = typeof e.price === "number" && e.price > 0 ? e.price
      : typeof e.wasPrice === "number" && e.wasPrice > 0 ? e.wasPrice : null;
    const photo = imgUrl(e.elevationImage);
    out.push({
      planKey: normKey(name),
      name,
      price,
      priceDisplay: money(price),
      beds: e.beds != null ? String(e.beds) : "",
      baths: e.halfBaths ? `${e.baths}.5` : e.baths != null ? String(e.baths) : "",
      sqft: typeof e.sqft === "number" ? e.sqft : null,
      garages: null,
      homeType: planRef ? planTypes.get(planRef) ?? null : null,
      quickMoveIn: true,
      comingSoon: false,
      sourceUrl: e.url ? `https://www.lennar.com${e.url}` : null,
      galleryImages: photo ? [photo] : [],
      blueprintImages: [],
      raw: { lennarId: e.id, relatedPlan: planName, planId: planRef },
    });
  }
  return out;
}

/** The Apollo state a Lennar page carries. */
async function apolloOf(url: string): Promise<{ apollo: Apollo; path: string; html: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no __NEXT_DATA__ at ${url}`);
  const apollo = JSON.parse(m[1])?.props?.pageProps?.initialApolloState;
  if (!apollo) throw new Error(`no initialApolloState at ${url}`);
  return { apollo, path: new URL(res.url || url).pathname, html };
}

/**
 * The pages one level beneath a community that a page links to: its
 * series. A community Lennar has split into collections keeps no plans of
 * its own, and its old address sends a visitor to the region's page —
 * Aurora became "Townhomes" and "Patio Homes", Lorraine Lakes "Executive",
 * "Estate" and "Manor" homes (2026-09-23). Exported for tests.
 */
export function seriesLinks(html: string, communityPath: string): string[] {
  const path = communityPath.replace(/\/+$/, "");
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = new Set<string>();
  for (const m of html.matchAll(new RegExp(`${escaped}/([a-z0-9][a-z0-9-]*)(?=[\\\\"'?#])`, "g"))) {
    out.add(`https://www.lennar.com${path}/${m[1]}`);
  }
  return [...out];
}

/**
 * A community's series pages: those the page it landed on links to, and
 * those the city's page lists beneath it (a region's page may show only
 * some of them).
 */
async function seriesOf(target: string, landing: string): Promise<string[]> {
  const path = new URL(target).pathname.replace(/\/+$/, "");
  const parent = path.slice(0, path.lastIndexOf("/"));
  let city = "";
  try {
    const res = await fetch(`https://www.lennar.com${parent}`, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) city = await res.text();
  } catch {
    // The landing page's links are all there is.
  }
  return [...new Set([...seriesLinks(landing, path), ...seriesLinks(city, path)])];
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
 * A base plan with what its own page adds: the whole gallery, the
 * drawings, the overview, the garages and the tour. The community page's
 * facts stand; a page that will not load leaves the plan as the list had
 * it, marked unread so the diff keeps what an earlier run found.
 */
async function withPlanPage(plan: NormalizedPlan): Promise<NormalizedPlan> {
  if (plan.quickMoveIn || !plan.sourceUrl) return plan;
  try {
    const { apollo, path } = await apolloOf(plan.sourceUrl);
    const whole = plansFromPage(apollo, path).find((p) => !p.quickMoveIn && p.planKey === plan.planKey);
    if (!whole) return plan;
    return {
      ...plan,
      galleryImages: whole.galleryImages.length ? whole.galleryImages : plan.galleryImages,
      galleryMeta: whole.galleryImages.length ? whole.galleryMeta : plan.galleryMeta,
      blueprintImages: whole.blueprintImages.length ? whole.blueprintImages : plan.blueprintImages,
      description: plan.description ?? whole.description ?? null,
      garages: plan.garages ?? whole.garages,
      virtualTourUrl: plan.virtualTourUrl ?? whole.virtualTourUrl ?? null,
      homeType: plan.homeType ?? whole.homeType,
    };
  } catch {
    return { ...plan, pageUnread: true };
  }
}

export async function extractLennar(params: {
  url?: string;
  urls?: string[];
}): Promise<NormalizedPlan[]> {
  const targets = params.urls?.length ? params.urls : params.url ? [params.url] : [];
  if (!targets.length) throw new Error("lennar extractor requires extractor_params.url");
  const byKey = new Map<string, NormalizedPlan>();
  const keep = (plans: NormalizedPlan[]) => {
    for (const plan of plans) if (!byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
  };
  for (const target of targets) {
    const { apollo, path, html } = await apolloOf(target);
    const plans = plansFromPage(apollo, path);
    keep(plans);
    if (plans.length) continue;
    // Nothing here: the community has been split into series.
    for (const series of (await seriesOf(target, html)).slice(0, 8)) {
      try {
        const page = await apolloOf(series);
        keep(plansFromPage(page.apollo, page.path));
      } catch {
        // A series page that will not load is left for the next run.
      }
    }
  }
  return withPlanPictures(await mapLimit([...byKey.values()], 6, withPlanPage));
}

/**
 * Each home with its plan's pictures after its own. A homesite's page shows
 * the home's elevation and then its plan's whole gallery ("+13 photos" on
 * 6028 Mound Key Run, whose plan, The Princeton, has twelve), and carries
 * nothing else; the plan's page has already been read, so the home is
 * given what it shows without reading its page (Calusa Country Club,
 * 2026-09-23). The plan's drawings and tour are the home's too. Exported
 * for tests.
 */
export function withPlanPictures(plans: NormalizedPlan[]): NormalizedPlan[] {
  const byId = new Map(plans.filter((p) => !p.quickMoveIn && p.raw?.planId).map((p) => [String(p.raw!.planId), p]));
  return plans.map((home) => {
    if (!home.quickMoveIn) return home;
    const plan = home.raw?.planId ? byId.get(String(home.raw.planId)) : undefined;
    if (!plan?.galleryImages.length) return home;
    const own = home.galleryImages[0];
    const galleryImages = [...new Set([...(own ? [own] : []), ...plan.galleryImages])];
    const galleryMeta: NonNullable<NormalizedPlan["galleryMeta"]> = {};
    for (const src of galleryImages) {
      const meta = plan.galleryMeta?.[src];
      // The home's own front leads; the plan's front is one of its elevations here.
      if (src === own) galleryMeta[src] = { caption: null, room: "primary", kind: "primary" };
      else if (meta?.kind === "primary") galleryMeta[src] = { ...meta, room: "exterior", kind: "exterior" };
      else if (meta) galleryMeta[src] = meta;
    }
    return {
      ...home,
      galleryImages,
      galleryMeta,
      blueprintImages: home.blueprintImages.length ? home.blueprintImages : plan.blueprintImages,
      virtualTourUrl: home.virtualTourUrl ?? plan.virtualTourUrl ?? null,
      description: home.description ?? plan.description ?? null,
    };
  });
}
