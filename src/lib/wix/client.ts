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

class WixApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    context: string
  ) {
    super(`Wix API ${context}: ${status} ${body.slice(0, 300)}`);
    this.name = "WixApiError";
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
    logger.error("Wix API request failed", {
      method,
      path,
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new WixApiError(res.status, text, `${method} ${path}`);
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
 * Inserts an item. With asDraft, the item lands as a CMS draft: invisible
 * to the live site until a human publishes it in the Wix CMS UI.
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
      dataItem: { data: asDraft ? { ...data, _publishStatus: "DRAFT" } : data },
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
