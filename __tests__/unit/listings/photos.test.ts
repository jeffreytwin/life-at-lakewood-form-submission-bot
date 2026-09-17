import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/wix/client", async (importOriginal) => {
  // The real WixApiError: the photo job branches on its rateLimited flag.
  const actual = await importOriginal<typeof import("@/lib/wix/client")>();
  return { WixApiError: actual.WixApiError, importMediaFromUrl: vi.fn(), findMediaFolder: vi.fn() };
});
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
import { displayNameFor, hasFreshUrl, pool, runPhotoJob, runStandalonePhotoJob, withTimeout, DOWNLOAD_CONCURRENCY, FOLDER_LOOKUP_TIMEOUT_MS, FRESH_URL_MS, IMPORT_CONCURRENCY, IMPORT_RETRY_MS, LONG_RETRY_MS, MAX_DOWNLOAD_ATTEMPTS, RETRY_AFTER_MS, type PhotoDeps } from "@/lib/listings/photos";
import { WixApiError } from "@/lib/wix/client";
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
  price_sort_style: "ranges",
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
    image_width: 1600,
    image_height: 898,
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
      { site_id: site.id, media_id: "m-MFR1-1", wix_file_id: "file-1", wix_image_uri: "wix:image://v1/file-1/MFR1-1.jpeg#originWidth=1600&originHeight=898", origin: "imported" },
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
    expect(events).toEqual([expect.objectContaining({ level: "warn", kind: "download_failed", message: expect.stringContaining("1 of 1 photo download(s) failed") })]);
    expect(handle.counts.images_failed).toBe(1);
  });

  it("raises an error only once a photo has used up its hourly download attempts", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { download_attempts: MAX_DOWNLOAD_ATTEMPTS - 1 })]);
    const deps = fakeDeps({ download: vi.fn(async () => ({ status: 404, bytes: null, contentType: null })) });
    const { handle, events } = fakeRun();

    await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(db.updateListingMedia).toHaveBeenCalledWith("m-MFR1-1", expect.objectContaining({ download_attempts: MAX_DOWNLOAD_ATTEMPTS, retry_after: new Date(NOW + LONG_RETRY_MS).toISOString() }));
    expect(events).toEqual([expect.objectContaining({ level: "error", kind: "download_failed", message: expect.stringContaining("now retry daily") })]);
  });

  it("reports a refused Wix import as a warning and retries it later", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { storage_path: "listings/images/MFR1/p1.jpeg", content_hash: "abc", source_url: null })]);
    const deps = fakeDeps({ importToWix: vi.fn(async () => { throw new Error("Wix API POST /site-media/v1/files/import: 500 (Wix answered with an HTML error page)"); }) });
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(summary).toMatchObject({ imported: 0, failed: 1 });
    expect(db.updateListingMedia).toHaveBeenCalledWith("m-MFR1-1", expect.objectContaining({ retry_after: new Date(NOW + IMPORT_RETRY_MS).toISOString(), last_error: expect.stringContaining("import to") }));
    const failures = events.filter((e) => e.kind === "import_failed");
    expect(failures).toEqual([expect.objectContaining({ level: "warn", message: expect.stringContaining("retried in 30 min") })]);
    expect(events.filter((e) => e.level === "error")).toHaveLength(0);
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
      // A lookup that failed is retried next pass, so it is a warning (repeats escalate in runs.ts).
      expect(errors[0].level).toBe("warn");
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

describe("pool", () => {
  /** Counts how many calls overlap, so the limit can be asserted rather than assumed. */
  function tracker() {
    const state = { inFlight: 0, peak: 0, seen: [] as number[] };
    return {
      state,
      worker: async (n: number) => {
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        await new Promise((r) => setTimeout(r, 1));
        state.seen.push(n);
        state.inFlight -= 1;
      },
    };
  }

  it("covers every item and never exceeds the limit", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { state, worker } = tracker();
    const stopped = await pool(items, 4, () => false, worker);
    expect(stopped).toBe(false);
    expect(state.seen.sort((a, b) => a - b)).toEqual(items);
    expect(state.peak).toBe(4);
    expect(state.inFlight).toBe(0);
  });

  it("reports stopping early and starts nothing more once the deadline passes", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const { state, worker } = tracker();
    let done = 0;
    const stopped = await pool(items, 4, () => done >= 8, async (n) => {
      await worker(n);
      done += 1;
    });
    expect(stopped).toBe(true);
    expect(state.seen.length).toBeGreaterThanOrEqual(8);
    expect(state.seen.length).toBeLessThan(items.length);
  });

  it("runs a single worker when the limit or the list is one, and handles an empty list", async () => {
    const { state, worker } = tracker();
    await pool([1, 2, 3], 1, () => false, worker);
    expect(state.peak).toBe(1);
    expect(await pool([], 4, () => false, worker)).toBe(false);
  });
});

