// Lennar extractor (json_api): community pages embed Apollo state in
// __NEXT_DATA__ (props.pageProps.initialApolloState). PlanType entities are
// base plans (with garages, heroImage/elevationImages photos and floorplans
// blueprints); HomesiteType entities are quick move-in inventory referencing
// their plan. Supports params.url or params.urls[] (series/collection pages
// merged, deduped by planKey).

import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type ApolloEntity = Record<string, unknown>;
const money = (n: unknown) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;
const imgUrl = (node: unknown): string | null => {
  const n = node as { image?: { url?: string }; url?: string } | null;
  return n?.image?.url ?? n?.url ?? null;
};

function plansFromPage(apollo: Record<string, ApolloEntity>, pagePath: string): NormalizedPlan[] {
  const out: NormalizedPlan[] = [];
  const planNames = new Map<string, string>();

  for (const [key, e] of Object.entries(apollo)) {
    if (!key.startsWith("PlanType:")) continue;
    const url = String(e.url ?? "");
    if (!url.startsWith(pagePath)) continue; // only this community's plans
    const name = String(e.name ?? "").trim();
    if (!name) continue;
    planNames.set(key, name);
    const photos = [
      imgUrl(e.heroImage),
      ...((e.elevationImages as unknown[]) ?? []).map(imgUrl),
    ].filter((u, i, a): u is string => Boolean(u) && a.indexOf(u) === i);
    const blueprints = ((e.floorplans as unknown[]) ?? [])
      .map(imgUrl)
      .filter((u): u is string => Boolean(u));
    const garages = e.garages != null ? String(e.garages) : null;
    out.push({
      planKey: normKey(name),
      name,
      price: typeof e.startingPrice === "number" ? e.startingPrice : null,
      priceDisplay: money(e.startingPrice),
      beds: e.beds != null ? String(e.beds) : "",
      baths: e.halfBaths ? `${e.baths}.5` : e.baths != null ? String(e.baths) : "",
      sqft: typeof e.sqft === "number" ? e.sqft : null,
      garages: garages ? `${garages} car` : null,
      homeType: null,
      quickMoveIn: false,
      comingSoon: String(e.status ?? "").toLowerCase().includes("coming"),
      sourceUrl: `https://www.lennar.com${url}`,
      galleryImages: photos,
      blueprintImages: blueprints,
      raw: { lennarId: e.id },
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
      baths: e.baths != null ? String(e.baths) : "",
      sqft: typeof e.sqft === "number" ? e.sqft : null,
      garages: null,
      homeType: null,
      quickMoveIn: true,
      comingSoon: false,
      sourceUrl: e.url ? `https://www.lennar.com${e.url}` : null,
      galleryImages: photo ? [photo] : [],
      blueprintImages: [],
      raw: { lennarId: e.id, relatedPlan: planName },
    });
  }
  return out;
}

export async function extractLennar(params: {
  url?: string;
  urls?: string[];
}): Promise<NormalizedPlan[]> {
  const targets = params.urls?.length ? params.urls : params.url ? [params.url] : [];
  if (!targets.length) throw new Error("lennar extractor requires extractor_params.url");
  const byKey = new Map<string, NormalizedPlan>();
  for (const target of targets) {
    const res = await fetch(target, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`fetch ${target}: ${res.status}`);
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error(`no __NEXT_DATA__ at ${target}`);
    const apollo = JSON.parse(m[1])?.props?.pageProps?.initialApolloState;
    if (!apollo) throw new Error(`no initialApolloState at ${target}`);
    for (const plan of plansFromPage(apollo, new URL(res.url).pathname)) {
      if (!byKey.has(plan.planKey)) byKey.set(plan.planKey, plan);
    }
  }
  return [...byKey.values()];
}
