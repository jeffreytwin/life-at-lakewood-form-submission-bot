import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { nextCursor } from "@/lib/listings/discover";

const startedAt = new Date("2026-09-16T17:00:00Z");
const prior = { sinceTimestamp: "2026-09-16T15:20:00.000Z", startedAt: "2026-09-16T16:00:00Z", scanned: 800, found: 30, pages: 4, expectedCount: 1200 };

describe("nextCursor", () => {
  it("is null once the scan read its last page", () => {
    expect(nextCursor(null, { truncated: false, lastModificationTimestamp: "2026-09-16T16:59:00.000Z", scanned: 400, found: 12, pages: 2, expectedCount: 400, startedAt })).toBeNull();
    expect(nextCursor(prior, { truncated: false, lastModificationTimestamp: "2026-09-16T16:59:00.000Z", scanned: 400, found: 5, pages: 2, expectedCount: null, startedAt })).toBeNull();
  });

  it("starts a scan's cursor from the first run at the newest timestamp it read", () => {
    expect(nextCursor(null, { truncated: true, lastModificationTimestamp: "2026-09-16T12:34:56.000Z", scanned: 400, found: 12, pages: 2, expectedCount: 110_563, startedAt })).toEqual({
      sinceTimestamp: "2026-09-16T12:34:56.000Z",
      startedAt: "2026-09-16T17:00:00.000Z",
      scanned: 400,
      found: 12,
      pages: 2,
      expectedCount: 110_563,
    });
  });

  it("carries the scan's start and running totals across runs and advances the resume point", () => {
    expect(nextCursor(prior, { truncated: true, lastModificationTimestamp: "2026-09-16T16:10:00.000Z", scanned: 400, found: 3, pages: 2, expectedCount: null, startedAt })).toEqual({
      sinceTimestamp: "2026-09-16T16:10:00.000Z",
      startedAt: "2026-09-16T16:00:00Z",
      scanned: 1200,
      found: 33,
      pages: 6,
      expectedCount: 1200,
    });
  });

  it("keeps the prior resume point when a truncated run read nothing", () => {
    expect(nextCursor(prior, { truncated: true, lastModificationTimestamp: null, scanned: 0, found: 0, pages: 0, expectedCount: null, startedAt })?.sinceTimestamp).toBe("2026-09-16T15:20:00.000Z");
    expect(nextCursor(null, { truncated: true, lastModificationTimestamp: null, scanned: 0, found: 0, pages: 0, expectedCount: null, startedAt })).toBeNull();
  });
});
