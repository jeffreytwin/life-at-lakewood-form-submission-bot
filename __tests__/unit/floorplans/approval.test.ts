import { describe, it, expect } from "vitest";
import { approvalBlocker } from "@/lib/floorplans/approval";
import { mergeForUpdate, fieldChanges } from "@/lib/floorplans/diff";
import { STANDARD_FLOOR_PLAN_FIELDS } from "@/lib/floorplans/standard-schema";
import { describeFieldType } from "@/lib/floorplans/collection-schema";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const plan = (over: Partial<NormalizedPlan>): NormalizedPlan => ({
  planKey: "lori",
  name: "Lori",
  price: 1_000_000,
  priceDisplay: "$1,000,000",
  beds: "3",
  baths: "3",
  sqft: 2598,
  garages: "3 car",
  homeType: "Single-Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages: [],
  blueprintImages: [],
  ...over,
});

describe("approvalBlocker", () => {
  it("holds a base plan back until it has a score", () => {
    expect(approvalBlocker("add", plan({}))).toMatch(/needs a score/);
    expect(approvalBlocker("update", plan({ score: null }))).toMatch(/needs a score/);
    expect(approvalBlocker("add", plan({ score: 7 }))).toBeNull();
    expect(approvalBlocker("add", plan({ score: 0 }))).toBeNull();
  });

  it("asks nothing of a quick move-in or a removal", () => {
    expect(approvalBlocker("add", plan({ quickMoveIn: true }))).toBeNull();
    expect(approvalBlocker("remove", null)).toBeNull();
  });

  it("refuses a change with no record", () => {
    expect(approvalBlocker("add", null)).toMatch(/no proposed record/);
  });
});

describe("the score across runs", () => {
  it("is kept from the canonical record and never proposed as a change", () => {
    const current = plan({ score: 8 });
    const scraped = plan({ priceDisplay: "$1,050,000", price: 1_050_000 });
    expect(mergeForUpdate(current, scraped).score).toBe(8);
    expect(fieldChanges(current, scraped).map((c) => c.label)).toEqual(["price"]);
  });
});

describe("the standard Floor Plans V2 schema", () => {
  it("has 31 distinct data fields, Neighborhood wording, and references to the Builders and villages collections", () => {
    const keys = STANDARD_FLOOR_PLAN_FIELDS.map((f) => f.key);
    expect(keys).toHaveLength(31);
    expect(new Set(keys).size).toBe(31);
    expect(keys.some((k) => k.startsWith("_"))).toBe(false);
    for (const f of STANDARD_FLOOR_PLAN_FIELDS) {
      expect(f.displayName).toBeTruthy();
      expect(f.type).toBeTruthy();
      expect(f.displayName).not.toMatch(/village/i);
    }
    const byKey = Object.fromEntries(STANDARD_FLOOR_PLAN_FIELDS.map((f) => [f.key, f]));
    expect(describeFieldType(byKey.villages)).toBe("REFERENCE→HousesforSale-DynamicPages");
    expect(describeFieldType(byKey.builder1)).toBe("REFERENCE→Builders");
    expect(byKey.village.displayName).toBe("Neighborhood");
    expect(byKey.score.type).toBe("NUMBER");
    expect(byKey.relatedFloorPlanQuickMoveInOnly.displayName).toBe("Related Floor Plan (Quick Move-In Only)");
  });
});
