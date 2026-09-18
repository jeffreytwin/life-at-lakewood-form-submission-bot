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
  const fetchImpl = deps.fetchImpl ?? fetch;
  let bytes: Uint8Array;
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
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  const size = await measureImageBytes(bytes);
  if (!size) return null;
  return {
    ...size,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  };
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
