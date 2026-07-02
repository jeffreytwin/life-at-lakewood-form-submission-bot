// Taylor Morrison extractor (json_api): community pages inline their full
// dataset as `window.TM.client.scDataStore.data = {…}` — the floor-plans
// page carries floorPlansListDataArray (base plans, price/spec ranges,
// series collections, photos) and the available-homes page carries
// availableHomesList.sections[].homes[] (QMIs with address, price, specs,
// ready dates). Plain fetch reads both pages fine; no Playwright needed.
// Structure captured in pipeline/slice/discovery/round7/taylor-*.

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface TmLink {
  Url?: string;
}

interface TmFloorPlan {
  floorPlanName?: string;
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
      floorPlansListDataArray?: TmFloorPlan[];
      floorPlanCollections?: { id?: string; name?: string }[];
      availableHomesList?: { sections?: { sectionLabel?: string; homes?: TmHome[] }[] };
    };
    for (const c of e.floorPlanCollections ?? []) {
      if (c?.id && c?.name) seriesNames.set(c.id, c.name);
    }

    for (const fp of e.floorPlansListDataArray ?? []) {
      if (!fp || typeof fp !== "object") continue;
      const name = (fp.floorPlanName ?? "").trim();
      if (!name) continue;
      const photos = (fp.floorPlanPhotosArray ?? [])
        .map((t) => (typeof t === "string" ? imgSrc(t, origin) : null))
        .filter((u, i, a): u is string => Boolean(u) && a.indexOf(u) === i);
      out.push({
        planKey: normKey(name),
        name,
        price: typeof fp.minPrice === "number" && fp.minPrice > 0 ? fp.minPrice : null,
        priceDisplay: money(fp.minPrice),
        beds: range(fp.minBed, fp.maxBed),
        baths: baths(fp.minFullBath, fp.maxFullBath, fp.minHalfBath, fp.maxHalfBath),
        sqft: typeof fp.minSqFt === "number" ? fp.minSqFt : null,
        garages: fp.minGarage != null ? `${range(fp.minGarage, fp.maxGarage)} car` : null,
        homeType: null,
        quickMoveIn: false,
        comingSoon: /coming soon|interest list/i.test(fp.priceOverrideText ?? ""),
        sourceUrl: abs(fp.floorPlanDetailsLink?.Url, origin),
        galleryImages: photos,
        blueprintImages: [],
        raw: {
          series: fp.floorPlanCollection ? seriesNames.get(fp.floorPlanCollection) ?? null : null,
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
          homeType: null,
          quickMoveIn: true,
          comingSoon: home.isComingSoon === true,
          sourceUrl: abs(link, origin),
          galleryImages: photo ? [photo] : [],
          blueprintImages: [],
          raw: {
            relatedPlan,
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
  return [...byKey.values()];
}
