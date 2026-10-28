// What Set up village writes into a new village's rows (Jeff, 2026-10-28):
// only fields that are blank, each in the shape the collection's own rows
// already use, so a draft reads like its neighbours. Pure.
//
//  - Content (subtitle, About, unique feature, amenities paragraph, FAQ,
//    builders, home types) comes from Claude's research (research.ts).
//  - Each amenity's paragraphs and icon are copied from a row of the same
//    collection where that amenity is Yes, or No, as the case is.
//  - Boilerplate ("Homes for Sale in Waterbury Park", "A map of Waterbury
//    Park") is a published row's own text with its name changed to the new
//    village's; text every published row shares ("Pool Icon") is copied.
//  - The schools come from the districts' zones (school-zones).
// Links, photos, the video, the map and the nearby villages are the
// person's: they are left blank.

import { cleanText, LEVEL_LABEL, type SchoolLevel } from "@/lib/school-zones/names";
import { readSchoolField, writeSchoolField } from "@/lib/school-zones/pages";
import { AMENITIES, type Amenity, type VillageResearch } from "@/lib/villages/research";

export type RowData = Record<string, unknown>;
export interface FieldInfo {
  key: string;
  displayName?: string;
  type?: string;
}
export type Schools = Record<SchoolLevel, string>;

