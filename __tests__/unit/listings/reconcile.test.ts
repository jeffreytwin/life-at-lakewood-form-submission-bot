import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../fixtures/listings/mlsgrid-property.json";

vi.mock("@/lib/shared/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/listings/db", () => ({
  chunk: <T,>(items: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  },
  mediaKey: (listingId: string, pathKey: string) => `${listingId}::${pathKey}`,
  loadActiveSites: vi.fn(),
  loadVillagesWithTerms: vi.fn(),
  upsertListings: vi.fn(),
  loadKnownListingIds: vi.fn(),
  markNotInFeed: vi.fn(),
  loadListings: vi.fn(),
  replaceListingMedia: vi.fn(),
  loadSiteListings: vi.fn(),
  upsertSiteListings: vi.fn(),
  loadWritableSiteListings: vi.fn(),
  loadPendingRemovals: vi.fn(),
  countLiveSiteListings: vi.fn(),
  loadSiteGalleries: vi.fn(),
  refreshVillageCounts: vi.fn(),
}));
vi.mock("@/lib/listings/runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/runs")>();
  return {
    emptyCounts: actual.emptyCounts,
    startRun: vi.fn(),
    previousRunStartedAt: vi.fn(),
    lastCompleteIncrementalStartedAt: vi.fn(),
  };
});
vi.mock("@/lib/listings/media-seed", () => ({
  seedSiteMediaFromLive: vi.fn(),
}));
vi.mock("@/lib/listings/village-stats", () => ({
  refreshVillageStatsOnWix: vi.fn(async () => ({ villages: 0, changed: 0, written: 0, failed: 0, zeroInventory: 0, remaining: false, requests: 0 })),
}));
vi.mock("@/lib/listings/photos", () => ({
  runPhotoJob: vi.fn(async () => ({ listings: 0, refreshed: 0, downloaded: 0, reused: 0, imported: 0, failed: 0, truncated: false })),
}));
vi.mock("@/lib/wix/client", () => ({
  WixApiError: class WixApiError extends Error {
    rateLimited = false;
  },
  bulkSaveItems: vi.fn(),
  bulkRemoveItems: vi.fn(),
}));

import * as db from "@/lib/listings/db";
import { emptyCounts, lastCompleteIncrementalStartedAt, previousRunStartedAt, startRun, type RunHandle } from "@/lib/listings/runs";
import { seedSiteMediaFromLive } from "@/lib/listings/media-seed";
import { bulkRemoveItems, bulkSaveItems, type WixItemData } from "@/lib/wix/client";
import { normalizeListing } from "@/lib/listings/normalize";
import { runReconcile } from "@/lib/listings/reconcile";
import type { MlsGridClient } from "@/lib/listings/mlsgrid";
import type { LsSite, LsSiteListing, MlsGridProperty, VillageWithTerms } from "@/lib/listings/types";

const raw = fixture as unknown as MlsGridProperty;
const FIXTURE_ID = raw.ListingId; // MFRA4670555, Longboat Key, Active, BAY ISLES HARBOR SECTION
const NOW = new Date("2026-09-15T12:00:00.000Z");
const HOUR = 3600_000;

const site: LsSite = {
  id: "site-lbk",
  name: "Life in Longboat Key",
  domain: "lifeinlongboatkey.com",
  wix_site_id: "8b20e921-5b70-4428-8fcd-8c8ef3bad3ab",
  target_collection_id: "HousesforSale2",
  live_collection_id: "HousesforSale",
  villages_collection_id: "HousesforSale-DynamicPages",
  write_mode: "shadow",
  market_cities: ["Longboat Key"],
  property_types: ["Residential", "Land"],
  show_new_construction: false,
  active: true,
  timezone: "America/New_York",
  media_folder_name: null,
  media_folder_id: null,
};

const village: VillageWithTerms = {
  id: "v-bay-isles",
  site_id: site.id,
  name: "Bay Isles - Harbor Section",
  wix_slug: "bay-isles-harbor-section",
  wix_item_id: "bc8b3074-9ef5-4cf7-88bd-1886c7df5c8e",
  page_url: "https://www.lifeinlongboatkey.com/neighborhood/bay-isles-harbor-section",
  display: {},
  active: true,
  active_listing_count: 0,
  zero_since: null,
  terms: [{ term: "bay isles", street_term: null }],
};

function siteListing(listingId: string, patch: Partial<LsSiteListing> = {}): LsSiteListing {
  return {
    id: `sl-${listingId}`,
    site_id: site.id,
    listing_id: listingId,
    state: "staged",
    village_id: village.id,
    wix_item_id: null,
    reason_code: null,
    reason_detail: null,
    gallery_ready: false,
    needs_write: true,
    written_at: null,
    written_fingerprint: null,
    live_at: null,
    removed_at: null,
    ...patch,
  };
}

