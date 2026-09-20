// Wix Data + Media Manager client for the floor plan sync pipeline.
//
// All behavior here was verified against the live API (see
// docs/WIX_COLLECTIONS.md): draft items are created by setting
// data._publishStatus = "DRAFT" at insert; draft items are invisible to
// every read/write unless publishPluginOptions.includeDraftItems is passed;
// a draft can only be published from the Wix CMS UI (the API cannot flip
// _publishStatus), which is the designed human checkpoint.

import { logger } from "@/lib/shared/logger";

const WIX_API_BASE = "https://www.wixapis.com";

export type WixItemData = Record<string, unknown> & {
  _id?: string;
  _publishStatus?: "PUBLISHED" | "DRAFT";
};

export interface WixDataItem {
  id: string;
  dataCollectionId: string;
  data: WixItemData;
}

export class WixApiError extends Error {
  /** Seconds Wix asked us to wait (from a Retry-After header), if it said. */
  readonly retryAfterSeconds: number | null;

  constructor(
    public readonly status: number,
    public readonly body: string,
    context: string,
    retryAfter?: string | null
  ) {
    // Wix's edge answers some failures with a whole HTML error page; the Hub does not need it.
    super(`Wix API ${context}: ${status} ${/^\s*<(!doctype|html)/i.test(body) ? "(Wix answered with an HTML error page)" : body.slice(0, 300)}`);
    this.name = "WixApiError";
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    this.retryAfterSeconds = Number.isFinite(seconds) ? seconds : null;
  }

  /** Wix throttled the call (documented at 200 requests/minute per app instance). */
  get rateLimited(): boolean {
    return this.status === 429;
  }
}

function apiKey(): string {
  const key = process.env.WIX_API_KEY;
  if (!key) throw new Error("Missing WIX_API_KEY environment variable");
  return key;
}

