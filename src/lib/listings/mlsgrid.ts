// MLSGrid OData client for replication (docs.mlsgrid.com), ported from the
// Longboat Key Velo backend (backend/sync/mlsgrid.jsw) with the caps MLSGrid
// documents built in: one request in flight at a time, spaced so the run
// never exceeds 2 requests/s (the first cap; the others are 7,200 an hour,
// 4 GB an hour and 40,000 a day), and a 429 stops the run instead of
// retrying into a longer token suspension. Every response is counted
// (requests, bytes) so a run can be set against MLSGrid's usage dashboard.
//
// Replication queries only allow a few filter fields; PostalCity is not one
// of them, so the incremental pull is MLS-wide and the engine filters by
// city itself (classify.ts).

import type { MlsGridProperty } from "@/lib/listings/types";

export const MLSGRID_BASE = "https://api.mlsgrid.com/v2/Property";
export const ORIGINATING_SYSTEM = "mfrmls";
export const PAGE_SIZE = 200;
export const FETCH_BY_ID_BATCH = 50;
/** 2 requests/s is the cap; 600 ms spacing keeps a run at about 1.7. */
export const MIN_REQUEST_INTERVAL_MS = 600;
const LISTING_ID_PREFIX = "MFR";
const EXPAND = "Media";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 60_000;

export interface MlsGridStats {
  requests: number;
  bytes: number;
  retries: number;
  rateLimited: number;
}

export class MlsGridError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly rateLimited = false,
    public readonly body = ""
  ) {
    super(message);
    this.name = "MlsGridError";
  }
}

interface ODataPage {
  value?: MlsGridProperty[];
  "@odata.count"?: number;
  "@odata.nextLink"?: string;
}

export interface MlsGridClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PagedFetchOptions {
  /** Stop after this many pages (each up to PAGE_SIZE records). */
  maxPages?: number;
  /** Epoch ms; no new page is requested past it. */
  deadline?: number;
}

export interface ModifiedSinceResult {
  items: MlsGridProperty[];
  /** What MLSGrid said the filter matched (MLS-wide), when it said. */
  expectedCount: number | null;
  requestCount: number;
  pages: number;
  /** True when maxPages or the deadline stopped paging before the end. */
  truncated: boolean;
}

export interface ActiveScanOptions {
  /**
   * Resume a scan: only records modified after this instant. MLSGrid
   * returns replication results in ModificationTimestamp order, so the
   * last timestamp a run saw is where the next run starts; a stale
   * @odata.nextLink is refused ("$skip value is very high").
   */
  since?: Date | null;
  maxPages?: number;
  /** Epoch ms; no new page is requested past it. */
  deadline?: number;
}

export interface ActiveScanResult {
  items: MlsGridProperty[];
  /** MLSGrid's count for the filter (the remainder, when resuming), when the first page said. */
  expectedCount: number | null;
  requestCount: number;
  pages: number;
  /** The newest ModificationTimestamp among the records read; the next run resumes after it. Null when nothing was read. */
  lastModificationTimestamp: string | null;
  /** False when a page came back out of ModificationTimestamp order (the resume point may then skip records). */
  ordered: boolean;
  truncated: boolean;
}

export interface ByIdsResult {
  items: MlsGridProperty[];
  requestedIds: string[];
  requestCount: number;
  /** True when the deadline stopped the batches before every id was verified. */
  truncated: boolean;
  /** Ids in batches that were actually fetched (only these can be judged missing). */
  verifiedIds: string[];
}

