// Builder photos for a new village's rows (Jeff, 2026-10-28: "Build it for
// now with the builder's photos. I can replace later.").
//
// The village rows carry the village's own pictures: the entrance sign or
// an aerial up top, the neighborhood behind the About section, the pool or
// the courts behind the amenities, and a Visual Tour Gallery of five to
// eleven, each with a title ("Take a Dip at The Pool") and alt text. Until
// someone has those, Set up village fills the blanks with what the
// builder publishes: the floor plan engine's photos of the village's plans
// and homes, and the picture the builder's own page for the village shares
// (its og:image). Never MLS photos: those belong to their listing.
//
// Each is imported into the Media Manager as the village's own file, not
// shared with the plan rows through fp_media_map: a connection Reset
// deletes the files its plans imported (media-cleanup.ts), and the village
// page would lose its pictures with them.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { failedAt as failed } from "@/lib/shared/describe-error";
import { getMediaFile, importMediaFromUrl, mediaState, mediaVerdict } from "@/lib/wix/client";
import { measureImageUrl } from "@/lib/floorplans/media";
import { wixImageUri } from "@/lib/listings/types";
import { selectAll } from "@/lib/listings/db";
import { placeKey } from "@/lib/community-alerts/new-neighborhoods";
import { villageKey } from "@/lib/villages/ranges";
import { isBlank, type FieldInfo, type RowData } from "@/lib/villages/fill";
import type { GalleryMeta, Room } from "@/lib/floorplans/types";

/**
 * "front": the house from the street; "community": the builder's picture
 * of the village itself; "suite": the owner's suite. The floor plan rooms'
 * "primary" is the plan's lead picture, not a bedroom, so it is a front here.
 */
export type PhotoLabel = "front" | "community" | "suite" | Exclude<Room, "primary" | "exterior">;

export interface PlanPhotos {
  name: string;
  builder: string | null;
  quickMoveIn: boolean;
  score: number | null;
  images: string[];
  meta: Record<string, GalleryMeta>;
}

export interface Candidate {
  url: string;
  label: PhotoLabel | null;
  builder: string | null;
}

/** A candidate Wix holds, with its size. */
export interface Placed extends Candidate {
  uri: string;
  width: number;
  height: number;
}

export interface GalleryEntry {
  type: "image";
  src: string;
  title: string;
  alt: string;
}

export interface VillagePhotos {
  main: Placed | null;
  about: Placed | null;
  amenities: Placed | null;
  gallery: GalleryEntry[];
}

/** The photos imported for a village at most: enough for the backgrounds and a gallery of six. */
export const MAX_CANDIDATES = 12;
export const GALLERY_SIZE = 6;

/** The rooms a village gallery shows, in the order it shows them; bathrooms, closets and laundry rooms stay on the plans. */
const GALLERY_ROOMS: PhotoLabel[] = ["kitchen", "living", "outdoor", "suite", "dining", "office", "loft", "bedroom"];