async function wixRequest<T>(
  siteId: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${WIX_API_BASE}${path}`, {
    method,
    headers: {
      authorization: apiKey(),
      "wix-site-id": siteId,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    logger.error("Wix API request failed", {
      method,
      path,
      status: res.status,
      retryAfter,
      body: text.slice(0, 500),
    });
    throw new WixApiError(res.status, text, `${method} ${path}`, retryAfter);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export interface WixCollectionField {
  key: string;
  displayName?: string;
  type?: string;
  /** For REFERENCE fields, { reference: { referencedCollectionId } }. */
  typeMetadata?: unknown;
  systemField?: boolean;
  [extra: string]: unknown;
}

export interface WixDataCollection {
  id: string;
  displayName?: string;
  fields: WixCollectionField[];
  permissions?: Record<string, unknown>;
  plugins?: unknown[];
  /** Wix's optimistic lock: an update must carry the revision it read. */
  revision?: string | number;
  [extra: string]: unknown;
}

/** A collection's schema, or null when the site has no collection by that id. */
export async function getDataCollection(siteId: string, collectionId: string): Promise<WixDataCollection | null> {
  try {
    const res = await wixRequest<{ collection?: WixDataCollection }>(
      siteId,
      "GET",
      `/wix-data/v2/collections/${encodeURIComponent(collectionId)}`
    );
    const collection = res?.collection ?? null;
    return collection ? { ...collection, fields: collection.fields ?? [] } : null;
  } catch (error) {
    if (error instanceof WixApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Replaces a collection's definition: fields added, relabeled or removed
 * (removing a field deletes its data). The whole collection object goes
 * back, revision included; Wix refuses a stale revision. Used by the Hub's
 * Settings → Sites align action (the phase 2 script used the same call to
 * add the blueprint gallery field on 2026-07-02).
 */
export async function updateDataCollection(siteId: string, collection: WixDataCollection): Promise<WixDataCollection> {
  const res = await wixRequest<{ collection?: WixDataCollection }>(siteId, "PUT", "/wix-data/v2/collections", { collection });
  const updated = res?.collection;
  if (!updated) throw new Error("Wix returned no collection after the update");
  return { ...updated, fields: updated.fields ?? [] };
}

const draftsParam = "publishPluginOptions.includeDraftItems=true";

export interface QueryItemsOptions {
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  includeDrafts?: boolean;
}

export async function queryItems(
  siteId: string,
  collectionId: string,
  options: QueryItemsOptions = {}
): Promise<{ items: WixDataItem[]; total: number }> {
  const { filter, limit = 100, offset = 0, includeDrafts = false } = options;
  const res = await wixRequest<{
    dataItems?: WixDataItem[];
    pagingMetadata?: { total?: number };
  }>(siteId, "POST", "/wix-data/v2/items/query", {
    dataCollectionId: collectionId,
    query: { ...(filter ? { filter } : {}), paging: { limit, offset } },
    returnTotalCount: true,
    ...(includeDrafts ? { publishPluginOptions: { includeDraftItems: true } } : {}),
  });
  return {
    items: res.dataItems ?? [],
    total: res.pagingMetadata?.total ?? res.dataItems?.length ?? 0,
  };
}

/** Pages through the full collection. */
export async function queryAllItems(
  siteId: string,
  collectionId: string,
  options: Omit<QueryItemsOptions, "limit" | "offset"> = {}
): Promise<WixDataItem[]> {
  const all: WixDataItem[] = [];
  for (;;) {
    const { items, total } = await queryItems(siteId, collectionId, {
      ...options,
      limit: 100,
      offset: all.length,
    });
    all.push(...items);
    if (items.length === 0 || all.length >= total) return all;
  }
}

export async function getItem(
  siteId: string,
  collectionId: string,
  itemId: string,
  includeDrafts = true
): Promise<WixDataItem | null> {
  try {
    const res = await wixRequest<{ dataItem?: WixDataItem }>(
      siteId,
      "GET",
      `/wix-data/v2/items/${itemId}?dataCollectionId=${collectionId}${includeDrafts ? `&${draftsParam}` : ""}`
    );
    return res.dataItem ?? null;
  } catch (error) {
    if (error instanceof WixApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Wraps item data for a write. When the caller supplies _id, Wix requires
 * dataItem.id to carry the same value (WDE0080 "dataItem id and data._id
 * fields must match" otherwise; verified on Longboat Key 2026-09-14).
 */
function toDataItem(data: WixItemData): { id?: string; data: WixItemData } {
  return data._id ? { id: data._id, data } : { data };
}

/**
 * Inserts an item. With asDraft, the item lands as a CMS draft: invisible
 * to the live site until a human publishes it in the Wix CMS UI. A
 * caller-supplied _id is kept.
 */
export async function insertItem(
  siteId: string,
  collectionId: string,
  data: WixItemData,
  { asDraft = false }: { asDraft?: boolean } = {}
): Promise<WixDataItem> {
  const res = await wixRequest<{ dataItem: WixDataItem }>(
    siteId,
    "POST",
    "/wix-data/v2/items",
    {
      dataCollectionId: collectionId,
      dataItem: toDataItem(asDraft ? { ...data, _publishStatus: "DRAFT" } : data),
    }
  );
  return res.dataItem;
}

/** Full-item update (Wix PUT semantics: send the complete data object). */
export async function updateItem(
  siteId: string,
  collectionId: string,
  itemId: string,
  data: WixItemData
): Promise<WixDataItem> {
  const res = await wixRequest<{ dataItem: WixDataItem }>(
    siteId,
    "PUT",
    `/wix-data/v2/items/${itemId}`,
    {
      dataCollectionId: collectionId,
      dataItem: { data: { ...data, _id: itemId } },
      publishPluginOptions: { includeDraftItems: true },
    }
  );
  return res.dataItem;
}

export async function removeItem(
  siteId: string,
  collectionId: string,
  itemId: string
): Promise<void> {
  await wixRequest(
    siteId,
    "DELETE",
    `/wix-data/v2/items/${itemId}?dataCollectionId=${collectionId}&${draftsParam}`
  );
}

/** The import response: the file, plus whatever Wix says about the import (see mediaState). */
export interface ImportedMediaFile extends WixMediaFile {
  id: string;
  url: string;
  displayName: string;
}

/** Imports an external image URL into the site's Media Manager, into a folder when one is given. */
export async function importMediaFromUrl(
  siteId: string,
  sourceUrl: string,
  displayName: string,
  parentFolderId?: string | null
): Promise<ImportedMediaFile> {
  const res = await wixRequest<{
    file: { id: string; url: string; displayName: string };
  }>(siteId, "POST", "/site-media/v1/files/import", {
    url: sourceUrl,
    displayName,
    ...(parentFolderId ? { parentFolderId } : {}),
  });
  return res.file;
}

export interface WixMediaFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
}

/** The Media Manager's root folder id. */
export const WIX_MEDIA_ROOT = "media-root";
const FOLDER_PAGE = 100;
/** Folder listing never reads more pages than this (1,000 folders), whatever Wix answers. */
export const FOLDER_PAGE_CAP = 10;

/**
 * The folders directly under a folder (the root by default). Bounded: the
 * first Parrish photo runs (2026-09-16) hung here until Vercel killed the
 * invocation, so the listing stops at FOLDER_PAGE_CAP pages and as soon as
 * a page repeats a folder already seen (an offset Wix ignores).
 */
export async function listMediaFolders(siteId: string, parentFolderId: string = WIX_MEDIA_ROOT): Promise<WixMediaFolder[]> {
  const folders: WixMediaFolder[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < FOLDER_PAGE_CAP; page += 1) {
    const res = await wixRequest<{ folders?: WixMediaFolder[] }>(
      siteId,
      "GET",
      `/site-media/v1/folders?parentFolderId=${encodeURIComponent(parentFolderId)}&paging.limit=${FOLDER_PAGE}&paging.offset=${page * FOLDER_PAGE}`
    );
    const batch = res?.folders ?? [];
    let repeated = false;
    for (const f of batch) {
      if (!f?.id || seen.has(f.id)) {
        repeated = true;
        continue;
      }
      seen.add(f.id);
      folders.push(f);
    }
    if (repeated || batch.length < FOLDER_PAGE) return folders;
  }
  return folders;
}

export interface WixMediaFile {
  id: string;
  displayName?: string;
  parentFolderId?: string;
  /** Wix's own word on the import: READY, PENDING, FAILED. Absent on older responses. */
  operationStatus?: string;
  /** What Wix filed: IMAGE, VIDEO, VECTOR (an imported SVG), DOCUMENT... Only an IMAGE renders in an IMAGE field or a gallery. */
  mediaType?: string;
  sizeInBytes?: string | number;
  /** The processed image. A file whose import fetch failed has an id but nothing here. */
  media?: { image?: { image?: { width?: number; height?: number }; width?: number; height?: number } };
}

/**
 * Whether Wix actually holds the picture behind a file id.
 *
 * Wix's URL import is asynchronous: the call returns a file id at once and
 * Wix fetches the bytes afterwards. When that fetch fails, the file still
 * exists in the Media Manager and in any gallery pointing at it, but there
 * is no image — what the CMS draws as a broken thumbnail.
 *
 * Only "broken" is acted on, and only on positive evidence: Wix said FAILED,
 * or it described the media and there were no dimensions in it. A response
 * that simply does not carry the media block is "unknown", never broken, so
 * a change in Wix's payload cannot make the engine discard good imports.
 */
export type MediaState = "ready" | "pending" | "broken" | "unknown";

export function mediaState(file: WixMediaFile): MediaState {
  const status = typeof file.operationStatus === "string" ? file.operationStatus.toUpperCase() : null;
  if (status === "FAILED") return "broken";
  if (status === "PENDING") return "pending";
  const image = file.media?.image;
  if (!file.media || !image) return status === "READY" ? "unknown" : "unknown";
  const width = image.image?.width ?? image.width;
  const height = image.image?.height ?? image.height;
  return width && height && width > 0 && height > 0 ? "ready" : "broken";
}

/**
 * mediaState, plus the one thing it cannot see: a file that is not an image
 * at all. Wix files an imported SVG as vector art (mediaType VECTOR, a file
 * id ending in .svg), which no IMAGE field or MEDIA_GALLERY can show; the
 * CMS draws it as a broken slash (The Isles, 2026-09-20).
 */
export type MediaVerdict = MediaState | "not-image";

export function mediaVerdict(file: WixMediaFile | null | undefined): MediaVerdict {
  if (!file) return "unknown";
  const type = typeof file.mediaType === "string" ? file.mediaType.toUpperCase() : null;
  if (type && type !== "IMAGE") return "not-image";
  return mediaState(file);
}

export interface MediaDeletion {
  deleted: string[];
  failed: { fileId: string; error: string }[];
}

/**
 * Deletes Media Manager files by id (POST /site-media/v1/bulk/files/delete,
 * permanently by default). A batch that fails is retried one file at a
 * time, and a file Wix no longer has counts as deleted. Used by a
 * connection Reset, which takes the pictures it imported with it (Jeff,
 * 2026-09-20: a Reset wipes everything, so the next Run tests the whole
 * path from the builder's site).
 */
export async function deleteMediaFiles(
  siteId: string,
  fileIds: string[],
  { permanent = true }: { permanent?: boolean } = {}
): Promise<MediaDeletion> {
  const result: MediaDeletion = { deleted: [], failed: [] };
  for (let i = 0; i < fileIds.length; i += 100) {
    const batch = fileIds.slice(i, i + 100);
    try {
      await wixRequest(siteId, "POST", "/site-media/v1/bulk/files/delete", { fileIds: batch, permanent });
      result.deleted.push(...batch);
      continue;
    } catch {
      // One id Wix does not know can fail the batch; the rest still go.
    }
    for (const fileId of batch) {
      try {
        await wixRequest(siteId, "POST", "/site-media/v1/bulk/files/delete", { fileIds: [fileId], permanent });
        result.deleted.push(fileId);
      } catch (error) {
        if (error instanceof WixApiError && error.status === 404) {
          result.deleted.push(fileId);
          continue;
        }
        result.failed.push({ fileId, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
      }
    }
  }
  return result;
}

/** One Media Manager file by id, as Wix describes it now; null when Wix has no such file. */
export async function getMediaFile(siteId: string, fileId: string): Promise<WixMediaFile | null> {
  try {
    const res = await wixRequest<{ file?: WixMediaFile }>(siteId, "GET", `/site-media/v1/files/${encodeURIComponent(fileId)}`);
    return res?.file ?? null;
  } catch (error) {
    if (error instanceof WixApiError && error.status === 404) return null;
    throw error;
  }
}

const FILE_PAGE = 100;
/** Offset paging stops here whatever Wix says, so a folder that never ends cannot hang a request. */
const FILE_PAGE_CAP = 1000;

/** Every file directly in a Media Manager folder. The file id is the one a wix:image URI carries. */
export interface ListMediaFilesOptions {
  /** Epoch ms; paging stops cleanly at it and reports `truncated`. */
  deadline?: number;
  /** Where to start, from a previous call's `nextOffset`. */
  startOffset?: number;
  /** Pages this call may read, whatever the deadline allows. */
  maxPages?: number;
}

/**
 * The key names of a response envelope, one level deep, with array lengths
 * and value *types* but never values. Enough to work out how an endpoint
 * pages without putting any of the payload into a report.
 *
 * It exists because the Media Manager file listing pages neither of the two
 * ways the code has assumed: paging.offset is ignored, and there is no
 * pagingMetadata.cursors.next to follow. Rather than guess a third time, the
 * audit reports what the endpoint actually sends back.
 */
/** One level further in, which is where "cursors" turned out to hide a "next". */
function describeInner(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .slice(0, 10)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}[${v.length}]`;
      if (v && typeof v === "object") return `${k}{${Object.keys(v as Record<string, unknown>).slice(0, 6).join(",")}}`;
      return `${k}:${v === null ? "null" : typeof v}`;
    })
    .join(",");
}