interface RecordedEvent {
  level: string;
  kind: string;
  message: string;
  fields?: Record<string, unknown>;
}

function fakeRun(mode: "incremental" | "full"): { handle: RunHandle; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const counts = emptyCounts();
  const handle: RunHandle = {
    id: "run-1",
    runKey: `${mode}:${NOW.toISOString()}`,
    mode,
    siteId: null,
    startedAt: NOW,
    stage: "start",
    counts,
    event: (level, kind, message, fields) => {
      if (level === "warn") counts.warnings += 1;
      if (level === "error") counts.errors += 1;
      events.push({ level, kind, message, fields: fields as Record<string, unknown> | undefined });
    },
    flush: async () => {},
    checkpoint: async (stage) => {
      handle.stage = stage;
    },
    finish: async () => {},
  };
  return { handle, events };
}

function fakeClient(args: { modified?: MlsGridProperty[]; byId?: MlsGridProperty[]; truncated?: boolean }): MlsGridClient & { fetchModifiedSince: ReturnType<typeof vi.fn>; fetchByIds: ReturnType<typeof vi.fn> } {
  const client = {
    stats: { requests: 0, bytes: 0, retries: 0, rateLimited: 0 },
    fetchModifiedSince: vi.fn(async () => {
      client.stats.requests += 2;
      client.stats.bytes += 4096;
      return { items: args.modified ?? [], expectedCount: (args.modified ?? []).length, requestCount: 2, pages: 2, truncated: !!args.truncated };
    }),
    fetchByIds: vi.fn(async (ids: string[]) => {
      client.stats.requests += 1;
      return { items: args.byId ?? [], requestedIds: ids, requestCount: 1, truncated: false, verifiedIds: ids };
    }),
  };
  return client as unknown as MlsGridClient & { fetchModifiedSince: ReturnType<typeof vi.fn>; fetchByIds: ReturnType<typeof vi.fn> };
}

const okBulk = (action: string) =>
  async (_site: string, _collection: string, items: Array<WixItemData | string>) => ({
    results: items.map((item, i) => ({ originalIndex: i, id: typeof item === "string" ? item : String(item._id), success: true, action })),
    totalSuccesses: items.length,
    totalFailures: 0,
    undetailedFailures: 0,
    requests: 1,
  });

const patches = () => vi.mocked(db.upsertSiteListings).mock.calls.flatMap(([rows]) => rows);

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.mocked(db.loadActiveSites).mockResolvedValue([site]);
  vi.mocked(db.loadVillagesWithTerms).mockResolvedValue([village]);
  vi.mocked(db.upsertListings).mockResolvedValue();
  vi.mocked(db.replaceListingMedia).mockResolvedValue({ removed: 0 });
  vi.mocked(db.markNotInFeed).mockResolvedValue();
  vi.mocked(db.upsertSiteListings).mockResolvedValue();
  vi.mocked(db.loadListings).mockResolvedValue(new Map());
  vi.mocked(db.loadSiteListings).mockResolvedValue(new Map());
  vi.mocked(db.loadWritableSiteListings).mockResolvedValue([]);
  vi.mocked(db.loadPendingRemovals).mockResolvedValue([]);
  vi.mocked(db.loadSiteGalleries).mockResolvedValue(new Map());
  vi.mocked(db.countLiveSiteListings).mockResolvedValue(150);
  vi.mocked(db.refreshVillageCounts).mockResolvedValue({ changed: 0 });
  vi.mocked(db.loadKnownListingIds).mockResolvedValue([]);
  vi.mocked(previousRunStartedAt).mockResolvedValue(null);
  vi.mocked(lastCompleteIncrementalStartedAt).mockResolvedValue(new Date(NOW.getTime() - HOUR));
  vi.mocked(seedSiteMediaFromLive).mockResolvedValue({ liveItems: 202, galleryItems: 0, unkeyed: 0, placeholders: 0, mediaRows: 0, siteMediaRows: 0, refreshed: 3 });
  vi.mocked(bulkSaveItems).mockImplementation(okBulk("INSERT"));
  vi.mocked(bulkRemoveItems).mockImplementation(okBulk("DELETE"));
});