export function normalizeListingId(id: string): string {
  const trimmed = String(id).trim();
  return trimmed.startsWith(LISTING_ID_PREFIX) ? trimmed : `${LISTING_ID_PREFIX}${trimmed}`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MlsGridClient {
  readonly stats: MlsGridStats = { requests: 0, bytes: 0, retries: 0, rateLimited: 0 };
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastRequestAt = 0;

  constructor(options: MlsGridClientOptions = {}) {
    const token = options.token ?? process.env.MLSGRID_API_KEY;
    if (!token) throw new MlsGridError("Missing MLSGRID_API_KEY environment variable", null);
    this.token = token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** Pulls every record modified since `since` (MLS-wide), page by page. */
  async fetchModifiedSince(since: Date, options: PagedFetchOptions = {}): Promise<ModifiedSinceResult> {
    const filter = `OriginatingSystemName eq '${ORIGINATING_SYSTEM}' and ModificationTimestamp gt ${since.toISOString()}`;
    let url: string | null =
      `${MLSGRID_BASE}?$filter=${encodeURIComponent(filter)}&$expand=${EXPAND}&$top=${PAGE_SIZE}&$count=true`;
    const items: MlsGridProperty[] = [];
    let expectedCount: number | null = null;
    let requestCount = 0;
    let pages = 0;
    let truncated = false;
    while (url) {
      if (options.deadline && this.now() > options.deadline) {
        truncated = true;
        break;
      }
      if (options.maxPages && pages >= options.maxPages) {
        truncated = true;
        break;
      }
      const page: ODataPage = await this.request(url);
      requestCount += 1;
      pages += 1;
      if (expectedCount === null && typeof page["@odata.count"] === "number") {
        expectedCount = page["@odata.count"];
      }
      if (Array.isArray(page.value)) items.push(...page.value);
      url = page["@odata.nextLink"] ?? null;
    }
    return { items, expectedCount, requestCount, pages, truncated };
  }

  /**
   * Every Active listing MLS-wide, without Media: a discovery pass keeps the
   * ids in a site's market and pulls those by id. StandardStatus is one of
   * the fields MLSGrid accepts in a replication $filter (City is not).
   */
  async fetchActive(options: ActiveScanOptions = {}): Promise<ActiveScanResult> {
    const since = options.since ? ` and ModificationTimestamp gt ${options.since.toISOString()}` : "";
    const filter = `OriginatingSystemName eq '${ORIGINATING_SYSTEM}' and StandardStatus eq 'Active'${since}`;
    let url: string | null = `${MLSGRID_BASE}?$filter=${encodeURIComponent(filter)}&$top=${PAGE_SIZE}&$count=true`;
    const items: MlsGridProperty[] = [];
    let expectedCount: number | null = null;
    let requestCount = 0;
    let pages = 0;
    let truncated = false;
    let last: string | null = null;
    let ordered = true;
    while (url) {
      if (options.deadline && this.now() > options.deadline) {
        truncated = true;
        break;
      }
      if (options.maxPages && pages >= options.maxPages) {
        truncated = true;
        break;
      }
      const page: ODataPage = await this.request(url);
      requestCount += 1;
      pages += 1;
      if (expectedCount === null && typeof page["@odata.count"] === "number") {
        expectedCount = page["@odata.count"];
      }
      if (Array.isArray(page.value)) {
        items.push(...page.value);
        for (const raw of page.value) {
          const ts = typeof raw.ModificationTimestamp === "string" ? raw.ModificationTimestamp : null;
          if (!ts) continue;
          if (last && ts < last) ordered = false;
          if (!last || ts > last) last = ts;
        }
      }
      url = page["@odata.nextLink"] ?? null;
    }
    return { items, expectedCount, requestCount, pages, lastModificationTimestamp: last, ordered, truncated };
  }

  /** Verify-by-id: the current state of specific listings, 50 per request. */
  async fetchByIds(rawIds: string[], options: Pick<PagedFetchOptions, "deadline"> = {}): Promise<ByIdsResult> {
    const ids = [...new Set(rawIds.filter(Boolean).map(normalizeListingId))];
    const items: MlsGridProperty[] = [];
    const verifiedIds: string[] = [];
    let requestCount = 0;
    let truncated = false;
    for (let i = 0; i < ids.length; i += FETCH_BY_ID_BATCH) {
      if (options.deadline && this.now() > options.deadline) {
        truncated = true;
        break;
      }
      const batch = ids.slice(i, i + FETCH_BY_ID_BATCH);
      const idList = batch.map((id) => `'${id}'`).join(",");
      const filter = `OriginatingSystemName eq '${ORIGINATING_SYSTEM}' and ListingId in (${idList})`;
      let url: string | null = `${MLSGRID_BASE}?$filter=${encodeURIComponent(filter)}&$expand=${EXPAND}&$top=${PAGE_SIZE}`;
      while (url) {
        const page: ODataPage = await this.request(url);
        requestCount += 1;
        if (Array.isArray(page.value)) items.push(...page.value);
        url = page["@odata.nextLink"] ?? null;
      }
      verifiedIds.push(...batch);
    }
    return { items, requestedIds: ids, requestCount, truncated, verifiedIds };
  }

  /** One listing by id, or null when MLSGrid does not return it. */
  async fetchOne(listingId: string): Promise<MlsGridProperty | null> {
    const result = await this.fetchByIds([listingId]);
    return result.items[0] ?? null;
  }

  private async request(url: string): Promise<ODataPage> {
    let attempt = 0;
    for (;;) {
      await this.pace();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          attempt += 1;
          this.stats.retries += 1;
          await this.sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw new MlsGridError(`MLSGrid request failed: ${error instanceof Error ? error.message : String(error)}`, null);
      }
      const text = await res.text();
      this.stats.requests += 1;
      this.stats.bytes += Buffer.byteLength(text);
      if (res.status === 429) {
        this.stats.rateLimited += 1;
        throw new MlsGridError(`MLSGrid rate limited (429): ${text.slice(0, 300)}`, 429, true, text);
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        attempt += 1;
        this.stats.retries += 1;
        await this.sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      if (!res.ok) {
        throw new MlsGridError(`MLSGrid ${res.status}: ${text.slice(0, 300)}`, res.status, false, text);
      }
      try {
        return JSON.parse(text) as ODataPage;
      } catch {
        throw new MlsGridError(`MLSGrid returned non-JSON (${res.status})`, res.status, false, text.slice(0, 300));
      }
    }
  }

  /** Keeps consecutive requests MIN_REQUEST_INTERVAL_MS apart. */
  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + MIN_REQUEST_INTERVAL_MS - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }
}
