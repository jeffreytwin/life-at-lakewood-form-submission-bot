import { describe, it, expect } from "vitest";
import { withRememberedScore } from "@/lib/floorplans/scores";
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

describe("withRememberedScore", () => {
  const scores = new Map([["lori", 3], ["bianca-elite", 9]]);

  it("gives a base plan its remembered score", () => {
    expect(withRememberedScore(plan({}), scores).score).toBe(3);
    expect(withRememberedScore(plan({ planKey: "bianca-elite" }), scores).score).toBe(9);
  });

  it("leaves a plan alone when it already has a score, has none remembered, or is a quick move-in", () => {
    expect(withRememberedScore(plan({ score: 7 }), scores).score).toBe(7);
    expect(withRememberedScore(plan({ planKey: "avery" }), scores).score).toBeUndefined();
    expect(withRememberedScore(plan({ planKey: "17547-palmiste-dr", quickMoveIn: true }), new Map([["17547-palmiste-dr", 5]])).score).toBeUndefined();
  });
});
