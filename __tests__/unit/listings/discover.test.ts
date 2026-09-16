import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { nextCursor } from "@/lib/listings/discover";

const startedAt = new Date("2026-09-16T17:00:00Z");

describe("nextCursor", () => {
  it("is null once the scan reached the last page", () => {
    expect(nextCursor(null, { nextLink: null, scanned: 400, found: 12, pages: 2, expectedCount: 400, startedAt })).toBeNull();
    const prior = { nextLink: "https://api.mlsgrid.com/v2/Property?next=3", startedAt: "2026-09-16T16:00:00Z", scanned: 800, found: 30, pages: 4, expectedCount: 1200 };
    expect(nextCursor(prior, { nextLink: null, scanned: 400, found: 5, pages: 2, expectedCount: null, startedAt })).toBeNull();
  });

  it("starts a scan's cursor from the first run", () => {
    expect(nextCursor(null, { nextLink: "https://api.mlsgrid.com/v2/Property?next=3", scanned: 400, found: 12, pages: 2, expectedCount: 55_000, startedAt })).toEqual({
      nextLink: "https://api.mlsgrid.com/v2/Property?next=3",
      startedAt: "2026-09-16T17:00:00.000Z",
      scanned: 400,
      found: 12,
      pages: 2,
      expectedCount: 55_000,
    });
  });

  it("carries the scan's start and running totals across runs", () => {
    const prior = { nextLink: "https://api.mlsgrid.com/v2/Property?next=3", startedAt: "2026-09-16T16:00:00Z", scanned: 400, found: 12, pages: 2, expectedCount: 55_000 };
    expect(nextCursor(prior, { nextLink: "https://api.mlsgrid.com/v2/Property?next=5", scanned: 400, found: 3, pages: 2, expectedCount: null, startedAt })).toEqual({
      nextLink: "https://api.mlsgrid.com/v2/Property?next=5",
      startedAt: "2026-09-16T16:00:00Z",
      scanned: 800,
      found: 15,
      pages: 4,
      expectedCount: 55_000,
    });
  });
});
