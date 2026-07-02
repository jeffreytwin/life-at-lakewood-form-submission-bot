// Toll Brothers extractor (json_api): community pages embed complete
// model/QMI data in __NEXT_DATA__ (masterCommunityComponent.homes.models).
// Photos and blueprint drawings arrive pre-separated (headShot/media vs the
// floorplans array), which maps directly onto galleryImages/blueprintImages.

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
  const data = JSON.parse(m[1]);
  const models: TollModel[] | undefined =
    data?.props?.pageProps?.pageData?.masterCommunityComponent?.homes?.models;
  if (!Array.isArray(models)) throw new Error("homes.models missing from __NEXT_DATA__");
  return models.map(normalizeModel).filter((p) => p.planKey);
}