describe("runReconcile (incremental)", () => {
  it("stores only relevant records, stages the eligible one, writes it with the photos the site has, and removes the one that left", async () => {
    const { handle, events } = fakeRun("incremental");
    vi.mocked(startRun).mockResolvedValue(handle);
    vi.mocked(previousRunStartedAt).mockResolvedValue(new Date(NOW.getTime() - 3 * HOUR));

    const movedAway: MlsGridProperty = { ...raw, ListingId: "MFRKNOWN1", City: "Sarasota", Media: [] };
    const stranger: MlsGridProperty = { ...raw, ListingId: "MFRSTRANGER", City: "Sarasota", Media: [] };
    const client = fakeClient({ modified: [raw, stranger, movedAway] });
    vi.mocked(db.loadKnownListingIds).mockResolvedValue(["MFRKNOWN1"]);
    vi.mocked(db.loadSiteListings).mockResolvedValue(
      new Map([["MFRKNOWN1", siteListing("MFRKNOWN1", { state: "live", wix_item_id: "MFRKNOWN1", written_at: NOW.toISOString(), live_at: NOW.toISOString() })]])
    );

    // What the write phase finds after classification.
    const { listing, media } = normalizeListing(raw, NOW);
    vi.mocked(db.loadWritableSiteListings).mockResolvedValue([siteListing(FIXTURE_ID)]);
    vi.mocked(db.loadListings).mockResolvedValue(new Map([[FIXTURE_ID, listing]]));
    vi.mocked(db.loadSiteGalleries).mockResolvedValue(
      new Map([[FIXTURE_ID, media.map((m, i) => ({ mediaId: `m${i}`, position: m.position, pathKey: m.path_key, title: m.title, src: i === 0 ? "wix:image://v1/d0be81_seed~mv2.jpg/1.jpg" : null }))]])
    );
    vi.mocked(db.loadPendingRemovals).mockResolvedValue([
      siteListing("MFRKNOWN1", { state: "removed", wix_item_id: "MFRKNOWN1", reason_code: "city_change", reason_detail: 'City is "Sarasota", outside the site\'s market' }),
    ]);
    vi.mocked(db.refreshVillageCounts).mockResolvedValue({ changed: 1 });

    const result = await runReconcile({ mode: "incremental", trigger: "hub", deadline: NOW.getTime() + 240_000, client });

    expect(result).toMatchObject({ status: "ok", stage: "done", truncated: false, fetched: 3, relevant: 2, missing: 0 });
    expect(handle.counts.gap_minutes).toBe(180);

    // Shadow mode re-reads the live galleries before anything else.
    expect(seedSiteMediaFromLive).toHaveBeenCalledWith(site);
    expect(events.find((e) => e.kind === "seed")?.message).toContain("3 URI(s) refreshed");
    expect(events.find((e) => e.kind === "gap")?.level).toBe("warn");

    // The watermark minus the two-minute overlap.
    const since = client.fetchModifiedSince.mock.calls[0][0] as Date;
    expect(since.toISOString()).toBe(new Date(NOW.getTime() - HOUR - 120_000).toISOString());

    // The stranger never reaches storage.
    const stored = vi.mocked(db.upsertListings).mock.calls[0][0].map((l) => l.listing_id).sort();
    expect(stored).toEqual([FIXTURE_ID, "MFRKNOWN1"]);

    // Classification: one staged, one removed for its city.
    expect(patches()).toContainEqual(expect.objectContaining({ listing_id: FIXTURE_ID, state: "staged", village_id: village.id, needs_write: true, staged_at: NOW.toISOString() }));
    expect(patches()).toContainEqual(expect.objectContaining({ listing_id: "MFRKNOWN1", state: "removed", reason_code: "city_change", needs_write: true }));

    // One bulk save to the shadow collection with the seeded photo only.
    expect(bulkSaveItems).toHaveBeenCalledTimes(1);
    const [siteId, collection, records] = vi.mocked(bulkSaveItems).mock.calls[0];
    expect(siteId).toBe(site.wix_site_id);
    expect(collection).toBe("HousesforSale2");
    expect(records).toHaveLength(1);
    const record = records[0] as WixItemData;
    expect(record._id).toBe(FIXTURE_ID);
    expect(record.village).toBe(village.name);
    expect(record.listingImageGallery).toHaveLength(1);
    expect(JSON.stringify(record)).not.toContain("media.mlsgrid.com");

    expect(patches()).toContainEqual(expect.objectContaining({ listing_id: FIXTURE_ID, state: "live", wix_item_id: FIXTURE_ID, gallery_ready: false, needs_write: false, written_fingerprint: expect.any(String) }));
    const insert = events.find((e) => e.kind === "insert");
    expect(insert?.level).toBe("warn");
    expect(insert?.message).toContain("photos pending");

    // The removal is applied (1 of 150 is under the guard) and the Wix id cleared.
    expect(bulkRemoveItems).toHaveBeenCalledWith(site.wix_site_id, "HousesforSale2", ["MFRKNOWN1"]);
    expect(patches()).toContainEqual(expect.objectContaining({ listing_id: "MFRKNOWN1", wix_item_id: null, needs_write: false }));
    expect(events.find((e) => e.kind === "delete")?.level).toBe("warn");

    expect(result.sites[0]).toMatchObject({ inserted: 1, updated: 0, deleted: 1, held: 0, failed: 0, villagesChanged: 1, eligible: 1, removedNow: 1 });
    expect(handle.counts).toMatchObject({ inserted: 1, deleted: 1, wix_requests: 2, mlsgrid_request_count: 2, mlsgrid_items_fetched: 3 });
  });

  it("marks a truncated pull so the watermark stays put", async () => {
    const { handle, events } = fakeRun("incremental");
    vi.mocked(startRun).mockResolvedValue(handle);
    const result = await runReconcile({ mode: "incremental", trigger: "cron", deadline: NOW.getTime() + 240_000, client: fakeClient({ modified: [], truncated: true }) });
    expect(result).toMatchObject({ status: "ok", stage: "truncated", truncated: true });
    expect(events.find((e) => e.kind === "budget")?.level).toBe("warn");
  });

  it("refuses to write when a shadow site points at its live collection", async () => {
    const { handle, events } = fakeRun("incremental");
    vi.mocked(startRun).mockResolvedValue(handle);
    vi.mocked(db.loadActiveSites).mockResolvedValue([{ ...site, target_collection_id: "HousesforSale" }]);
    const result = await runReconcile({ mode: "incremental", trigger: "cron", deadline: NOW.getTime() + 240_000, client: fakeClient({ modified: [raw] }) });
    expect(result.sites[0].skipped).toMatch(/live collection/);
    expect(events.some((e) => e.kind === "write_failed" && e.level === "error")).toBe(true);
    expect(seedSiteMediaFromLive).not.toHaveBeenCalled();
    expect(bulkSaveItems).not.toHaveBeenCalled();
    expect(bulkRemoveItems).not.toHaveBeenCalled();
  });
});

