// Photo import support for the floor plan write-back.
//
// Wix renders an IMAGE field or a MEDIA_GALLERY entry only when its
// wix:image URI carries the picture's origin dimensions:
//
//     wix:image://v1/<fileId>/<name>#originWidth=1920&originHeight=1240
//
// The listings engine learned this on 2026-09-16, when five Longboat Key
// galleries showed the editor's placeholder instead of their own photos
// (docs/LISTINGS_ENGINE_PLAN.md, "Galleries Wix could not show", and
// migration 049). The floor plan write-back had been writing the same
// dimension-less URIs, the ten Toll Brothers drafts on Lakewood included.
// MLS photos arrive with their dimensions in the feed; builder photos arrive
// with nothing, so the bytes are fetched and measured here before Wix is
// asked to import the URL. A photo that cannot be measured is left out of
// the record: a URI without dimensions is worse than none, because Wix
// refuses the whole field it sits in.

import { createHash } from "node:crypto";
import sharp from "sharp";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 20_000;
/** Builder photos run to a few MB at most; past this the URL is not a photo we want on the site. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageMeasurement extends ImageSize {
  /** sha256 of the bytes, for fp_media_map.content_hash. */
  contentHash: string;
  bytes: number;
  /** The bytes themselves, for a caller that has to transform them before import. */
  data: Uint8Array;
  /**
   * An SVG. Wix files an imported SVG as vector art, which no IMAGE field
   * or MEDIA_GALLERY can show (every drawing on The Isles was a broken
   * slash, 2026-09-20), so a drawing is rendered to a PNG before import.
   */
  svg: boolean;
}

export interface FetchedImage {
  data: Uint8Array;
  contentType: string | null;
}

/** Whether these bytes are an SVG document, by content type, by the URL's extension, or by the document's own root element. */
export function isSvg(data: Uint8Array, contentType?: string | null, url?: string | null): boolean {
  if (contentType && /svg/i.test(contentType)) return true;
  if (url) {
    try {
      if (/\.svg$/i.test(new URL(url).pathname)) return true;
    } catch {
      // not a URL; the bytes decide
    }
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(0, 1024)).trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
}

/** Whether a URL names an SVG by its path. */
export function isSvgUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /\.svg$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** The bucket the listings engine's photos live in; a rendered drawing is stored there for Wix to fetch. */
export const RASTER_BUCKET = "photos";

/** Where a rendered drawing is stored, by the SVG's content hash, so the same drawing is rendered once per site. */
export const rasterStoragePath = (siteId: string, contentHash: string): string => `floorplans/${siteId}/${contentHash}.png`;

interface MediaRecord {
  galleryImages?: unknown;
  blueprintImages?: unknown;
  primaryImage?: unknown;
  virtualTourImage?: unknown;
}

/** Every source URL a record's pictures come from: the photos, the drawings, the first slice's main image, the tour still. */
export function mediaUrlsOf(record: unknown): string[] {
  const r = (record ?? {}) as MediaRecord;
  const out: string[] = [];
  for (const list of [r.galleryImages, r.blueprintImages]) {
    if (!Array.isArray(list)) continue;
    for (const u of list) if (typeof u === "string" && u) out.push(u);
  }
  for (const u of [r.primaryImage, r.virtualTourImage]) if (typeof u === "string" && u) out.push(u);
  return out;
}

/**
 * The source URLs a connection's pictures came from that no other plan on
 * the site uses, so their Wix files can go without breaking anyone else's
 * row. A builder can serve one photo for a plan in two communities.
 */
export function urlsToRelease(inScope: Iterable<string>, usedElsewhere: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const u of inScope) if (u && !usedElsewhere.has(u)) out.add(u);
  return [...out];
}

/** The width a drawing is rendered at: legible on a page, quick for Wix to fetch. */
export const RASTER_WIDTH = 1600;

