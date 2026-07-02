// Toll Brothers extractor (json_api): community pages embed complete
// model/QMI data in __NEXT_DATA__. Master community pages carry the
// aggregate base models at masterCommunityComponent.homes.models plus a
// per-collection communities[] array whose models hold the quick move-in
// inventory in a qmis[] list (QMI subpages are separate URLs, but their
// data is embedded here in full). Collection pages carry the same shape
// under communityComponent instead. Photos and blueprint drawings arrive
// pre-separated (headShot/media vs the floorplans array), which maps
// directly onto galleryImages/blueprintImages.

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
  headShot?: { media?: { url?: string } };
  media?: { url?: string };
  floorplans?: { url?: string }[];
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

function normalizeModel(m: TollModel): NormalizedPlan {
  const photos: string[] = [];
  if (m.headShot?.media?.url) photos.push(m.headShot.media.url);
  if (m.media?.url && !photos.includes(m.media.url)) photos.push(m.media.url);
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
    galleryImages: photos,
    blueprintImages: blueprints,
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

export async function extractTollBrothers(params: {
  url?: string;
}): Promise<NormalizedPlan[]> {
  if (!params?.url) throw new Error("toll-brothers extractor requires extractor_params.url");
  const res = await fetch(params.url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${params.url}: ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__ found (page structure changed?)");
  const plans = plansFromNextData(JSON.parse(m[1]));
  if (!plans.length) throw new Error("no models found in __NEXT_DATA__ (page structure changed?)");
  return plans;
}
