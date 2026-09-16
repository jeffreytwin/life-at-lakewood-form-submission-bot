import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/listings/db", () => ({ loadActiveSites: vi.fn() }));
vi.mock("@/lib/listings/audit", () => ({ reimportBrokenPhotos: vi.fn() }));
vi.mock("@/lib/listings/runs", () => ({ startRun: vi.fn(), lastOkRunStartedAt: vi.fn(), purgeOldRuns: vi.fn(), runningRun: vi.fn() }));

import { sweepBrokenPhotos } from "@/lib/listings/tick";
import { reimportBrokenPhotos } from "@/lib/listings/audit";
import { loadActiveSites } from "@/lib/listings/db";
import { startRun } from "@/lib/listings/runs";
import type { LsSite } from "@/lib/listings/types";

interface Recorded {
  level: string;
  kind: string;
  message: string;
}

function fakeRun() {
  const events: Recorded[] = [];
  const finished: string[] = [];
  const handle = {
    event: (level: string, kind: string, message: string) => events.push({ level, kind, message }),
    checkpoint: vi.fn(async () => {}),
    finish: vi.fn(async (status: string) => {
      finished.push(status);
    }),
  };
  return { handle, events, finished };
}

const site = (patch: Partial<LsSite>): LsSite =>
  ({ id: "s1", name: "Life At Parrish", domain: "lifeatparrish.com", wix_site_id: "wix-1", write_mode: "shadow", ...patch }) as LsSite;

const NOW = Date.now();

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Jeff, 2026-09-16: "Will those broken pictures be healed eventually?" They
 * are only healed if this actually runs, so it gets an idle invocation of its
 * own rather than the tail of the nightly run, which is the busiest of the day.
 */
describe("sweepBrokenPhotos", () => {
  it("checks every active location and reports what it cleared", async () => {
    const { handle, events, finished } = fakeRun();
    vi.mocked(startRun).mockResolvedValue(handle as never);
    vi.mocked(loadActiveSites).mockResolvedValue([site({}), site({ id: "s2", name: "Life in Longboat Key", domain: "lifeinlongboatkey.com", write_mode: "live" })]);
    vi.mocked(reimportBrokenPhotos)
      .mockResolvedValueOnce({ broken: 12, cleared: 12, listings: 3, refused: null })
      .mockResolvedValueOnce({ broken: 0, cleared: 0, listings: 0, refused: null });

    const summary = await sweepBrokenPhotos("cron", NOW + 240_000);

    expect(reimportBrokenPhotos).toHaveBeenCalledTimes(2);
    expect(summary["lifeatparrish.com"]).toMatchObject({ cleared: 12 });
    expect(events).toEqual([expect.objectContaining({ level: "warn", kind: "photos_broken", message: expect.stringContaining("12 photo(s)") })]);
    expect(finished).toEqual(["ok"]);
  });

  it("skips a paused location and one with no Wix site", async () => {
    const { handle } = fakeRun();
    vi.mocked(startRun).mockResolvedValue(handle as never);
    vi.mocked(loadActiveSites).mockResolvedValue([site({ write_mode: "paused" }), site({ id: "s3", wix_site_id: null })]);

    await sweepBrokenPhotos("cron", NOW + 240_000);

    expect(reimportBrokenPhotos).not.toHaveBeenCalled();
  });

  it("raises the refusal as an error rather than clearing anything", async () => {
    const { handle, events } = fakeRun();
    vi.mocked(startRun).mockResolvedValue(handle as never);
    vi.mocked(loadActiveSites).mockResolvedValue([site({})]);
    vi.mocked(reimportBrokenPhotos).mockResolvedValue({ broken: 900, cleared: 0, listings: 0, refused: "900 of 2000 of this location's photos look broken to Wix, which is too many to act on; nothing was cleared" });

    await sweepBrokenPhotos("cron", NOW + 240_000);

    expect(events).toEqual([expect.objectContaining({ level: "error", kind: "photos_broken", message: expect.stringContaining("too many to act on") })]);
  });

  it("carries on when one location fails, and stops cleanly when the budget runs out", async () => {
    const { handle, events, finished } = fakeRun();
    vi.mocked(startRun).mockResolvedValue(handle as never);
    vi.mocked(loadActiveSites).mockResolvedValue([site({})]);
    vi.mocked(reimportBrokenPhotos).mockRejectedValue(new Error("Wix API GET /site-media/v1/files: 503"));

    const summary = await sweepBrokenPhotos("cron", NOW + 240_000);

    expect(summary["lifeatparrish.com"]).toMatchObject({ error: expect.stringContaining("503") });
    expect(events).toEqual([expect.objectContaining({ level: "warn", kind: "photos_broken", message: expect.stringContaining("next day tries again") })]);
    expect(finished).toEqual(["ok"]);

    const past = fakeRun();
    vi.mocked(startRun).mockResolvedValue(past.handle as never);
    vi.mocked(reimportBrokenPhotos).mockClear();
    await sweepBrokenPhotos("cron", NOW - 1);
    expect(reimportBrokenPhotos).not.toHaveBeenCalled();
    expect(past.events).toEqual([expect.objectContaining({ kind: "budget" })]);
  });
});
