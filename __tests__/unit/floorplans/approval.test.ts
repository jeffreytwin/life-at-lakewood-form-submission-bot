import { describe, it, expect } from "vitest";
import { approvalBlocker, missingFields, rejectionStillApplies } from "@/lib/floorplans/approval";
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
    expect(approvalBlocker("add", plan({}))).toBe("needs a score before approval (set it in the edit overlay)");
    expect(approvalBlocker("update", plan({ score: null }))).toMatch(/needs a score/);
    expect(approvalBlocker("add", plan({ score: 7 }))).toBeNull();
    expect(approvalBlocker("add", plan({ score: 0 }))).toBeNull();
  });

  it("holds a base plan back until it has its price, bedrooms, bathrooms, square feet, garages and home type", () => {
    expect(approvalBlocker("add", plan({ score: 7, priceDisplay: null, price: null }))).toBe(
      "needs a price before approval (set it in the edit overlay)"
    );
    expect(approvalBlocker("add", plan({ score: 7, beds: "", baths: " ", sqft: null }))).toBe(
      "needs bedrooms, bathrooms and square feet before approval (set them in the edit overlay)"
    );
    expect(approvalBlocker("add", plan({ garages: null, homeType: null }))).toBe(
      "needs garages, a home type and a score before approval (set them in the edit overlay)"
    );
    expect(missingFields(plan({ score: 7, sqft: 0 }))).toEqual(["square feet"]);
  });

  it("asks only a price of a quick move-in, and nothing of a removal", () => {
    expect(approvalBlocker("add", plan({ quickMoveIn: true }))).toBeNull();
    expect(approvalBlocker("add", plan({ quickMoveIn: true, beds: "", homeType: null }))).toBeNull();
    expect(approvalBlocker("add", plan({ quickMoveIn: true, priceDisplay: null }))).toBe(
      "needs a price before approval (set it in the edit overlay)"
    );
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

describe("rejectionStillApplies", () => {
  const priceless = plan({ priceDisplay: null, price: null });

  it("lets a rejected plan back in once the builder fills in what it lacked", () => {
    expect(rejectionStillApplies(priceless, plan({}))).toBe(false);
    expect(rejectionStillApplies(plan({ beds: "", garages: null }), plan({ beds: "4", garages: null }))).toBe(false);
  });

  it("keeps the rejection while nothing missing has been filled in, and for a complete plan", () => {
    expect(rejectionStillApplies(priceless, priceless)).toBe(true);
    expect(rejectionStillApplies(priceless, plan({ priceDisplay: null, price: null, beds: "" }))).toBe(true);
    expect(rejectionStillApplies(plan({}), plan({}))).toBe(true);
    // The score is a person's number, never the builder's: it does not count.
    expect(rejectionStillApplies(plan({}), plan({ score: 8 }))).toBe(true);
    expect(rejectionStillApplies(plan({ quickMoveIn: true }), plan({ quickMoveIn: true }))).toBe(true);
  });
});