describe("concurrent passes", () => {
  const folderSite: LsSite = { ...site, id: "site-par", name: "Life At Parrish", domain: "lifeatparrish.com", wix_site_id: "wix-par", media_folder_name: "ParrishListingPhotos" };

  it("downloads and imports a long gallery several at a time without losing any", async () => {
    const media = Array.from({ length: 12 }, (_, i) => row("MFR1", i + 1));
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce(media);
    let downloadsInFlight = 0;
    let peakDownloads = 0;
    let importsInFlight = 0;
    let peakImports = 0;
    const deps = fakeDeps({
      download: vi.fn(async () => {
        downloadsInFlight += 1;
        peakDownloads = Math.max(peakDownloads, downloadsInFlight);
        await new Promise((r) => setTimeout(r, 1));
        downloadsInFlight -= 1;
        return { status: 200, bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
      }),
      importToWix: vi.fn(async () => {
        importsInFlight += 1;
        peakImports = Math.max(peakImports, importsInFlight);
        await new Promise((r) => setTimeout(r, 1));
        importsInFlight -= 1;
        return { id: `file-${importsInFlight}` };
      }),
    });
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(summary).toMatchObject({ downloaded: 12, imported: 12, failed: 0 });
    expect(peakDownloads).toBe(DOWNLOAD_CONCURRENCY);
    expect(peakImports).toBe(IMPORT_CONCURRENCY);
    expect(events.filter((e) => e.level === "error")).toHaveLength(0);
    // Every photo is recorded against the site, so the gallery is complete.
    expect(vi.mocked(db.upsertSiteMedia)).toHaveBeenCalledTimes(12);
  });

  it("still asks Wix for the folder only once when several imports start together", async () => {
    const media = Array.from({ length: 8 }, (_, i) => row("MFR1", i + 1, { site_ids: ["site-par"] }));
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce(media);
    const findFolder = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "folder-9";
    });
    const deps = fakeDeps({ findFolder });
    const { handle } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [folderSite], deps });

    expect(summary).toMatchObject({ imported: 8, failed: 0 });
    expect(findFolder).toHaveBeenCalledTimes(1);
    expect(deps.cacheFolder).toHaveBeenCalledTimes(1);
    for (const call of vi.mocked(deps.importToWix).mock.calls) expect(call[3]).toBe("folder-9");
  });
});

describe("photos Wix cannot render", () => {
  it("does not import a photo whose dimensions the MLS never gave, and says so", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([
      row("MFR1", 1, { storage_path: "listings/images/MFR1/p1.jpeg", content_hash: "a", source_url: null, image_width: null, image_height: null }),
      row("MFR1", 2, { storage_path: "listings/images/MFR1/p2.jpeg", content_hash: "b", source_url: null }),
    ]);
    const deps = fakeDeps();
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    // The second photo still goes; only the one with no dimensions is held back.
    expect(summary).toMatchObject({ imported: 1 });
    expect(deps.importToWix).toHaveBeenCalledTimes(1);
    expect(db.coolDownListingMedia).toHaveBeenCalledWith("MFR1", expect.any(Date), expect.stringContaining("dimensions"));
    expect(events).toContainEqual(expect.objectContaining({ level: "warn", kind: "import_failed", message: expect.stringContaining("no dimensions") }));
  });

  it("writes the imported photo with the dimensions Wix needs", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { storage_path: "listings/images/MFR1/p1.jpeg", content_hash: "a", source_url: null, image_width: 1024, image_height: 768 })]);
    const deps = fakeDeps();
    const { handle } = fakeRun();

    await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(db.upsertSiteMedia).toHaveBeenCalledWith([
      expect.objectContaining({ wix_image_uri: "wix:image://v1/file-1/MFR1-1.jpeg#originWidth=1024&originHeight=768" }),
    ]);
  });
});

describe("when Wix asks the engine to slow down", () => {
  /**
   * Jeff, 2026-09-16, on a panel full of them: "why am I being alerted? Is
   * this something I need to deal with?" A 429 is Wix asking for less. The
   * engine stands down for that location and says so once, as a warning.
   */
  const limited = () => new WixApiError(429, "<!DOCTYPE html><html></html>", "POST /site-media/v1/files/import");

  it("stops importing for that location, leaves the photos due, and warns once", async () => {
    const media = Array.from({ length: 6 }, (_, i) => row("MFR1", i + 1, { storage_path: `listings/images/MFR1/p${i + 1}.jpeg`, content_hash: `h${i}`, source_url: null }));
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce(media);
    const deps = fakeDeps({ importToWix: vi.fn(async () => { throw limited(); }) });
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    // A rate limit is not the photo's fault: nothing is counted failed and
    // nothing is put on a cool-down, so the next pass picks them straight up.
    expect(summary).toMatchObject({ imported: 0, failed: 0 });
    expect(db.updateListingMedia).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ retry_after: expect.any(String) }));
    expect(handle.counts.images_failed).toBe(0);
    // Workers already in flight when the first refusal lands are refused too,
    // so the count is at most one per worker, never one per photo.
    expect(handle.counts.wix_rate_limited).toBeGreaterThanOrEqual(1);
    expect(handle.counts.wix_rate_limited).toBeLessThanOrEqual(IMPORT_CONCURRENCY);

    // Told once, as a warning, not once per photo and never as an error.
    const warned = events.filter((e) => e.kind === "rate_limited");
    expect(warned).toHaveLength(1);
    expect(warned[0].level).toBe("warn");
    expect(events.filter((e) => e.level === "error")).toHaveLength(0);

    // And it stopped asking after the first refusal rather than trying all six.
    expect(vi.mocked(deps.importToWix).mock.calls.length).toBeLessThan(media.length);
  });

  it("still treats a real import failure as a failure", async () => {
    vi.mocked(db.loadPhotoBacklog).mockResolvedValueOnce([row("MFR1", 1, { storage_path: "listings/images/MFR1/p1.jpeg", content_hash: "a", source_url: null })]);
    const deps = fakeDeps({ importToWix: vi.fn(async () => { throw new WixApiError(500, "boom", "POST /site-media/v1/files/import"); }) });
    const { handle, events } = fakeRun();

    const summary = await runPhotoJob({ run: handle, deadline: NOW + 10 * MINUTE, sites: [site], deps });

    expect(summary).toMatchObject({ failed: 1 });
    expect(events.filter((e) => e.kind === "rate_limited")).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ kind: "import_failed" }));
  });
});
