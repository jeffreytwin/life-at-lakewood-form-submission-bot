import { describe, expect, it } from "vitest";
import { ADJUSTMENT_LABEL, adjustedOnto, adjustmentSummary } from "@/lib/floorplans/adjustment";
import { ownFieldOnto } from "@/lib/floorplans/diff";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const siesta: NormalizedPlan = {
  planKey: "siesta",
  name: "Siesta",
  price: 329990,
  priceDisplay: "$329,990",
  beds: "2",
  baths: "2",
  sqft: 1565,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.drhorton.com/florida/manatee-sarasota/lakewood-ranch/star-farms/floor-plans/1565",
  description: "This one-story floor plan features an open concept design.",
  galleryImages: ["a.jpg", "b.jpg"],
  blueprintImages: [],
  score: 6,
  userEditedFields: ["description"],
};

describe("what a queued adjustment says it changes (Siesta, 2026-10-14)", () => {
  it("says nothing while nothing is changed", () => {
    expect(adjustmentSummary(siesta, { ...siesta })).toEqual({ oldValue: null, newValue: null });
    // A blank and nothing are the same.
    expect(adjustmentSummary({ ...siesta, garages: null }, { ...siesta, garages: "" })).toEqual({ oldValue: null, newValue: null });
  });

  it("names each changed field with its values, and a long text or gallery by name", () => {
    const after = { ...siesta, homeType: "Attached Villa", sqft: 1600, description: "A villa.", galleryImages: ["b.jpg", "a.jpg"] };
    expect(adjustmentSummary(siesta, after)).toEqual({
      oldValue: "sq ft 1,565; home type Single Family Home; description; photos",
      newValue: "sq ft 1,600; home type Attached Villa; new description; new photos",
    });
  });
});

describe("what an approved adjustment writes", () => {
  it("takes only what the person set onto the plan as it stands now", () => {
    const queued = { ...siesta, homeType: "Attached Villa", userEditedFields: ["description", "homeType"] };
    // The sync approved a new price on its own while the adjustment waited.
    const latest = { ...siesta, price: 319990, priceDisplay: "$319,990" };
    const written = adjustedOnto(latest, queued);
    expect(written).toMatchObject({ homeType: "Attached Villa", price: 319990, priceDisplay: "$319,990" });
    expect(written.userEditedFields).toEqual(["description", "homeType"]);
  });

  it("takes a typed price with its number, and the score", () => {
    const queued = { ...siesta, priceDisplay: "$335,000", price: 335000, priceFromHome: null, score: 8, userEditedFields: ["description", "priceDisplay"] };
    const written = adjustedOnto({ ...siesta, priceFromHome: "$330,000" }, queued);
    expect(written).toMatchObject({ priceDisplay: "$335,000", price: 335000, priceFromHome: null, score: 8 });
  });

  it("is what the approval of an adjustment row writes", () => {
    const queued = { ...siesta, homeType: "Attached Villa", userEditedFields: ["homeType"] };
    const latest = { ...siesta, price: 319990, priceDisplay: "$319,990" };
    expect(ownFieldOnto(latest, queued, ADJUSTMENT_LABEL)).toMatchObject({ homeType: "Attached Villa", priceDisplay: "$319,990" });
    // A plan with no live record to lay it on writes as queued.
    expect(ownFieldOnto(null, queued, ADJUSTMENT_LABEL)).toBe(queued);
  });
});