/** A URL without its query, so the same picture under a cache-busting parameter counts once. */
const sameKey = (url: string) => url.replace(/[?#].*$/, "").toLowerCase();

/**
 * What a plan's picture shows: the builder's word, Claude's (fp_photo_rooms),
 * or the lead picture taken as the front. The engine files the lead
 * exterior as kind and room "primary" and the other elevations as
 * "exterior" (Lennar at Stillwater, 2026-10-28); an owner's suite comes as
 * a bedroom its caption names.
 */
function labelOf(plan: PlanPhotos, url: string, index: number, rooms: Map<string, string | null>): PhotoLabel | null {
  const meta = plan.meta[url];
  const room = meta?.room ?? rooms.get(url) ?? null;
  if (meta?.kind === "primary" || meta?.kind === "exterior" || room === "primary" || room === "exterior" || room === "front") return "front";
  if (room === "bedroom" && /owner|primary|master/i.test(meta?.caption ?? url)) return "suite";
  if (room) return room as PhotoLabel;
  return index === 0 ? "front" : null;
}

/**
 * The pictures worth importing, best first: the builder's page picture,
 * each plan's front, then one of each gallery room, from different plans
 * where they can be. Base plans lead, by score; quick move-ins follow.
 * Pure; exported for tests.
 */
export function photoCandidates(plans: PlanPhotos[], rooms: Map<string, string | null>, pageImages: Candidate[] = [], max = MAX_CANDIDATES): Candidate[] {
  const ordered = [...plans].sort(
    (a, b) => Number(a.quickMoveIn) - Number(b.quickMoveIn) || (b.score ?? -1) - (a.score ?? -1) || b.images.length - a.images.length
  );
  const labelled = ordered.map((plan) => plan.images.map((url, i) => ({ url, label: labelOf(plan, url, i, rooms), builder: plan.builder })));
  const out: Candidate[] = [];
  const taken = new Set<string>();
  const take = (c: Candidate) => {
    const key = sameKey(c.url);
    if (out.length >= max || taken.has(key)) return false;
    taken.add(key);
    out.push(c);
    return true;
  };
  for (const c of pageImages) take(c);
  // A front from each plan: different houses, so the backgrounds differ.
  let fronts = 0;
  for (const list of labelled) {
    const front = list.find((c) => c.label === "front" && !taken.has(sameKey(c.url)));
    if (front && fronts < 4 && take(front)) fronts++;
  }
  // One of each room, starting from a different plan each time.
  GALLERY_ROOMS.forEach((room, r) => {
    for (let i = 0; i < labelled.length; i++) {
      const found = labelled[(r + i) % labelled.length].find((c) => c.label === room && !taken.has(sameKey(c.url)));
      if (found) {
        take(found);
        break;
      }
    }
  });
  return out;
}

/** The size a wix:image URI records. */
export function sizeOf(uri: string): { width: number; height: number } | null {
  const w = /originWidth=(\d+)/.exec(uri)?.[1];
  const h = /originHeight=(\d+)/.exec(uri)?.[1];
  return w && h ? { width: Number(w), height: Number(h) } : null;
}

/** Wide enough to stretch behind a section. */
const wide = (p: Placed) => p.width >= 1200 && p.width >= p.height * 1.2;
const landscape = (p: Placed) => p.width >= 800 && p.width >= p.height;

const TITLES: Partial<Record<PhotoLabel, string[]>> = {
  community: ["Welcome to {name}"],
  front: ["Beautiful New Homes in {name}", "Thoughtfully Designed Exteriors", "Curb Appeal at Every Turn"],
  kitchen: ["Kitchens Made for Gathering"],
  living: ["Open, Light-Filled Living Spaces"],
  outdoor: ["Outdoor Living, Florida Style"],
  suite: ["A Relaxing Primary Suite"],
  dining: ["Room to Dine and Entertain"],
  office: ["A Space to Work from Home"],
  loft: ["Flexible Space for Every Stage of Life"],
  bedroom: ["Comfortable Bedrooms for Everyone"],
};

const ALT: Partial<Record<PhotoLabel, string>> = {
  community: "{name} in {place}",
  front: "A {builder}home in {name} in {place}",
  kitchen: "The kitchen of a {builder}home in {name}, {place}",
  living: "The living area of a {builder}home in {name}, {place}",
  outdoor: "The outdoor living space of a {builder}home in {name}, {place}",
  suite: "The primary suite of a {builder}home in {name}, {place}",
  dining: "The dining area of a {builder}home in {name}, {place}",
  office: "The home office of a {builder}home in {name}, {place}",
  loft: "The loft of a {builder}home in {name}, {place}",
  bedroom: "A bedroom in a {builder}home in {name}, {place}",
};

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

/**
 * Which picture goes where: the main image a wide front (the builder's own
 * picture of the village first), the About and amenities backgrounds other
 * wide pictures (an outdoor one behind the amenities when there is one),
 * and a gallery of six: two houses, then the rooms, each titled as the
 * sites title them.
 * Pure; exported for tests.
 */
export function placePhotos(placed: Placed[], name: string, place: string): VillagePhotos {
  const used = new Set<Placed>();
  const pick = (...tests: ((p: Placed) => boolean)[]) => {
    for (const test of tests) {
      const found = placed.find((p) => !used.has(p) && test(p));
      if (found) {
        used.add(found);
        return found;
      }
    }
    return null;
  };
  const isFront = (p: Placed) => p.label === "front";
  const main = pick((p) => p.label === "community" && wide(p), (p) => isFront(p) && wide(p), wide, isFront, landscape);
  const about = pick((p) => isFront(p) && wide(p), (p) => (p.label === "living" || p.label === "kitchen") && wide(p), wide);
  const amenities = pick((p) => p.label === "outdoor" && wide(p), wide);

  // The village, two of its houses, then its rooms; more houses only to fill.
  const pool = placed.filter(landscape);
  const fronts = pool.filter(isFront);
  const shown = [
    ...pool.filter((p) => p.label === "community"),
    ...fronts.slice(0, 2),
    ...pool.filter((p) => p.label !== "community" && !isFront(p)),
    ...fronts.slice(2),
  ].slice(0, GALLERY_SIZE);
  const counts = new Map<string, number>();
  const gallery = shown.map((p) => {
    const label = p.label ?? "front";
    const n = counts.get(label) ?? 0;
    counts.set(label, n + 1);
    const titles = TITLES[label] ?? ["Designed for the Way You Live"];
    const vars = { name, place, builder: p.builder ? `${p.builder} ` : "new " };
    return {
      type: "image" as const,
      src: p.uri,
      title: fill(titles[n] ?? "Designed for the Way You Live", vars),
      alt: fill(ALT[label] ?? "A {builder}home in {name}, {place}", vars),
    };
  });
  return { main, about, amenities, gallery };
}

/** The picture fields a row's photos go in, by their display names on each site. */
const PHOTO_FIELDS: { test: RegExp; take: (p: VillagePhotos) => unknown }[] = [
  { test: /^(main image|top background image)$/i, take: (p) => p.main?.uri },
  { test: /^top of page background$/i, take: (p) => p.main?.uri },
  { test: /^about (village|neighborhood) background$/i, take: (p) => p.about?.uri },
  { test: /^amenities background$/i, take: (p) => p.amenities?.uri },
  { test: /^visual tour gallery$/i, take: (p) => (p.gallery.length ? p.gallery : undefined) },
];

/** The row's blank picture fields, filled with the village's photos. Pure; exported for tests. */
export function photoFills(fields: FieldInfo[], current: RowData, photos: VillagePhotos | null): RowData {
  const out: RowData = {};
  if (!photos) return out;
  for (const f of fields) {
    if (f.type !== "IMAGE" && f.type !== "MEDIA_GALLERY") continue;
    const rule = PHOTO_FIELDS.find((r) => r.test.test(f.displayName ?? ""));
    if (!rule || (f.type === "MEDIA_GALLERY") !== /gallery/i.test(f.displayName ?? "")) continue;
    const value = rule.take(photos);
    if (value !== undefined && value !== null && isBlank(current[f.key])) out[f.key] = value;
  }
  return out;
}

/** Whether the row has a picture field its photos would fill. Pure; exported for tests. */
export function wantsPhotos(fields: FieldInfo[], current: RowData): boolean {
  const any: Placed = { url: "", label: "front", builder: null, uri: "wix:image://v1/x", width: 2000, height: 1200 };
  return Object.keys(photoFills(fields, current, { main: any, about: any, amenities: any, gallery: [{ type: "image", src: any.uri, title: "", alt: "" }] })).length > 0;
}

/** The og:image (or twitter:image) a page shares. Pure; exported for tests. */
export function sharedImageOf(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/(property|name)\s*=\s*["'](og:image(:secure_url)?|twitter:image)["']/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!content) continue;
    try {
      const url = new URL(content.replace(/&amp;/g, "&"), pageUrl);
      if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    } catch {
      // not a URL
    }
  }
  return null;
}

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** The pictures the builders' own pages for the village share: only pages on a builder's site the Hub knows. */
async function builderPageImages(sources: string[], builders: string[]): Promise<Candidate[]> {
  const { data, error } = await supabase.from("fp_builders").select("name, base_url");
  if (error) throw failed("reading the builders", error);
  const hosts = new Map<string, string>();
  for (const b of data ?? []) {
    const host = hostOf(b.base_url as string | null);
    if (host) hosts.set(host, b.name as string);
  }
  const named = new Set(builders.map((b) => b.toLowerCase()));
  const out: Candidate[] = [];
  for (const source of sources.slice(0, 6)) {
    const host = hostOf(source);
    const builder = host ? [...hosts].find(([h]) => host === h || host.endsWith(`.${h}`))?.[1] : undefined;
    if (!builder || (named.size && !named.has(builder.toLowerCase()))) continue;
    try {
      const res = await fetch(source, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const image = sharedImageOf(await res.text(), source);
      if (image) out.push({ url: image, label: "community", builder });
    } catch (e) {
      logger.warn("Builder page could not be read for its picture", { source, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** The floor plan engine's live plans and homes in the village, with their pictures. */
async function villagePlans(fpSiteId: string, name: string): Promise<PlanPhotos[]> {
  const { data: communities, error } = await supabase.from("fp_communities").select("id, name").eq("site_id", fpSiteId);
  if (error) throw failed("reading the communities", error);
  const keys = new Set([placeKey(name), villageKey(name)].filter(Boolean));
  const ids = (communities ?? []).filter((c) => keys.has(placeKey(c.name)) || keys.has(villageKey(c.name))).map((c) => c.id as string);
  if (!ids.length) return [];
  const rows = await selectAll<{ name: string; quick_move_in: boolean; record: Record<string, unknown>; fp_builders: { name: string } | null }>(
    "load the village's floor plans",
    (from, to) =>
      supabase
        .from("fp_floor_plans")
        .select("name, quick_move_in, record, fp_builders:builder_id(name)")
        .eq("site_id", fpSiteId)
        .in("community_id", ids)
        .is("removed_at", null)
        .order("id")
        .range(from, to)
  );
  return rows.map((r) => {
    const images = Array.isArray(r.record.galleryImages) ? (r.record.galleryImages as unknown[]).filter((u): u is string => typeof u === "string") : [];
    return {
      name: r.name,
      builder: r.fp_builders?.name ?? null,
      quickMoveIn: r.quick_move_in,
      score: typeof r.record.score === "number" ? r.record.score : null,
      images,
      meta: (r.record.galleryMeta ?? {}) as Record<string, GalleryMeta>,
    };
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Waits between looks at fresh imports: Wix usually has a picture within seconds. */
const VERIFY_WAITS_MS = [1500, 3000, 5000, 8000, 12000];

/** One picture into the Media Manager, measured first (a wix:image URI renders only with its size); null when it cannot be. */
async function importPhoto(wixSiteId: string, url: string, name: string): Promise<{ uri: string; fileId: string } | null> {
  const measured = await measureImageUrl(url);
  if (!measured || measured.svg) return null;
  const file = await importMediaFromUrl(wixSiteId, url, name);
  if (mediaState(file) === "broken") return null;
  const uri = wixImageUri(file.id, name, measured.width, measured.height);
  return uri ? { uri, fileId: file.id } : null;
}

/** The file ids Wix holds as images, asked about until each is there or the wait runs out. */
async function heldByWix(wixSiteId: string, fileIds: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  let pending = fileIds;
  for (let round = 0; pending.length && round <= VERIFY_WAITS_MS.length; round++) {
    if (round > 0) await sleep(VERIFY_WAITS_MS[round - 1]);
    const still: string[] = [];
    for (const id of pending) {
      const file = await getMediaFile(wixSiteId, id).catch(() => null);
      const verdict = mediaVerdict(file);
      if (verdict === "ready" || (verdict === "unknown" && String(file?.operationStatus ?? "").toUpperCase() === "READY")) held.add(id);
      else if (verdict === "pending" || verdict === "unknown") still.push(id);
    }
    pending = still;
  }
  return held;
}

/** What Claude has said each picture shows, for the pictures the builder did not name. */
async function photoRooms(urls: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < urls.length; i += 200) {
    const { data, error } = await supabase.from("fp_photo_rooms").select("source_url, room").in("source_url", urls.slice(i, i + 200));
    if (error) {
      logger.warn("Photo rooms could not be read", { error: error.message });
      return out;
    }
    for (const row of data ?? []) out.set(row.source_url as string, (row.room as string | null) ?? null);
  }
  return out;
}

/**
 * The village's builder photos, imported into the site's Media Manager
 * (or found there) and placed. Null when the builders publish none the
 * Hub knows of; problems say what went wrong along the way.
 */
export async function villagePhotos(args: {
  fpSiteId: string;
  wixSiteId: string;
  name: string;
  place: string;
  builders: string[];
  sources: string[];
  problems: string[];
}): Promise<VillagePhotos | null> {
  const plans = await villagePlans(args.fpSiteId, args.name);
  const pageImages = await builderPageImages(args.sources, args.builders).catch((e) => {
    logger.warn("Builder pages could not be read", { error: e instanceof Error ? e.message : String(e) });
    return [] as Candidate[];
  });
  const rooms = await photoRooms([...new Set(plans.flatMap((p) => p.images))]);
  const candidates = photoCandidates(plans, rooms, pageImages);
  if (!candidates.length) {
    args.problems.push("The Hub has no builder photos for it yet (no floor plans, and no picture on the builder's page): its pictures are left blank");
    return null;
  }
  const imported: { candidate: Candidate; image: { uri: string; fileId: string } }[] = [];
  const slug = args.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  for (const [i, candidate] of candidates.entries()) {
    const ext = /\.(jpe?g|png|webp|gif)$/i.exec(candidate.url.replace(/[?#].*$/, ""))?.[1]?.toLowerCase() ?? "jpg";
    const image = await importPhoto(args.wixSiteId, candidate.url, `${slug}-photo-${i + 1}.${ext}`).catch((e) => {
      logger.warn("Village photo could not be imported", { url: candidate.url, error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    if (image) imported.push({ candidate, image });
  }
  const held = await heldByWix(args.wixSiteId, imported.map((i) => i.image.fileId));
  const placed: Placed[] = imported
    .filter((i) => held.has(i.image.fileId))
    .flatMap(({ candidate, image }) => {
      const size = sizeOf(image.uri);
      return size ? [{ ...candidate, uri: image.uri, ...size }] : [];
    });
  if (placed.length < candidates.length) {
    args.problems.push(`${candidates.length - placed.length} of the ${candidates.length} builder photos could not be brought into Wix; the rest are used`);
  }
  return placed.length ? placePhotos(placed, args.name, args.place) : null;
}
