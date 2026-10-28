import { describe, it, expect } from "vitest";
import { APPLY_STALE_MS, applyQueued, canApplySchools } from "@/lib/school-zones/apply";
import type { LevelDetail, SchoolZonesDetail } from "@/lib/school-zones/scan";

const level = (verdict: LevelDetail["verdict"]): LevelDetail => ({ level: "elementary", page: "A", proposed: "B", verdict, thisYear: null, shares: [] });
const detail = (over: Partial<SchoolZonesDetail>): SchoolZonesDetail =>
  ({ source: "collection", wixItemId: "item-1", levels: [level("rezoned")], ...over }) as SchoolZonesDetail;

describe("which alerts Apply all writes", () => {
  it("takes a collection row with a school to change", () => {
    expect(canApplySchools(detail({}))).toBe(true);
    expect(canApplySchools(detail({ levels: [level("same"), level("renamed")] }))).toBe(true);
  });

  it("leaves Life At Lakewood's static pages, rows already right, and rows it cannot find", () => {
    expect(canApplySchools(detail({ source: "page", wixItemId: null }))).toBe(false);
    expect(canApplySchools(detail({ levels: [level("same")] }))).toBe(false);
    expect(canApplySchools(detail({ wixItemId: null }))).toBe(false);
  });
});

describe("an alert Apply all is still writing", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  it("is queued from its mark until the mark goes stale", () => {
    expect(applyQueued(detail({ applyQueuedAt: new Date(now - 60_000).toISOString() }), now)).toBe(true);
    expect(applyQueued(detail({ applyQueuedAt: new Date(now - APPLY_STALE_MS - 1).toISOString() }), now)).toBe(false);
  });

  it("is not queued without a mark", () => {
    expect(applyQueued(detail({}), now)).toBe(false);
    expect(applyQueued(detail({ applyQueuedAt: null, applyError: "changed since the scan" }), now)).toBe(false);
  });
});
