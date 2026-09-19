// Toll Brothers extractor (json_api): community pages embed complete
// model/QMI data in __NEXT_DATA__. Master community pages carry the
// aggregate base models at masterCommunityComponent.homes.models plus a
// per-collection communities[] array whose models hold the quick move-in
// inventory in a qmis[] list (QMI subpages are separate URLs, but their
// data is embedded here in full). Collection pages carry the same shape
// under communityComponent instead.
//
// Media (Jeff, 2026-09-19): a model carries its primary picture (headShot),
// its alternative exterior designs (elevations: "Caribbean", "Island
// Colonial", "Antilles"), its 3D walkthrough (gallery.walkThroughs: a
// Matterport model id, or an InsideMaps link), a marketing description, and
// its blueprint drawings (floorplans). The "Media Showcase" of captioned
// interior photos (gallery.mediaGroups) is null on the community page and
// lives on the plan's own page, so the extractor reads each plan's page
// after the community page and merges it in. Photos are ordered by room
// (gallery-order.ts) with the exteriors last.

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";
import { orderGallery, type GalleryInput } from "@/lib/floorplans/gallery-order";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface TollMedia {
  type?: string;
  url?: string;
  link?: string;
  title?: string;
  description?: string;
  name?: string;
}

interface TollGallery {
  title?: string | null;
  mediaGroups?: { name?: string; title?: string; media?: TollMedia[] | null }[] | null;
  walkThroughs?: { name?: string; media?: TollMedia | string | null }[] | null;
}

interface TollModel {
  name?: string;
  homeType?: string;
  url?: string;
  minBed?: number;
  maxBed?: number;
  minBath?: number;
  maxBath?: number;
  minSqft?: number;
  minGarage?: string;
  pricedFrom?: number;
  isQMI?: boolean;
  isComingSoon?: boolean;
  masterPlanID?: number;
  commPlanID?: number;
  stories?: string;
  communityId?: number;
  headShot?: { title?: string; media?: TollMedia };
  media?: TollMedia;
  floorplans?: { url?: string }[];
  elevations?: TollMedia[] | null;
  gallery?: TollGallery | null;
  description?: string | null;
  // QMI-specific fields (entries inside a model's qmis[] list)
  address?: string;
  street?: string;
  modelName?: string;
  moveInDate?: string;
  lotNumber?: string;
  qmis?: TollModel[];
}

interface TollHomesContainer {
  homes?: { models?: TollModel[] };
  communities?: TollHomesContainer[];
}

const money = (n: number | undefined) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;

function range(min?: number, max?: number): string {
  if (min == null) return "";
  return max != null && max !== min ? `${min} - ${max}` : String(min);
}