describe("runReconcile (full)", () => {
  it("verifies the held ids and treats the ones MLSGrid dropped as not in the feed", async () => {
    const { handle } = fakeRun("full");
    vi.mocked(startRun).mockResolvedValue(handle);
    vi.mocked(db.loadKnownListingIds).mockResolvedValue([FIXTURE_ID, "MFRGONE1"]);
    vi.mocked(db.loadSiteListings).mockResolvedValue(new Map([["MFRGONE1", siteListing("MFRGONE1", { state: "live", wix_item_id: "MFRGONE1" })]]));
    const client = fakeClient({ byId: [raw] });

    const result = await runReconcile({ mode: "full", trigger: "cron", deadline: NOW.getTime() + 240_000, client });

    expect(client.fetchByIds).toHaveBeenCalledWith([FIXTURE_ID, "MFRGONE1"], expect.anything());
    expect(client.fetchModifiedSince).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ok", fetched: 1, relevant: 1, missing: 1 });
    expect(db.markNotInFeed).toHaveBeenCalledWith(["MFRGONE1"], NOW);
    expect(patches()).toContainEqual(expect.objectContaining({ listing_id: "MFRGONE1", state: "removed", reason_code: "not_in_feed" }));
    expect(patches()).toContainEqual(expect.objectContaining({ listing_id: FIXTURE_ID, state: "staged" }));
  });

  it("holds a removal batch at the guard threshold and says so", async () => {
    const { handle, events } = fakeRun("full");
    vi.mocked(startRun).mockResolvedValue(handle);
    vi.mocked(db.countLiveSiteListings).mockResolvedValue(20);
    vi.mocked(db.loadPendingRemovals).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => siteListing(`MFRX${i}`, { state: "removed", wix_item_id: `MFRX${i}`, reason_code: "not_in_feed" }))
    );
    const result = await runReconcile({ mode: "full", trigger: "cron", deadline: NOW.getTime() + 240_000, client: fakeClient({ byId: [] }) });
    expect(bulkRemoveItems).not.toHaveBeenCalled();
    expect(result.sites[0]).toMatchObject({ held: 10, deleted: 0 });
    const guard = events.find((e) => e.kind === "mass_delete_guard");
    expect(guard?.level).toBe("error");
    expect(guard?.message).toContain("10 of 20");
  });
});
