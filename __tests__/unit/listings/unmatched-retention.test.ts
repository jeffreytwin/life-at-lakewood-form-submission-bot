import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above the file's own consts, so the spies
// have to be created inside vi.hoisted to exist by the time they run.
const { warn, rpc, insert } = vi.hoisted(() => ({ warn: vi.fn(), rpc: vi.fn(), insert: vi.fn() }));

vi.mock("@/lib/shared/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ insert: (...args: unknown[]) => insert(...args) }),
  },
}));

import { purgeUnmatchedListings, UNMATCHED_PURGE_MAX_ROWS, UNMATCHED_RETENTION_DAYS } from "@/lib/listings/runs";

const deleted = (patch: Record<string, unknown> = {}) => ({
  listing_id: "MFRA1",
  standard_status: "Closed",
  city: "Venice",
  in_feed: true,
  last_change: "2026-06-01T00:00:00.000Z",
  media_rows: 31,
  ...patch,
});

beforeEach(() => {
  rpc.mockReset();
  insert.mockReset();
  warn.mockReset();
  insert.mockResolvedValue({ error: null });
});

describe("purgeUnmatchedListings", () => {
  it("asks for the documented retention and cap by default", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await purgeUnmatchedListings();
    expect(rpc).toHaveBeenCalledWith("ls_purge_unmatched_listings", {
      older_than_days: UNMATCHED_RETENTION_DAYS,
      max_rows: UNMATCHED_PURGE_MAX_ROWS,
    });
    expect(UNMATCHED_RETENTION_DAYS).toBe(60);
  });

  it("stays silent when it deletes nothing, so the nightly does not log a no-op", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const result = await purgeUnmatchedListings();
    expect(result).toEqual({ listings: 0, mediaRows: 0, hitCap: false, byStatus: {} });
    expect(insert).not.toHaveBeenCalled();
  });

  it("counts what went, by status, and sums the photo records the cascade took", async () => {
    rpc.mockResolvedValue({
      data: [
        deleted(),
        deleted({ listing_id: "MFRA2", media_rows: 12 }),
        deleted({ listing_id: "MFRA3", standard_status: "Expired", media_rows: 7 }),
        deleted({ listing_id: "MFRA4", standard_status: null, media_rows: 0 }),
      ],
      error: null,
    });
    const result = await purgeUnmatchedListings();
    expect(result.listings).toBe(4);
    expect(result.mediaRows).toBe(50);
    expect(result.byStatus).toEqual({ Closed: 2, Expired: 1, unknown: 1 });
    expect(result.hitCap).toBe(false);
  });

  it("writes one event with no site, because the sweep spans every market", async () => {
    rpc.mockResolvedValue({ data: [deleted(), deleted({ listing_id: "MFRA2", media_rows: 9 })], error: null });
    await purgeUnmatchedListings();
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.site_id).toBeNull();
    expect(row.level).toBe("info");
    expect(row.kind).toBe("retention_purge");
    expect(row.message).toContain("2 listing(s)");
    expect(row.message).toContain("40 photo record(s)");
    expect(row.message).toContain("60 days");
    const details = row.details as Record<string, unknown>;
    expect(details.listings).toBe(2);
    expect(details.mediaRows).toBe(40);
    expect(details.hitCap).toBe(false);
    expect((details.sample as unknown[]).length).toBe(2);
  });

  it("samples at most ten listings into the event, however many went", async () => {
    rpc.mockResolvedValue({ data: Array.from({ length: 25 }, (_, i) => deleted({ listing_id: `MFR${i}` })), error: null });
    await purgeUnmatchedListings();
    const details = (insert.mock.calls[0][0] as Record<string, unknown>).details as Record<string, unknown>;
    expect((details.sample as unknown[]).length).toBe(10);
    expect(details.listings).toBe(25);
  });

  it("says so when it filled its cap, because that means more are waiting", async () => {
    rpc.mockResolvedValue({ data: Array.from({ length: 3 }, (_, i) => deleted({ listing_id: `MFR${i}` })), error: null });
    const result = await purgeUnmatchedListings({ maxRows: 3 });
    expect(result.hitCap).toBe(true);
    expect((insert.mock.calls[0][0] as Record<string, unknown>).message).toContain("filled its limit of 3");
  });

  it("throws when the sweep itself fails, so the tick logs it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(purgeUnmatchedListings()).rejects.toThrow(/function does not exist/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not throw when only the note fails: the rows are already gone", async () => {
    rpc.mockResolvedValue({ data: [deleted()], error: null });
    insert.mockResolvedValue({ error: { message: "insert failed" } });
    const result = await purgeUnmatchedListings();
    expect(result.listings).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});
