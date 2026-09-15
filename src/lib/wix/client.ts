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
    super(`Wix API ${context}: ${status} ${body.slice(0, 300)}`);
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

export interface ImportedMediaFile {
  id: string;
  url: string;
  displayName: string;
}

/** Imports an external image URL into the site's Media Manager. */
export async function importMediaFromUrl(
  siteId: string,
  sourceUrl: string,
  displayName: string
): Promise<ImportedMediaFile> {
  const res = await wixRequest<{
    file: { id: string; url: string; displayName: string };
  }>(siteId, "POST", "/site-media/v1/files/import", {
    url: sourceUrl,
    displayName,
  });
  return res.file;
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
