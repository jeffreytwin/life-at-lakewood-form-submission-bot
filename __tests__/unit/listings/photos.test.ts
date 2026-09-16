import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/wix/client", () => ({ importMediaFromUrl: vi.fn() }));
vi.mock("@/lib/listings/db", () => ({
  loadActiveSites: vi.fn(),
  loadPhotoBacklog: vi.fn(),
  replaceListingMedia: vi.fn(),
  updateListingMedia: vi.fn(),
  coolDownListingMedia: vi.fn(),
  findStoredByHash: vi.fn(),
  upsertSiteMedia: vi.fn(),
  upsertSiteListings: vi.fn(),
}));
vi.mock("@/lib/listings/runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/runs")>();
  return { emptyCounts: actual.emptyCounts, startRun: vi.fn() };
});

import * as db from "@/lib/listings/db";
import { emptyCounts, startRun, type RunHandle } from "@/lib/listings/runs";
import { displayNameFor, hasFreshUrl, runPhotoJob, runStandalonePhotoJob, withTimeout, FOLDER_LOOKUP_TIMEOUT_MS, FRESH_URL_MS, RETRY_AFTER_MS, type PhotoDeps } from "@/lib/listings/photos";
import type { MlsGridClient } from "@/lib/listings/mlsgrid";
import type { LsSite, MlsGridProperty } from "@/lib/listings/types";

const NOW = Date.parse("2026-09-15T18:00:00.000Z");
const MINUTE = 60_000;