/** Blank: missing, empty, an empty list, or a paragraph with nothing in it. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return cleanText(value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")) === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** A paragraph's text: `<p class="font_9" style="...">Yes</p>` → "Yes". */
const textOf = (value: unknown) => (typeof value === "string" ? cleanText(value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")) : "");

/** The amenity a label names, as every collection writes its labels. */
const AMENITY_LABELS: Record<Amenity, RegExp> = {
  clubhouse: /clubhouse/i,
  pool: /^pool/i,
  fitnessCenter: /fitness/i,
  spa: /spa\b/i,
  lifestyleDirector: /lifestyle/i,
  walkingPaths: /walking/i,
  dogPark: /\bdog/i,
  playground: /tot lot|totlot|playground/i,
  golf: /golf/i,
  tennis: /tennis/i,
  pickleball: /pickleball/i,
  bocce: /bocce/i,
  restaurant: /restaurant/i,
  maintenanceIncluded: /maintenance/i,
  gated: /^gated?\b|^gate(V|$)/i,
  ageRestricted: /age ?restricted|55\+?/i,
};

export const amenityOf = (label: string): Amenity | null => AMENITIES.find((a) => AMENITY_LABELS[a].test(label)) ?? null;

// ------------------------------------------------ the village pages collection

/** Each amenity's three fields in a village pages collection, by their display names ("Pool Text", "Pool Text - Yes or No", "Pool Image"). */
export function pageAmenityFields(fields: FieldInfo[]): Map<Amenity, { text: string | null; yesNo: string; image: string | null }> {
  const byName = new Map(fields.map((f) => [(f.displayName ?? "").toLowerCase(), f.key]));
  const out = new Map<Amenity, { text: string | null; yesNo: string; image: string | null }>();
  for (const f of fields) {
    const label = (f.displayName ?? "").match(/^(.+?) Text - Yes or No$/i)?.[1];
    if (!label) continue;
    const amenity = amenityOf(label);
    if (!amenity || out.has(amenity)) continue;
    const l = label.toLowerCase();
    out.set(amenity, {
      text: byName.get(`${l} text`) ?? byName.get(l) ?? null,
      yesNo: f.key,
      image: byName.get(`${l} image`) ?? null,
    });
  }
  return out;
}

/** The first row whose field reads Yes (or No). */
const exampleRow = (rows: RowData[], key: string, yes: boolean) => rows.find((r) => textOf(r[key]) === (yes ? "Yes" : "No"));

/** The rows to copy from, published ones first. */
const published = (rows: RowData[]) => [...rows].sort((a, b) => Number(b._publishStatus !== "DRAFT") - Number(a._publishStatus !== "DRAFT"));

/** "Single Family" → "Single Family Homes", as the village pages write home types. */
const PAGE_HOME_TYPES: Record<string, string> = {
  "Single Family": "Single Family Homes",
  Villa: "Villas",
  Townhome: "Townhomes",
  Condominium: "Condominiums",
  "Coach Home": "Coach Homes",
};

/** The FAQ as the village pages write it: a paragraph per question, a blank one between. Pure; exported for tests. */
export function faqHtml(faq: VillageResearch["faq"]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return faq.map((q) => `<p class="font_7"><strong>${esc(q.question)}</strong><br>\n${esc(q.answer)}</p>`).join('\n<p class="font_7"><br></p>\n');
}

/** The published row most filled in, and the names it goes by, longest first. */
function templateRow(rows: RowData[], nameKeys: string[]): { row: RowData; names: string[] } | null {
  const pool = rows.filter((r) => r._publishStatus !== "DRAFT");
  if (!pool.length) return null;
  const filled = (r: RowData) => Object.values(r).filter((v) => !isBlank(v)).length;
  const row = [...pool].sort((a, b) => filled(b) - filled(a))[0];
  const names = [...new Set(nameKeys.map((k) => row[k]).filter((v): v is string => typeof v === "string" && v.trim().length > 2))]
    .map((n) => n.trim())
    .sort((a, b) => b.length - a.length);
  return { row, names };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A field the person fills, or one written from elsewhere: never templated. */
const NOT_TEMPLATED = /image|gallery|video|map|link|url|nearby|^faq$|school|price|square|bedroom|bathroom|garage|range|tags|active|count|zero|home ?type|builder|subtitle|about .* description|short description|unique|amenities (short )?description|yes or no|reference|^village$|^title$|name/i;

/**
 * The village pages collection's blank fields for a new village, filled.
 * Pure; exported for tests.
 */
export function planPagesRow(args: {
  fields: FieldInfo[];
  rows: RowData[];
  current: RowData | null;
  name: string;
  research: VillageResearch | null;
  schools: Schools | null;
  /** Fields already decided, by key: the name, the Village reference, ranges copied from Village Details. */
  fixed: RowData;
  /** Icons for an amenity no row of this collection shows yet, Yes or No (Village Details' own, the same files). */
  fallbackIcons?: Partial<Record<Amenity, { yes?: unknown; no?: unknown }>>;
}): RowData {
  const { fields, current, name, research, schools, fixed, fallbackIcons = {} } = args;
  const rows = published(args.rows);
  const out: RowData = {};
  const set = (key: string | null | undefined, value: unknown) => {
    if (!key || isBlank(value)) return;
    if (current && !isBlank(current[key])) return;
    if (out[key] !== undefined) return;
    out[key] = value;
  };
  const keyNamed = (re: RegExp) => fields.find((f) => re.test(f.displayName ?? ""))?.key ?? null;

  for (const [key, value] of Object.entries(fixed)) set(key, value);

  // Content, from the research.
  if (research) {
    set(keyNamed(/^(village|neighborhood) subtitle$/i), research.subtitle);
    set(keyNamed(/^about (village|neighborhood) description$/i), research.description);
    set(keyNamed(/^(village|neighborhood) short description$/i), research.overview);
    set(keyNamed(/^unique (village|neighborhood) feature$/i), research.uniqueFeature);
    set(keyNamed(/^amenities (short )?description$/i), research.amenitiesDescription);
    if (research.faq.length) set(keyNamed(/^faq$/i), faqHtml(research.faq));
    set(keyNamed(/^builder\(s\)$/i), research.builders.join(", "));
    set(keyNamed(/^home types$/i), research.homeTypes.map((t) => PAGE_HOME_TYPES[t] ?? t).join(", "));

    // Each amenity's paragraphs and icon, as a row where it reads the same has them.
    for (const [amenity, f] of pageAmenityFields(fields)) {
      const yes = research.amenities[amenity];
      const example = exampleRow(rows, f.yesNo, yes);
      if (example) {
        set(f.yesNo, example[f.yesNo]);
        set(f.text, f.text ? example[f.text] : null);
        set(f.image, f.image ? example[f.image] : null);
        continue;
      }
      // No row shows it this way yet: the collections' own convention, font_8 for Yes and font_9 for No.
      const label = (fields.find((x) => x.key === f.yesNo)?.displayName ?? "").replace(/ Text - Yes or No$/i, "");
      const font = yes ? "font_8" : "font_9";
      set(f.yesNo, `<p class="${font}" style="text-align: right">${yes ? "Yes" : "No"}</p>`);
      set(f.text, `<p class="${font}">${label}</p>`);
      set(f.image, fallbackIcons[amenity]?.[yes ? "yes" : "no"]);
    }
  }

  // The schools, in the collection's own markup.
  if (schools) {
    for (const level of ["elementary", "middle", "high"] as SchoolLevel[]) {
      const key = keyNamed(new RegExp(`^(village|neighborhood) ${level === "elementary" ? "elementary" : level} school$`, "i"));
      if (!key || !schools[level]) continue;
      const sample = rows.map((r) => r[key]).find((v) => typeof v === "string" && /<strong>/i.test(v));
      set(key, writeSchoolField(level, schools[level], sample));
    }
  }

  // Boilerplate: a published row's text with its name changed, or text all published rows share.
  const nameKeys = fields.filter((f) => /^(title|sortVillageName)$/.test(f.key) || /name/i.test(f.displayName ?? "")).map((f) => f.key);
  const template = templateRow(rows, nameKeys);
  const pub = rows.filter((r) => r._publishStatus !== "DRAFT");
  for (const f of fields) {
    const label = f.displayName ?? f.key;
    if ((NOT_TEMPLATED.test(label) && !/alt text/i.test(label)) || f.key.startsWith("_") || f.key.startsWith("link-")) continue;
    const sample = template?.row[f.key];
    if (typeof sample === "string" && template && sample.length <= 300 && !/^(wix:|https?:|\{|\[)/.test(sample)) {
      const hit = template.names.find((n) => new RegExp(`\\b${escapeRe(n)}\\b`).test(sample));
      if (hit) {
        let text = sample;
        for (const n of template.names) text = text.replace(new RegExp(`\\b${escapeRe(n)}\\b`, "g"), name);
        set(f.key, text);
        continue;
      }
    }
    const values = pub.map((r) => r[f.key]);
    if (pub.length >= 2 && values.every((v) => typeof v === "string" && v === values[0] && !/^(wix:|https?:)/.test(v))) set(f.key, values[0]);
  }
  return out;
}

// ------------------------------------------------ Life At Lakewood's Village Details

/** What the villages page's filters call each amenity: its Show All entry and its dropdown tag. */
const DETAIL_TAGS: Partial<Record<Amenity, [string, string]>> = {
  pool: ["Pool", "Community Pool"],
  spa: ["Spa", "Village Spa"],
  fitnessCenter: ["Fitness Center", "Fitness Center"],
  lifestyleDirector: ["Lifestyle Director", "Lifestyle Director"],
  tennis: ["Tennis", "Tennis"],
  pickleball: ["Pickleball", "Pickleball"],
  restaurant: ["Village Restaurant or Bar", "Village Restaurant or Bar"],
  golf: ["Golf", "Golf"],
  walkingPaths: ["Walking Paths", "Walking Paths"],
  playground: ["Tot Lot", "Tot Lot"],
  dogPark: ["Dog Park", "Dog Park"],
  gated: ["Gated", "Gated Community"],
  clubhouse: ["Clubhouse", "Clubhouse"],
  maintenanceIncluded: ["Maintenance-Included", "Maintenance-Included"],
  ageRestricted: ["55+ Community", "55+ Community"],
};

/** Village Details' amenities: "<stem>V2" the label paragraph, "<stem>V3" Yes or No, and the numbered icon whose description is the label. */
export function detailAmenityFields(keys: string[]): Map<Amenity, { label: string; yesNo: string }> {
  const out = new Map<Amenity, { label: string; yesNo: string }>();
  for (const key of keys) {
    const stem = key.match(/^(.+)V3$/)?.[1];
    if (!stem || !keys.includes(`${stem}V2`)) continue;
    const amenity = amenityOf(stem.replace(/([A-Z])/g, " $1"));
    if (amenity && !out.has(amenity)) out.set(amenity, { label: `${stem}V2`, yesNo: key });
  }
  return out;
}

/** Village Details' icon for each amenity, Yes and No, from its rows. Pure; exported for tests. */
export function detailAmenityIcons(keys: string[], rows: RowData[]): Partial<Record<Amenity, { yes?: unknown; no?: unknown }>> {
  const out: Partial<Record<Amenity, { yes?: unknown; no?: unknown }>> = {};
  for (const [amenity, f] of detailAmenityFields(keys)) {
    for (const yes of [true, false]) {
      const example = exampleRow(rows, f.yesNo, yes);
      if (!example) continue;
      const label = textOf(example[f.label]);
      const n = Array.from({ length: 20 }, (_, i) => i + 1).find((i) => textOf(example[`amenities${i}Description`]) === label);
      if (n) out[amenity] = { ...out[amenity], [yes ? "yes" : "no"]: example[`amenitiesImage${n}`] };
    }
  }
  return out;
}

/**
 * The amenity level a count of amenities reads as, by the rows' own: the
 * level whose rows' middle count is nearest. Pure; exported for tests.
 */
export function amenityLevelOf(count: number, rows: { count: number; level: string }[]): string | null {
  const byLevel = new Map<string, number[]>();
  for (const r of rows) {
    const level = r.level.replace(/\*+$/, "").trim();
    if (level) byLevel.set(level, [...(byLevel.get(level) ?? []), r.count]);
  }
  let best: { level: string; d: number } | null = null;
  for (const [level, counts] of byLevel) {
    const s = [...counts].sort((a, b) => a - b);
    const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    const d = Math.abs(mid - count);
    if (!best || d < best.d) best = { level, d };
  }
  return best?.level ?? null;
}

/** Village Details' blank fields for a new village, filled. Pure; exported for tests. */
export function planDetailsRow(args: {
  keys: string[];
  rows: RowData[];
  current: RowData | null;
  name: string;
  research: VillageResearch | null;
  schools: Schools | null;
  schoolKeys: Record<SchoolLevel, string>;
  /** The village pages collection's school paragraphs, the markup to write them in. */
  schoolTemplates: Partial<Record<SchoolLevel, string>>;
  /** The village's page, once its dynamic page has an address. */
  pageUrl: string | null;
}): RowData {
  const { keys, current, name, research, schools, schoolKeys, schoolTemplates, pageUrl } = args;
  const rows = published(args.rows);
  const out: RowData = {};
  const set = (key: string, value: unknown) => {
    if (!keys.includes(key) || isBlank(value)) return;
    if (current && !isBlank(current[key])) return;
    if (out[key] === undefined) out[key] = value;
  };
  set("title", name);
  set("villagesTitle", name);
  if (research) {
    set("description", research.subtitle);
    set("villagesDescription", research.overview);
    set("homeTypes", research.homeTypes.join(", "));

    const yes: Amenity[] = [];
    for (const [amenity, f] of detailAmenityFields(keys)) {
      const on = research.amenities[amenity];
      if (on) yes.push(amenity);
      const example = exampleRow(rows, f.yesNo, on);
      if (!example) {
        // No village reads this way yet: the convention, its icon left for the person.
        const text = rows.map((r) => textOf(r[f.label])).find(Boolean);
        const font = on ? "font_8" : "font_9";
        if (text) set(f.label, `<p class="${font}">${text}</p>`);
        set(f.yesNo, `<p class="${font}" style="text-align: right">${on ? "Yes" : "No"}</p>`);
        continue;
      }
      set(f.label, example[f.label]);
      set(f.yesNo, example[f.yesNo]);
      // The numbered icon whose description is this amenity's label.
      const label = textOf(example[f.label]);
      const n = Array.from({ length: 20 }, (_, i) => i + 1).find((i) => textOf(example[`amenities${i}Description`]) === label);
      if (n) {
        set(`amenities${n}Description`, example[`amenities${n}Description`]);
        set(`amenitiesImage${n}`, example[`amenitiesImage${n}`]);
      }
    }
    const tags = yes.map((a) => DETAIL_TAGS[a]).filter((t): t is [string, string] => Boolean(t));
    set("showAll", ["Show All Amenities", ...tags.map((t) => t[0])].join(", "));
    set("amenitiesDropdownNew", tags.map((t) => t[1]));
    const counted = rows
      .filter((r) => typeof r.amenityLevel === "string")
      .map((r) => ({ count: Object.keys(r).filter((k) => k.endsWith("V3") && textOf(r[k]) === "Yes").length, level: r.amenityLevel as string }));
    const level = amenityLevelOf(yes.length, counted);
    if (level) {
      set("amenityLevel", level);
      set("amenityLevelDropdown", `${level}, Show All`);
    }
  }
  if (schools) {
    for (const level of ["elementary", "middle", "high"] as SchoolLevel[]) {
      if (schools[level]) set(schoolKeys[level], writeSchoolField(level, schools[level], schoolTemplates[level]));
    }
  }
  if (pageUrl) {
    set("buttonLink", pageUrl);
    set("homesForSaleLink", pageUrl);
  }
  return out;
}

/** A row's schools as its fields name them, for the summary. */
export const schoolsOf = (data: RowData | null, keys: Partial<Record<SchoolLevel, string>>) =>
  (["elementary", "middle", "high"] as SchoolLevel[]).map((l) => `${LEVEL_LABEL[l]}: ${readSchoolField(keys[l] ? data?.[keys[l]!] : "") || "—"}`);
