// KB Home extractor: a community's page draws its plan cards with
// scripts, so a fetch sees one price where a visitor sees ten, and Claude
// found no plans on it (Creekside at Rutland Ranch, 2026-09-23). The page
// carries every card's record in its own markup, though:
//
//   var FloorPlanList = [{"floorPlanID":"03012070-140.1286","title":"Plan 1286",
//     "pricedFrom":"329990","bedroomsMin":"3","bedroomsMax":"3","bathroomsMin":"2",
//     "garagesMin":"2","size":"1286","style":"Single Family","pageUrl":"/new-homes-…/plan-1286",
//     "thumbnailImage":{"image":"/globalassets/…/1286_a_sch1_shutters.jpg","caption":"Exterior A"}, …}, …];
//
// Its homes for sale are written the same way, in a list of records that
// carry an address. Each plan's and home's own page is then read for its
// gallery, drawings, tour and description (claude-extract.ts).

import { fetchPage, readPlanPages } from "@/lib/floorplans/extractors/claude-extract";
import { standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

type KbRecord = Record<string, unknown>;

const clean = (s: unknown) => (typeof s === "string" ? s : s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
const money = (n: number | null) => (n ? "$" + n.toLocaleString("en-US") : null);
const num = (v: unknown): number | null => {
  const n = Number(clean(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** "3" or "3-4" from a record's low and high ends. */
const range = (low: unknown, high: unknown) => {
  const a = clean(low);
  const b = clean(high);
  return !a ? b : !b || a === b ? a : `${a}-${b}`;
};
const first = (r: KbRecord, keys: string[]) => keys.map((k) => r[k]).find((v) => clean(v));

/**
 * Every list of records a page's scripts are handed as `var Name = [...]`,
 * by name. Brackets inside the records' strings are skipped. Exported for
 * tests.
 */
export function scriptLists(html: string): Record<string, KbRecord[]> {
  const lists: Record<string, KbRecord[]> = {};
  for (const m of html.matchAll(/\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g)) {
    const start = m.index! + m[0].length - 1;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) continue;
    try {
      const value = JSON.parse(html.slice(start, end));
      if (Array.isArray(value) && value.every((v) => v && typeof v === "object")) lists[m[1]] = value as KbRecord[];
    } catch {
      // not a list of records
    }
  }
  return lists;
}

/** A plan as its card's record files it. Exported for tests. */
export function planFromRecord(r: KbRecord, origin: string): NormalizedPlan | null {
  const name = clean(r.title ?? r.name);
  if (!name) return null;
  const price = num(r.pricedFrom);
  const thumb = r.thumbnailImage as { image?: string; caption?: string } | undefined;
  const cover = thumb?.image ? new URL(thumb.image, origin).href : null;
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: money(price),
    beds: range(r.bedroomsMin, r.bedroomsMax),
    baths: range(r.bathroomsMin, r.bathroomsMax),
    sqft: num(r.size),
    garages: clean(r.garagesMin) ? `${range(r.garagesMin, r.garagesMax)} car` : null,
    homeType: standardHomeType(clean(r.style) || null),
    quickMoveIn: false,
    comingSoon: /coming soon/i.test(clean(r.communityPriceStatus) + clean(r.bannerText)),
    sourceUrl: clean(r.pageUrl) ? new URL(clean(r.pageUrl), origin).href : null,
    galleryImages: cover ? [cover] : [],
    galleryMeta: cover ? { [cover]: { kind: "primary", caption: clean(thumb?.caption) || null } } : undefined,
    blueprintImages: [],
    raw: { planId: clean(r.floorPlanID) || null, stories: clean(r.stories) || null },
  };
}

/**
 * A home for sale from its record, however the list names the fields:
 * a street, a price and the plan it is built to — a record without all
 * three is some other list's (a nearby community's, an office's), and
 * null. Exported for tests.
 */
export function homeFromRecord(r: KbRecord, origin: string): NormalizedPlan | null {
  const street = clean(first(r, ["address", "streetAddress", "address1", "addressLine1", "homesiteAddress"]));
  if (!street || !/^\d+\s+\S/.test(street)) return null;
  const price = num(first(r, ["price", "salesPrice", "pricedFrom", "listPrice"]));
  const planName = clean(first(r, ["floorPlanName", "planName", "floorPlanTitle", "planTitle", "title"])) || null;
  if (!price || !(planName || clean(first(r, ["floorPlanID", "floorPlanId"])))) return null;
  const thumb = (r.thumbnailImage ?? r.image) as { image?: string; caption?: string } | string | undefined;
  const coverPath = typeof thumb === "string" ? thumb : thumb?.image;
  const cover = coverPath ? new URL(coverPath, origin).href : null;
  const page = clean(first(r, ["pageUrl", "url", "detailUrl"]));
  return {
    planKey: normKey(street),
    name: street.split(",")[0].trim(),
    price,
    priceDisplay: money(price),
    beds: range(first(r, ["bedroomsMin", "bedrooms", "beds"]), first(r, ["bedroomsMax"])),
    baths: range(first(r, ["bathroomsMin", "bathrooms", "baths"]), first(r, ["bathroomsMax"])),
    sqft: num(first(r, ["size", "squareFeet", "sqft"])),
    garages: clean(first(r, ["garagesMin", "garages"])) ? `${clean(first(r, ["garagesMin", "garages"]))} car` : null,
    homeType: standardHomeType(clean(r.style) || null),
    quickMoveIn: true,
    comingSoon: false,
    sourceUrl: page ? new URL(page, origin).href : null,
    relatedPlanName: planName && normKey(planName) !== normKey(street) ? planName : null,
    galleryImages: cover ? [cover] : [],
    blueprintImages: [],
    raw: { planId: clean(first(r, ["floorPlanID", "floorPlanId"])) || null, relatedPlan: planName },
  };
}

export async function extractKb(params: { url?: string; listUrls?: string[]; runDeadline?: number }): Promise<NormalizedPlan[]> {
  const pages = (params.listUrls?.length ? params.listUrls : [params.url]).map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  if (!pages.length) throw new Error("the KB Home extractor needs the community's page (extractor_params.url)");
  const byKey = new Map<string, NormalizedPlan>();
  for (const url of pages) {
    const page = await fetchPage(url);
    const origin = new URL(page.url || url).origin;
    const lists = Object.values(scriptLists(page.html));
    const plans = lists.filter((l) => l.some((r) => "floorPlanID" in r && ("title" in r || "pricedFrom" in r)));
    if (!plans.length) throw new Error(`${url} carries no FloorPlanList — KB's page has changed`);
    const homes = lists.filter((l) => !plans.includes(l) && l.some((r) => homeFromRecord(r, origin)));
    for (const p of [...plans.flat().map((r) => planFromRecord(r, origin)), ...homes.flat().map((r) => homeFromRecord(r, origin))]) {
      if (p && !byKey.has(p.planKey)) byKey.set(p.planKey, p);
    }
  }
  return readPlanPages([...byKey.values()], { read: fetchPage, atOnce: 6, runDeadline: params.runDeadline, listPages: new Set(pages) });
}