const site: LsSite = {
  id: "site-lbk",
  name: "Life in Longboat Key",
  domain: "lifeinlongboatkey.com",
  wix_site_id: "wix-lbk",
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

interface RecordedEvent {
  level: string;
  kind: string;
  message: string;
  fields?: Record<string, unknown>;
}

function fakeRun(): { handle: RunHandle; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const counts = emptyCounts();
  const handle: RunHandle = {
    id: "run-p",
    runKey: `photos:${new Date(NOW).toISOString()}`,
    mode: "photos",
    siteId: null,
    startedAt: new Date(NOW),
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
    finish: vi.fn(async () => {}),
  };
  return { handle, events };
}

function row(listingId: string, position: number, patch: Partial<db.PhotoBacklogRow> = {}): db.PhotoBacklogRow {
  return {
    listing_id: listingId,
    media_id: `m-${listingId}-${position}`,
    position,
    path_key: `images/${listingId}/p${position}.jpeg`,
    title: null,
    source_url: `https://media.mlsgrid.com/token=t&expires=e/images/${listingId}/p${position}.jpeg`,
    source_url_received_at: new Date(NOW - MINUTE).toISOString(),
    storage_path: null,
    content_hash: null,
    retry_after: null,
    download_attempts: 0,
    site_ids: [site.id],
    ...patch,
  };
}

function fakeDeps(overrides: Partial<PhotoDeps> = {}): PhotoDeps {
  let fileNo = 0;
  return {
    now: () => NOW,
    sleep: async () => {},
    download: vi.fn(async () => ({ status: 200, bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" })),
    store: vi.fn(async () => {}),
    publicUrl: (path: string) => `https://cdn.test/${path}`,
    importToWix: vi.fn(async () => ({ id: `file-${++fileNo}` })),
    findFolder: vi.fn(async () => null),
    cacheFolder: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeClient(records: MlsGridProperty[]): MlsGridClient & { fetchByIds: ReturnType<typeof vi.fn> } {
  const client = {
    stats: { requests: 0, bytes: 0, retries: 0, rateLimited: 0 },
    fetchByIds: vi.fn(async (ids: string[]) => {
      client.stats.requests += 1;
      return { items: records, requestedIds: ids, requestCount: 1, truncated: false, verifiedIds: ids };
    }),
  };
  return client as unknown as MlsGridClient & { fetchByIds: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.findStoredByHash).mockResolvedValue(null);
  vi.mocked(db.loadPhotoBacklog).mockResolvedValue([]);
});

describe("runPhotoJob", () => {
  it("downloads, stores and imports a staged listing's photos, then flags it for a write", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1), row("MFR1", 2)]);
    const deps = fakeDeps();
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(summary).toMatchObject({ listings: 1, refreshed: 0, downloaded: 2, reused: 0, imported: 2, failed: 0, truncated: false });
    expect(deps.download).toHaveBeenCalledTimes(2);
    expect(deps.store).toHaveBeenCalledWith("listings/images/MFR1/p1.jpeg", expect.any(Uint8Array), "image/jpeg");
    expect(db.updateListingMedia).toHaveBeenCalledWith(
      "m-MFR1-1",
      expect.objectContaining({ storage_path: "listings/images/MFR1/p1.jpeg", source_url: null, retry_after: null, download_attempts: 1, content_hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
    );
    expect(deps.importToWix).toHaveBeenCalledWith("wix-lbk", "https://cdn.test/listings/images/MFR1/p1.jpeg", "MFR1-1.jpeg", null);
    expect(db.upsertSiteMedia).toHaveBeenCalledWith([
      { site_id: site.id, media_id: "m-MFR1-1", wix_file_id: "file-1", wix_image_uri: "wix:image://v1/file-1/MFR1-1.jpeg", origin: "imported" },
    ]);
    expect(db.upsertSiteListings).toHaveBeenCalledWith([{ site_id: site.id, listing_id: "MFR1", needs_write: true }]);
    expect(handle.counts).toMatchObject({ images_downloaded: 2, images_imported: 2, images_failed: 0 });
    expect(events).toEqual([expect.objectContaining({ level: "info", kind: "photos", message: "Life in Longboat Key: 2 photo(s) imported for MFR1 (gallery complete, 2 photos)" })]);
  });

  it("re-reads the listing for fresh URLs when the stored ones are stale", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { source_url_received_at: new Date(NOW - 2 * FRESH_URL_MS).toISOString() })]);
    const freshUrl = "https://media.mlsgrid.com/token=new&expires=later/images/MFR1/p1.jpeg";
    const client = fakeClient([{ ListingId: "MFR1", Media: [{ MediaURL: freshUrl, Order: 1 }] } as MlsGridProperty]);
    const deps = fakeDeps();
    const { handle } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps, client });

    expect(client.fetchByIds).toHaveBeenCalledWith(["MFR1"], expect.anything());
    expect(db.replaceListingMedia).toHaveBeenCalledWith([expect.objectContaining({ listing_id: "MFR1", path_key: "images/MFR1/p1.jpeg", source_url: freshUrl })], ["MFR1"]);
    expect(deps.download).toHaveBeenCalledWith(freshUrl);
    expect(summary).toMatchObject({ refreshed: 1, downloaded: 1, imported: 1 });
  });

  it("waits an hour after a failed download and reports it as a warning", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1)]);
    const deps = fakeDeps({ download: vi.fn(async () => ({ status: 429, bytes: null, contentType: null })) });
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(summary).toMatchObject({ downloaded: 0, imported: 0, failed: 1 });
    expect(db.updateListingMedia).toHaveBeenCalledWith(
      "m-MFR1-1",
      expect.objectContaining({ download_attempts: 1, retry_after: new Date(NOW + RETRY_AFTER_MS).toISOString(), last_error: expect.stringContaining("HTTP 429") })
    );
    expect(deps.importToWix).not.toHaveBeenCalled();
    expect(db.upsertSiteListings).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ level: "warn", kind: "photos_failed", message: expect.stringContaining("1 of 1 photo download(s) failed") })]);
    expect(handle.counts.images_failed).toBe(1);
  });

  it("imports a stored photo a site still lacks without downloading it again", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { storage_path: "listings/images/MFR1/p1.jpeg", content_hash: "abc", source_url: null })]);
    const deps = fakeDeps();
    const { handle } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.importToWix).toHaveBeenCalledWith("wix-lbk", "https://cdn.test/listings/images/MFR1/p1.jpeg", "MFR1-1.jpeg", null);
    expect(summary).toMatchObject({ downloaded: 0, imported: 1 });
  });

  it("reuses a stored copy of the same bytes instead of uploading again", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1)]);
    vi.mocked(db.findStoredByHash).mockResolvedValueOnce("listings/images/OTHER/dup.jpeg");
    const deps = fakeDeps();
    const { handle } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(deps.store).not.toHaveBeenCalled();
    expect(db.updateListingMedia).toHaveBeenCalledWith("m-MFR1-1", expect.objectContaining({ storage_path: "listings/images/OTHER/dup.jpeg" }));
    expect(deps.importToWix).toHaveBeenCalledWith("wix-lbk", "https://cdn.test/listings/images/OTHER/dup.jpeg", "MFR1-1.jpeg", null);
    expect(summary).toMatchObject({ downloaded: 1, reused: 1, imported: 1 });
  });

  it("stops at the deadline and reports the work left", async () => {
    const deps = fakeDeps();
    const { handle } = fakeRun();
    const summary = await runPhotoJob({ run: handle, deadline: NOW - 1, sites: [site], deps });
    expect(summary.truncated).toBe(true);
    expect(db.loadPhotoBacklog).not.toHaveBeenCalled();
  });

  it("skips photos in a cooldown and listings whose only work is cooling down", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { retry_after: new Date(NOW + MINUTE).toISOString() }), row("MFR1", 2)]);
    const deps = fakeDeps();
    const { handle } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.download).toHaveBeenCalledWith(expect.stringContaining("/p2.jpeg"));
    expect(summary).toMatchObject({ downloaded: 1, imported: 1 });
  });
});