export function envelopeShape(res: unknown): string[] {
  if (!res || typeof res !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(res as Record<string, unknown>)) {
    if (Array.isArray(value)) out.push(`${key}[${value.length}]`);
    else if (value && typeof value === "object") out.push(`${key}{${describeInner(value as Record<string, unknown>)}}`);
    else out.push(`${key}:${value === null ? "null" : typeof value}`);
  }
  return out.sort();
}

export interface ListMediaFilesResult {
  files: WixMediaFile[];
  /** The listing stopped before the end of the folder. */
  truncated: boolean;
  /** Where the next call should start; 0 once the end has been reached. */
  nextOffset: number;
  /** The first response's envelope (key names only), for diagnosing how this endpoint pages. */
  shape?: string[];
}

/**
 * The files in a folder, a page at a time, resumable.
 *
 * Both the deadline and the offset matter, and for different reasons. At 100
 * files a page the cap alone allows a thousand sequential round trips, and a
 * folder the size of Parrish's is some 140 of them; called without a
 * deadline from inside a run, this walked past the function's own time limit
 * and the invocation was killed before anything else could happen
 * (2026-09-17). But a deadline on its own only turns that into a different
 * bug: paging always started at zero, so a listing cut short stopped at the
 * same place every time and the tail of a large folder was never reached.
 *
 * So a caller that works to a clock passes both, and stores `nextOffset` for
 * next time. Reaching the end returns `nextOffset: 0`, and the cycle starts
 * again.
 */
