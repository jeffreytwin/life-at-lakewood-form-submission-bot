import { describe, it, expect } from "vitest";
import {
  linkQuickMoveIns,
  priceTagOf,
  basePlanMarkers,
  QUICK_MOVE_IN_BADGE,
  STATUS_DOT_NEW_CONSTRUCTION,
  STATUS_DOT_QUICK_MOVE_INS,
} from "@/lib/floorplans/quick-move-ins";
import { fieldChanges } from "@/lib/floorplans/diff";
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

describe("linkQuickMoveIns", () => {
  it("ties a quick move-in to its base plan by the builder's plan id, then by name, and flags the base plan", () => {
    const plans = linkQuickMoveIns([
      plan({ raw: { masterPlanID: 14510 } }),
      plan({ planKey: "avery", name: "Avery", raw: { masterPlanID: 900 } }),
      plan({ planKey: "17547-palmiste-dr", name: "17547 Palmiste Dr", quickMoveIn: true, relatedPlanName: "Lori", raw: { masterPlanID: 14510 } }),
      plan({ planKey: "100-main-st", name: "100 Main St", quickMoveIn: true, raw: { relatedPlan: "Avery" } }),
      plan({ planKey: "5-orphan-way", name: "5 Orphan Way", quickMoveIn: true, relatedPlanName: "Bianca" }),
    ]);
    const byKey = Object.fromEntries(plans.map((p) => [p.planKey, p]));
    expect(byKey["17547-palmiste-dr"]).toMatchObject({ relatedPlanKey: "lori", relatedPlanName: "Lori", relatedPlanMatch: "plan-id" });
    expect(byKey["100-main-st"]).toMatchObject({ relatedPlanKey: "avery", relatedPlanName: "Avery", relatedPlanMatch: "plan-name" });
    expect(byKey["5-orphan-way"]).toMatchObject({ relatedPlanKey: null, relatedPlanName: "Bianca", relatedPlanMatch: "unmatched" });
    expect(byKey["lori"].hasQuickMoveIns).toBe(true);
    expect(byKey["avery"].hasQuickMoveIns).toBe(true);
    expect(plans.filter((p) => p.quickMoveIn).every((p) => p.hasQuickMoveIns === undefined)).toBe(true);
  });

  it("trusts the engine's own key first, takes the base plan's name from its row, and keeps the order", () => {
    const plans = linkQuickMoveIns([
      plan({ planKey: "q1", name: "1 A St", quickMoveIn: true, relatedPlanKey: "lori", relatedPlanName: "Something else" }),
      plan({}),
    ]);
    expect(plans.map((p) => p.planKey)).toEqual(["q1", "lori"]);
    expect(plans[0]).toMatchObject({ relatedPlanKey: "lori", relatedPlanName: "Lori", relatedPlanMatch: "extractor" });
  });

  it("marks a base plan without quick move-ins as such", () => {
    expect(linkQuickMoveIns([plan({})])[0].hasQuickMoveIns).toBe(false);
  });
});

describe("priceTagOf", () => {
  it("brackets by hundreds of thousands the way the sites tag plans", () => {
    expect(priceTagOf(419_990)).toBe("$400s");
    expect(priceTagOf(274_000)).toBe("$200s");
    expect(priceTagOf(999_999)).toBe("$900s");
    expect(priceTagOf(1_149_000)).toBe("1M+");
    expect(priceTagOf(null)).toBe("Custom Pricing");
    expect(priceTagOf(50_000)).toBeNull();
  });
});

describe("basePlanMarkers", () => {
  it("gives a base plan with quick move-ins the flag, the banner text, the badge and the dot", () => {
    expect(basePlanMarkers({ quickMoveIn: false, hasQuickMoveIns: true, price: 419_990 })).toEqual({
      quickMoveInAvailable: true,
      newConstructionOrMoveIn: "QUICK MOVE-INS BELOW",
      constructionDot: STATUS_DOT_QUICK_MOVE_INS,
      quickMoveInImage: QUICK_MOVE_IN_BADGE,
      floorPlanPriceTags: ["$400s"],
    });
  });

  it("gives a base plan without them the new-construction set and clears the badge", () => {
    expect(basePlanMarkers({ quickMoveIn: false, price: 1_200_000 })).toEqual({
      quickMoveInAvailable: false,
      newConstructionOrMoveIn: "NEW CONSTRUCTION",
      constructionDot: STATUS_DOT_NEW_CONSTRUCTION,
      quickMoveInImage: null,
      floorPlanPriceTags: ["1M+"],
    });
  });

  it("puts none of it on a quick move-in row", () => {
    expect(basePlanMarkers({ quickMoveIn: true, hasQuickMoveIns: true, price: 500_000 })).toEqual({});
  });
});

describe("fieldChanges for quick move-ins", () => {
  it("reviews only what the quick move-in's row shows: name, price, description, base plan, first picture", () => {
    const current = plan({
      planKey: "17547-palmiste-dr",
      name: "17547 Palmiste Dr",
      quickMoveIn: true,
      relatedPlanName: "Lori",
      galleryImages: ["a.jpg", "b.jpg"],
      blueprintImages: ["p.svg"],
      virtualTourUrl: "https://tour.example/1",
    });
    const next: NormalizedPlan = {
      ...current,
      sqft: 2700,
      beds: "4",
      relatedPlanName: "Lori Elite",
      galleryImages: ["a.jpg", "c.jpg"],
      blueprintImages: [],
      virtualTourUrl: null,
      priceDisplay: "$1,100,000",
    };
    expect(fieldChanges(current, next).map((c) => c.label).sort()).toEqual(["base plan", "price"]);
    const withPhoto = fieldChanges(current, { ...next, galleryImages: ["z.jpg", "c.jpg"] });
    expect(withPhoto.map((c) => c.label).sort()).toEqual(["base plan", "photos", "price"]);
  });

  it("reports a base plan gaining its first quick move-in as yes/no, and a missing flag as no", () => {
    const current = plan({});
    expect(fieldChanges(current, { ...current, hasQuickMoveIns: false })).toEqual([]);
    expect(fieldChanges(current, { ...current, hasQuickMoveIns: true })).toEqual([
      { field: "hasQuickMoveIns", label: "quick move-ins available", oldValue: "no", newValue: "yes" },
    ]);
  });
});