describe("runStandalonePhotoJob", () => {
  it("records nothing when the backlog is empty", async () => {
    const result = await runStandalonePhotoJob({ trigger: "cron", deadline: NOW + MINUTE, deps: fakeDeps() });
    expect(result.status).toBe("skipped");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("runs as its own run when there is work", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1)]).mockResolvedValueOnce([row("MFR1", 1)]);
    vi.mocked(db.loadActiveSites).mockResolvedValue([site]);
    const { handle } = fakeRun();
    vi.mocked(startRun).mockResolvedValue(handle);

    const result = await runStandalonePhotoJob({ trigger: "cron", deadline: NOW + 10 * MINUTE, deps: fakeDeps() });

    expect(db.loadPhotoBacklog).toHaveBeenCalledWith(1, 90);
    expect(startRun).toHaveBeenCalledWith({ mode: "photos", trigger: "cron" });
    expect(result).toMatchObject({ status: "ok", downloaded: 1, imported: 1, runKey: handle.runKey });
    expect(handle.stage).toBe("done");
    expect(handle.finish).toHaveBeenCalledWith("ok");
  });
});

describe("helpers", () => {
  it("treats a URL as fresh only inside the hour it was retrieved", () => {
    expect(hasFreshUrl({ source_url: "u", source_url_received_at: new Date(NOW - MINUTE).toISOString() }, NOW)).toBe(true);
    expect(hasFreshUrl({ source_url: "u", source_url_received_at: new Date(NOW - FRESH_URL_MS - 1).toISOString() }, NOW)).toBe(false);
    expect(hasFreshUrl({ source_url: null, source_url_received_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it("names Media Manager files by listing and position", () => {
    expect(displayNameFor("MFRA4706116", 3, "images/MFRA4706116/abc.jpeg")).toBe("MFRA4706116-3.jpeg");
    expect(displayNameFor("MFR1", 1, "images/MFR1/noext")).toBe("MFR1-1.jpg");
  });
});

describe("runPhotoJob: Media Manager folders", () => {
  const folderSite: LsSite = { ...site, id: "site-par", name: "Life At Parrish", domain: "lifeatparrish.com", wix_site_id: "wix-par", media_folder_name: "ParrishListingPhotos" };

  it("resolves a named folder once, caches it on the site row and imports into it", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { site_ids: ["site-par"] }), row("MFR1", 2, { site_ids: ["site-par"] })]);
    const deps = fakeDeps({ findFolder: vi.fn(async () => "folder-9") });
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [folderSite], deps });

    expect(summary).toMatchObject({ imported: 2, failed: 0 });
    expect(deps.findFolder).toHaveBeenCalledTimes(1);
    expect(deps.findFolder).toHaveBeenCalledWith("wix-par", "ParrishListingPhotos");
    expect(deps.cacheFolder).toHaveBeenCalledWith("site-par", "folder-9");
    expect(deps.importToWix).toHaveBeenCalledWith("wix-par", "https://cdn.test/listings/images/MFR1/p1.jpeg", "MFR1-1.jpeg", "folder-9");
    expect(deps.importToWix).toHaveBeenCalledWith("wix-par", "https://cdn.test/listings/images/MFR1/p2.jpeg", "MFR1-2.jpeg", "folder-9");
    expect(events.filter((e) => e.level === "error")).toHaveLength(0);
  });

  it("uses a folder id already on the site row without looking it up", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { site_ids: ["site-par"] })]);
    const deps = fakeDeps();
    const { handle } = fakeRun();

    await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [{ ...folderSite, media_folder_id: "folder-cached" }], deps });

    expect(deps.findFolder).not.toHaveBeenCalled();
    expect(deps.importToWix).toHaveBeenCalledWith("wix-par", expect.any(String), "MFR1-1.jpeg", "folder-cached");
  });

  it("holds a site's imports with one error when its named folder does not exist", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { site_ids: ["site-par"] }), row("MFR1", 2, { site_ids: ["site-par"] })]);
    const deps = fakeDeps({ findFolder: vi.fn(async () => null) });
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [folderSite], deps });

    expect(summary).toMatchObject({ downloaded: 2, imported: 0 });
    expect(deps.importToWix).not.toHaveBeenCalled();
    expect(deps.cacheFolder).not.toHaveBeenCalled();
    const errors = events.filter((e) => e.kind === "folder_missing");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("ParrishListingPhotos");
    // The photos stay in the backlog for the next pass: nothing is written for the site.
    expect(db.upsertSiteMedia).not.toHaveBeenCalled();
  });

  it("gives up on a folder lookup that never answers and holds the site's imports", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { site_ids: ["site-par"] })]);
    const deps = fakeDeps({ findFolder: vi.fn(() => new Promise<string | null>(() => {})) });
    const { handle, events } = fakeRun();
    vi.useFakeTimers();
    try {
      const pending = runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [folderSite], deps });
      await vi.advanceTimersByTimeAsync(FOLDER_LOOKUP_TIMEOUT_MS + 1000);
      const summary = await pending;
      expect(summary).toMatchObject({ downloaded: 1, imported: 0 });
      expect(deps.importToWix).not.toHaveBeenCalled();
      const errors = events.filter((e) => e.kind === "folder_missing");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withTimeout", () => {
  it("passes a settled value through and rejects one that takes too long", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "quick")).resolves.toBe(7);
    vi.useFakeTimers();
    try {
      const slow = withTimeout(new Promise<number>(() => {}), 500, "slow lookup");
      const check = expect(slow).rejects.toThrow("slow lookup timed out after 1 s");
      await vi.advanceTimersByTimeAsync(600);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
});