interface WixMediaFilesResponse {
  files?: WixMediaFile[];
  /**
   * What this endpoint actually sends, established by asking it rather than
   * by reading docs: `nextCursor{cursors,hasNext}`. Whether `cursors` is the
   * token itself or an object holding a `next` was not visible in that answer,
   * so cursorToken accepts either instead of guessing a fourth time.
   */
  nextCursor?: { cursors?: unknown; hasNext?: boolean } | null;
  /** The shape two earlier readings expected; still honoured if it ever appears. */
  pagingMetadata?: { cursors?: { next?: string | null } | null } | null;
}

/** The continuation token out of either cursor shape, or null. */
function cursorToken(res: WixMediaFilesResponse | null): string | null {
  const raw = res?.nextCursor?.cursors;
  if (typeof raw === "string") return raw || null;
  if (raw && typeof raw === "object") {
    const next = (raw as { next?: unknown }).next;
    if (typeof next === "string" && next) return next;
  }
  const legacy = res?.pagingMetadata?.cursors?.next;
  return typeof legacy === "string" && legacy ? legacy : null;
}

export async function listMediaFiles(
  siteId: string,
  parentFolderId: string,
  options: ListMediaFilesOptions = {}
): Promise<ListMediaFilesResult> {
  const { deadline, startOffset = 0, maxPages = FILE_PAGE_CAP } = options;
  const files: WixMediaFile[] = [];
  // Every id already returned. The endpoint answers cursor paging; where it
  // does not understand paging.offset it silently ignores it and serves the
  // same first page forever -- which is what Parrish did: 157 requests, 15,700
  // entries, about a hundred distinct files, a scan cursor that climbed past
  // 30,000 without ever reaching an end, and an audit that called 13,932
  // photos "outside the folder" because it never saw them. Repeating is the
  // only evidence available that paging is not advancing, so it is what stops
  // the walk.
  const seen = new Set<string>();
  let offset = Math.max(0, startOffset);
  let cursor: string | null = null;
  let shape: string[] = [];
  for (let page = 0; page < Math.min(maxPages, FILE_PAGE_CAP); page += 1) {
    if (deadline !== undefined && Date.now() > deadline) return { files, truncated: true, nextOffset: offset, shape };
    const paging: string = cursor
      ? `paging.cursor=${encodeURIComponent(cursor)}`
      : `paging.limit=${FILE_PAGE}&paging.offset=${offset}`;
    const res: WixMediaFilesResponse | null = await wixRequest<WixMediaFilesResponse>(
      siteId,
      "GET",
      `/site-media/v1/files?parentFolderId=${encodeURIComponent(parentFolderId)}&${paging}`
    );
    if (!shape.length) shape = envelopeShape(res);
    const batch: WixMediaFile[] = res?.files ?? [];
    const fresh = batch.filter((f) => typeof f.id === "string" && !seen.has(f.id));
    for (const f of fresh) seen.add(f.id);
    files.push(...fresh);
    offset += batch.length;
    // Whether this endpoint pages by cursor at all, which decides what counts
    // as the end below. Offered-and-null is the last page; never offered means
    // offset paging, where a short page is the end.
    const offers = !!res?.nextCursor || !!res?.pagingMetadata?.cursors;
    const moreToCome = res?.nextCursor?.hasNext;
    cursor = cursorToken(res);
    const done = { files, truncated: false, nextOffset: 0, shape };
    // Nothing new on a page that had rows: paging is not moving, so neither
    // are we. Truncated, because what we hold is the first page and not the
    // folder -- a caller told otherwise would treat every file it never saw
    // as absent, which is the reading that put 13,932 of Parrish's photos
    // "outside" a folder they were in. nextOffset 0 because there is no later
    // page to resume at; the next scan starts over rather than climbing.
    if (batch.length && !fresh.length) return { files, truncated: true, nextOffset: 0, shape };
    // hasNext is the endpoint's own word for it, and it is the last page even
    // on a full one. A missing cursor says the same thing.
    if (offers && (moreToCome === false || !cursor)) return done;
    // Without cursors, a short page is the end of the folder.
    if (!offers && batch.length < FILE_PAGE) return done;
  }
  return { files, truncated: true, nextOffset: offset, shape };
}