/** The virtual tour a model's walkthrough entry points at, in the form the sites already use. */
export function virtualTourOf(gallery: TollGallery | null | undefined): { url: string | null; image: string | null } {
  for (const w of gallery?.walkThroughs ?? []) {
    const media = w?.media;
    if (!media || typeof media !== "object") continue;
    const type = (media.type ?? "").toLowerCase();
    if (!type.startsWith("walkthrough")) continue;
    const link = (media.link ?? "").trim();
    const image = media.url && /^https?:\/\//.test(media.url) ? media.url : null;
    // Matterport gives the model id alone; the legacy Lakewood rows carry it
    // as a share link with quickstart and autoplay, so match that form.
    if (type.includes("matterport") && link && !/^https?:\/\//.test(link)) {
      return { url: `https://my.matterport.com/show/?m=${encodeURIComponent(link)}&qs=1&play=1`, image };
    }
    if (/^https?:\/\//.test(link)) return { url: link, image };
  }
  return { url: null, image: null };
}

/** Every photo the model offers, in room order: headshot first, showcase photos by room, other exteriors last. */
export function galleryOf(m: TollModel): ReturnType<typeof orderGallery> {
  const items: GalleryInput[] = [];
  const primary = m.headShot?.media?.url ?? m.media?.url ?? null;
  if (primary) items.push({ src: primary, caption: m.headShot?.media?.title ?? m.media?.title ?? null, kind: "primary" });
  for (const group of m.gallery?.mediaGroups ?? []) {
    for (const media of group?.media ?? []) {
      if ((media?.type ?? "") !== "image" || !media?.url) continue;
      items.push({ src: media.url, caption: media.description ?? media.title ?? null, kind: "photo" });
    }
  }
  for (const e of m.elevations ?? []) {
    if ((e?.type ?? "image") !== "image" || !e?.url || e.url === primary) continue;
    items.push({ src: e.url, caption: e.title ?? null, kind: "exterior" });
  }
  return orderGallery(items);
}

function normalizeModel(m: TollModel): NormalizedPlan {
  const gallery = galleryOf(m);
  const tour = virtualTourOf(m.gallery);
  const blueprints = (m.floorplans ?? [])
    .map((fp) => fp?.url)
    .filter((u): u is string => Boolean(u));
  const garage = m.minGarage ? String(parseFloat(m.minGarage)) : null;
  return {
    planKey: normKey(m.name ?? ""),
    name: m.name ?? "",
    price: typeof m.pricedFrom === "number" ? m.pricedFrom : null,
    priceDisplay: money(m.pricedFrom),
    beds: range(m.minBed, m.maxBed),
    baths: range(m.minBath, m.maxBath),
    sqft: m.minSqft ?? null,
    garages: garage ? `${garage} car` : null,
    homeType: m.homeType ?? null,
    quickMoveIn: m.isQMI === true,
    comingSoon: m.isComingSoon === true,
    sourceUrl: m.url ?? null,
    galleryImages: gallery.urls,
    blueprintImages: blueprints,
    galleryMeta: gallery.meta,
    description: typeof m.description === "string" && m.description.trim() ? m.description.trim() : null,
    virtualTourUrl: tour.url,
    virtualTourImage: tour.image,
    raw: {
      masterPlanID: m.masterPlanID,
      commPlanID: m.commPlanID,
      stories: m.stories,
      communityId: m.communityId,
    },
  };
}

function normalizeQmi(q: TollModel): NormalizedPlan {
  const base = normalizeModel(q);
  const address = (q.address ?? q.street ?? "").trim();
  const name = address || `${q.modelName ?? q.name ?? "Home"} (Quick Move-In ${q.commPlanID ?? ""})`.trim();
  return {
    ...base,
    planKey: normKey(name),
    name,
    quickMoveIn: true,
    raw: {
      ...base.raw,
      relatedPlan: q.modelName ?? null,
      moveInDate: q.moveInDate ?? null,
      lotNumber: q.lotNumber ?? null,
    },
  };
}

/** Collect base models and every model's embedded QMI inventory. */
function collectPlans(container: TollHomesContainer | null | undefined): NormalizedPlan[] {
  if (!container) return [];
  const out: NormalizedPlan[] = [];
  const modelLists = [
    container.homes?.models ?? [],
    ...(container.communities ?? []).map((c) => c?.homes?.models ?? []),
  ];
  for (const models of modelLists) {
    for (const m of models) {
      // Base plan (nameless entries are QMI-only wrappers — skip the shell,
      // keep its qmis).
      const plan = normalizeModel(m);
      if (plan.planKey && !m.isQMI) out.push(plan);
      for (const q of m.qmis ?? []) {
        const qmi = normalizeQmi(q);
        if (qmi.planKey) out.push(qmi);
      }
    }
  }
  return out;
}

/** Pure mapping from a parsed __NEXT_DATA__ document to normalized plans. */
export function plansFromNextData(data: unknown): NormalizedPlan[] {
  const pageData = (data as {
    props?: { pageProps?: { pageData?: Record<string, unknown> } };
  })?.props?.pageProps?.pageData;
  // Master community pages embed everything (all collections + QMIs);
  // collection pages carry the same shape under communityComponent.
  const plans = [
    ...collectPlans(pageData?.masterCommunityComponent as TollHomesContainer | null),
    ...collectPlans(pageData?.communityComponent as TollHomesContainer | null),
  ];
  const byKey = new Map<string, NormalizedPlan>();
  for (const p of plans) if (!byKey.has(p.planKey)) byKey.set(p.planKey, p);
  return [...byKey.values()];
}

/**
 * The model object a plan page embeds: pageData.modelComponent, or failing
 * that whichever pageData component carries this plan's commPlanID.
 */
export function modelFromPlanPage(data: unknown, commPlanID: unknown): TollModel | null {
  const pageData = (data as { props?: { pageProps?: { pageData?: Record<string, unknown> } } })?.props?.pageProps?.pageData;
  if (!pageData) return null;
  const isModel = (v: unknown): v is TollModel =>
    !!v && typeof v === "object" && "gallery" in (v as object) && ("headShot" in (v as object) || "elevations" in (v as object));
  const direct = pageData.modelComponent;
  if (isModel(direct) && (commPlanID == null || direct.commPlanID == null || direct.commPlanID === commPlanID)) return direct;
  for (const v of Object.values(pageData)) {
    if (isModel(v) && commPlanID != null && v.commPlanID === commPlanID) return v;
  }
  return null;
}

/**
 * Merges what only the plan's own page knows (the captioned showcase
 * photos, and anything the community page left blank) into a plan built
 * from the community page. Pure; the community page's values win for the
 * scalar fields it already had.
 */
export function enrichPlanFromModelPage(plan: NormalizedPlan, data: unknown): NormalizedPlan {
  const model = modelFromPlanPage(data, plan.raw?.commPlanID);
  if (!model) return plan;
  const gallery = galleryOf(model);
  const tour = virtualTourOf(model.gallery);
  const blueprints = (model.floorplans ?? []).map((fp) => fp?.url).filter((u): u is string => Boolean(u));
  return {
    ...plan,
    galleryImages: gallery.urls.length ? gallery.urls : plan.galleryImages,
    galleryMeta: gallery.urls.length ? gallery.meta : plan.galleryMeta,
    blueprintImages: plan.blueprintImages.length ? plan.blueprintImages : blueprints,
    description: plan.description ?? (typeof model.description === "string" && model.description.trim() ? model.description.trim() : null),
    virtualTourUrl: plan.virtualTourUrl ?? tour.url,
    virtualTourImage: plan.virtualTourImage ?? tour.image,
  };
}

async function fetchNextData(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__ found (page structure changed?)");
  return JSON.parse(m[1]);
}

/** Plan pages read at once; Toll's CDN-fronted site answers these in about a second each. */
const PAGE_CONCURRENCY = 4;

/** Whether the community page already gave this plan showcase photos (beyond its headshot and exteriors). */
export const hasShowcase = (plan: NormalizedPlan): boolean =>
  Object.values(plan.galleryMeta ?? {}).some((m) => m.kind === "photo");

export async function extractTollBrothers(params: {
  url?: string;
}): Promise<NormalizedPlan[]> {
  if (!params?.url) throw new Error("toll-brothers extractor requires extractor_params.url");
  const plans = plansFromNextData(await fetchNextData(params.url));
  if (!plans.length) throw new Error("no models found in __NEXT_DATA__ (page structure changed?)");
  // A plan's own page carries its captioned showcase photos when it has
  // a set (quick move-ins already carry theirs in the community page, so
  // they are not read again). A page that fails leaves that plan with
  // what the community page gave it.
  const enriched = [...plans];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PAGE_CONCURRENCY, plans.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= plans.length) return;
        const plan = plans[index];
        if (!plan.sourceUrl || hasShowcase(plan)) continue;
        try {
          enriched[index] = enrichPlanFromModelPage(plan, await fetchNextData(plan.sourceUrl));
        } catch {
          // keep the community-page plan
        }
      }
    })
  );
  return enriched;
}