export interface Raster {
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * Renders an SVG to a PNG of about RASTER_WIDTH pixels wide on a white
 * background (drawings are line art on nothing). Null when sharp cannot
 * read it as an SVG.
 */
export async function rasterizeSvg(data: Uint8Array, targetWidth = RASTER_WIDTH): Promise<Raster | null> {
  try {
    const meta = await sharp(Buffer.from(data)).metadata();
    if (!meta.width || !meta.height) return null;
    // sharp renders vectors at 72 dpi by default; the density scales the page.
    const density = Math.max(1, Math.min(2400, (72 * targetWidth) / meta.width));
    const png = await sharp(Buffer.from(data), { density }).flatten({ background: "#ffffff" }).png().toBuffer();
    const out = await sharp(png).metadata();
    if (!out.width || !out.height) return null;
    return { png: new Uint8Array(png), width: out.width, height: out.height };
  } catch {
    return null;
  }
}

/**
 * The pixel size of an image as it displays. EXIF orientations 5 to 8 turn
 * the picture a quarter turn, so the stored width and height swap; Wix, like
 * every viewer, honours the tag, and the URI has to describe what it shows.
 * Null when sharp cannot read the bytes as an image at all.
 */
export async function measureImageBytes(bytes: Uint8Array): Promise<ImageSize | null> {
  try {
    const meta = await sharp(Buffer.from(bytes)).metadata();
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    if (!width || !height || width < 1 || height < 1) return null;
    return { width, height };
  } catch {
    return null;
  }
}

export interface MeasureDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Fetches one builder photo and measures it. Null when the URL does not
 * answer with an image: a 404, an HTML "not found" page served as 200, a
 * body too large to be a photo, or bytes sharp cannot decode.
 */
export async function measureImageUrl(url: string, deps: MeasureDeps = {}): Promise<ImageMeasurement | null> {
  const fetched = await fetchImage(url, deps);
  if (!fetched) return null;
  const size = await measureImageBytes(fetched.data);
  if (!size) return null;
  return {
    ...size,
    contentHash: createHash("sha256").update(fetched.data).digest("hex"),
    bytes: fetched.data.byteLength,
    data: fetched.data,
    svg: isSvg(fetched.data, fetched.contentType, url),
  };
}

/** Fetches one builder image's bytes; null when the URL does not answer with an image of a sane size. */
export async function fetchImage(url: string, deps: MeasureDeps = {}): Promise<FetchedImage | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": UA, accept: "image/*,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream")) return null;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) return null;
    return { data, contentType: type || null };
  } catch {
    return null;
  }
}

/**
 * The Wix file id a media-map row points at. Rows written before 2026-09-18
 * hold the whole dimension-less URI (wix:image://v1/<fileId>/<name>); a bare
 * id is accepted too. Null for anything else, so a corrupt row is re-imported
 * rather than trusted.
 */
export function wixFileIdOf(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const uri = stored.match(/^wix:image:\/\/v1\/([^/#?]+)\//);
  if (uri) return uri[1];
  return /^[A-Za-z0-9_.~-]+$/.test(stored) ? stored : null;
}

/**
 * How long the ids in one request may run. A PostgREST filter travels in
 * the address, and an address has a length a gateway will not exceed: it
 * answers "Bad Request" and says nothing else, which is what a Reset of
 * Perry's fifty plans hit every time (Jeff, 2026-09-22). Their pictures
 * are Cloudinary addresses of a hundred characters each, and fifty of
 * them at once is past it.
 */
const ASK_BUDGET = 2_000;

/**
 * The URLs in batches small enough to ask about at once — by the length
 * they add to the address, not by how many they are, since a builder's
 * picture URLs can be any length at all. Exported for tests. Pure.
 */
export function askableBatches(urls: string[], budget = ASK_BUDGET, most = 50): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let length = 0;
  for (const url of urls) {
    // The address carries each one escaped, in quotes, with a comma.
    const costs = encodeURIComponent(url).length + 3;
    if (batch.length && (length + costs > budget || batch.length >= most)) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(url);
    length += costs;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