export interface MediaFileProbe {
  /** The path asked for, so the report says what was tried. */
  path: string;
  ok: boolean;
  /** HTTP status when the call failed, or null when it threw for another reason. */
  status: number | null;
  /** The envelope, key names only, when it succeeded. */
  shape: string[];
  /** Why it failed, trimmed. */
  error: string | null;
}

/**
 * Asks Wix about one file by id, and reports what came back.
 *
 * Listing a folder is the wrong shape for the question the engine actually
 * has, which is never "what is in this folder" but always "does Wix hold a
 * picture for this file". Per-file lookup would not depend on paging at all,
 * and would ask only about the engine's own photos rather than wading through
 * an orphan-filled folder. Whether that endpoint exists on this API is the
 * other thing worth knowing from the one diagnostic press, so it is asked
 * alongside the listing's shape.
 */
export async function probeMediaFile(siteId: string, fileId: string): Promise<MediaFileProbe> {
  const path = `/site-media/v1/files/${encodeURIComponent(fileId)}`;
  try {
    const res = await wixRequest<unknown>(siteId, "GET", path);
    return { path, ok: true, status: 200, shape: envelopeShape(res), error: null };
  } catch (error) {
    const status = error instanceof WixApiError ? error.status : null;
    return { path, ok: false, status, shape: [], error: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }
}

export async function findMediaFolder(siteId: string, displayName: string): Promise<WixMediaFolder | null> {
  const wanted = displayName.trim().toLowerCase();
  const folders = await listMediaFolders(siteId);
  return folders.find((f) => typeof f.displayName === "string" && f.displayName.trim().toLowerCase() === wanted) ?? null;
}

// ---------------------------------------------------------------------------
// Bulk writes (listings engine). One call carries up to 1000 items and
// reports a per-item outcome instead of failing the whole call, so a
// 330-row reconcile is one request rather than 330 (Wix documents 200
// requests/minute per app instance). Endpoint shapes are from the Wix REST
// reference: POST /wix-data/v2/bulk/items/{insert|update|save|remove}.
// Verified against Longboat Key by scripts/listings-wix-phase1.mjs.
// ---------------------------------------------------------------------------

/** Items per bulk call accepted by the Wix Data API. Larger batches are chunked. */
export const WIX_BULK_LIMIT = 1000;
/**
 * Wix also caps the request body: 200 listings with 50-photo galleries
 * (about 5 MB) came back WDE0109 "Payload is too large", while 50 rows at
 * 453 KB went through in phase 1. Chunks stay under this many bytes of
 * JSON, and a chunk Wix still refuses is split in half and retried.
 */
export const WIX_BULK_MAX_BYTES = 800_000;

export interface WixBulkItemError {
  code?: string;
  description?: string;
  data?: Record<string, unknown>;
}

export interface WixBulkItemResult {
  /** Index into the array the caller passed in (chunking is invisible). */
  originalIndex: number;
  /** Item id Wix reports; a caller-supplied _id comes back unchanged. */
  id: string | null;
  success: boolean;
  /** What Wix did: INSERT, UPDATE or DELETE (save reports which one it chose). */
  action?: string;
  error?: WixBulkItemError;
  /** Present only when returnEntity was requested. */
  item?: WixDataItem;
}

export interface WixBulkResult {
  results: WixBulkItemResult[];
  totalSuccesses: number;
  totalFailures: number;
  /** Failures Wix could not attribute to a specific item. */
  undetailedFailures: number;
  /** API calls made (ceil(items / WIX_BULK_LIMIT)). */
  requests: number;
}

export interface BulkWriteOptions {
  /** Return the written items in results[].item (bigger responses). */
  returnEntity?: boolean;
  /**
   * Touch draft items too (collections with the publish plugin). Off by
   * default: the listings collections have no publish plugin.
   */
  includeDrafts?: boolean;
}

interface RawBulkResponse {
  results?: Array<{
    action?: string;
    itemMetadata?: {
      id?: string;
      originalIndex?: number;
      success?: boolean;
      error?: WixBulkItemError;
    };
    dataItem?: WixDataItem;
  }>;
  bulkActionMetadata?: {
    totalSuccesses?: number;
    totalFailures?: number;
    undetailedFailures?: number;
  };
}

function bulkRequestBody(
  collectionId: string,
  { returnEntity, includeDrafts }: BulkWriteOptions
): Record<string, unknown> {
  return {
    dataCollectionId: collectionId,
    ...(returnEntity ? { returnEntity: true } : {}),
    ...(includeDrafts ? { publishPluginOptions: { includeDraftItems: true } } : {}),
  };
}

interface BulkChunk {
  /** Index of the chunk's first entry in the caller's array. */
  start: number;
  entries: unknown[];
}

/** Splits entries by count and by serialized size (exported for tests). */
export function chunkBulkEntries(entries: unknown[], maxItems = WIX_BULK_LIMIT, maxBytes = WIX_BULK_MAX_BYTES): BulkChunk[] {
  const chunks: BulkChunk[] = [];
  let current: BulkChunk = { start: 0, entries: [] };
  let bytes = 0;
  entries.forEach((entry, index) => {
    const size = Buffer.byteLength(JSON.stringify(entry) ?? "");
    if (current.entries.length && (current.entries.length >= maxItems || bytes + size > maxBytes)) {
      chunks.push(current);
      current = { start: index, entries: [] };
      bytes = 0;
    }
    current.entries.push(entry);
    bytes += size;
  });
  if (current.entries.length) chunks.push(current);
  return chunks;
}

const isPayloadTooLarge = (error: unknown): error is WixApiError =>
  error instanceof WixApiError && error.status === 400 && /WDE0109|too large/i.test(error.body);

async function bulkWrite(
  siteId: string,
  operation: "insert" | "update" | "save" | "remove",
  body: Record<string, unknown>,
  entriesKey: "dataItems" | "dataItemIds",
  entries: unknown[]
): Promise<WixBulkResult> {
  const merged: WixBulkResult = {
    results: [],
    totalSuccesses: 0,
    totalFailures: 0,
    undetailedFailures: 0,
    requests: 0,
  };
  const queue = chunkBulkEntries(entries);
  while (queue.length) {
    const { start, entries: chunk } = queue.shift()!;
    let res: RawBulkResponse;
    try {
      res = await wixRequest<RawBulkResponse>(
        siteId,
        "POST",
        `/wix-data/v2/bulk/items/${operation}`,
        { ...body, [entriesKey]: chunk }
      );
    } catch (error) {
      if (!isPayloadTooLarge(error)) throw error;
      merged.requests += 1;
      if (chunk.length > 1) {
        // Wix's limit is not documented: halve the chunk and try again.
        const half = Math.ceil(chunk.length / 2);
        queue.unshift({ start, entries: chunk.slice(0, half) }, { start: start + half, entries: chunk.slice(half) });
        continue;
      }
      // One entry Wix will not take at any size: that entry's failure, not the run's.
      merged.results.push({
        originalIndex: start,
        id: null,
        success: false,
        error: { code: "WDE0109", description: "Payload is too large (single item)" },
      });
      merged.totalFailures += 1;
      continue;
    }
    merged.requests += 1;
    for (const result of res.results ?? []) {
      const meta = result.itemMetadata ?? {};
      merged.results.push({
        originalIndex: start + (meta.originalIndex ?? 0),
        id: meta.id ?? null,
        success: meta.success ?? false,
        action: result.action,
        error: meta.error,
        item: result.dataItem,
      });
    }
    const totals = res.bulkActionMetadata ?? {};
    merged.totalSuccesses += totals.totalSuccesses ?? 0;
    merged.totalFailures += totals.totalFailures ?? 0;
    merged.undetailedFailures += totals.undetailedFailures ?? 0;
  }
  merged.results.sort((a, b) => a.originalIndex - b.originalIndex);
  return merged;
}

/**
 * Inserts many items. A caller-supplied _id is kept (the engine keys listings
 * by MLS ListingId); an _id that already exists fails that item only.
 */
export async function bulkInsertItems(
  siteId: string,
  collectionId: string,
  items: WixItemData[],
  { asDraft = false, ...options }: BulkWriteOptions & { asDraft?: boolean } = {}
): Promise<WixBulkResult> {
  const dataItems = items.map((data) =>
    toDataItem(asDraft ? { ...data, _publishStatus: "DRAFT" } : data)
  );
  return bulkWrite(siteId, "insert", bulkRequestBody(collectionId, options), "dataItems", dataItems);
}

/**
 * Full-item update of many items (same PUT semantics as updateItem: each item
 * ends up with exactly the fields sent). An _id not in the collection fails
 * that item only.
 */
export async function bulkUpdateItems(
  siteId: string,
  collectionId: string,
  items: Array<WixItemData & { _id: string }>,
  options: BulkWriteOptions = {}
): Promise<WixBulkResult> {
  const dataItems = items.map(toDataItem);
  return bulkWrite(siteId, "update", bulkRequestBody(collectionId, options), "dataItems", dataItems);
}

/**
 * Upsert: an item whose _id exists is replaced, any other is inserted (with
 * its _id when given). This is the reconcile write: the first live run is
 * an upsert over ids the site already has, not an insert flood.
 */
export async function bulkSaveItems(
  siteId: string,
  collectionId: string,
  items: WixItemData[],
  options: BulkWriteOptions = {}
): Promise<WixBulkResult> {
  const dataItems = items.map(toDataItem);
  return bulkWrite(siteId, "save", bulkRequestBody(collectionId, options), "dataItems", dataItems);
}

/** Removes many items by id; an unknown id fails that item only. */
export async function bulkRemoveItems(
  siteId: string,
  collectionId: string,
  itemIds: string[],
  options: Pick<BulkWriteOptions, "includeDrafts"> = {}
): Promise<WixBulkResult> {
  return bulkWrite(siteId, "remove", bulkRequestBody(collectionId, options), "dataItemIds", itemIds);
}
