import { describe, expect, it } from "vitest";
import { ownFieldOnto, priceWithin, withPriceFrom } from "@/lib/floorplans/diff";
import { FEW_PHOTOS, wantsSorting } from "@/lib/floorplans/sort-queue";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "casey",
  name: "Casey",
  price: 400000,
  priceDisplay: "$400,000",
  beds: "3",
  baths: "2",
  sqft: 1524,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages: ["https://x/1.jpg"],
  blueprintImages: [],
  description: "A plan.",
  ...over,
});

describe("price changes approved without a review (Jeff, 2026-09-26)", () => {
  it("takes a move of a fifth or less, up or down", () => {
    expect(priceWithin(plan(), plan({ price: 480000 }))).toBe(true);
    expect(priceWithin(plan(), plan({ price: 320000 }))).toBe(true);
    expect(priceWithin(plan(), plan({ price: 412990 }))).toBe(true);
  });

  it("leaves a bigger move, a first price and a price taken away for a person", () => {
    expect(priceWithin(plan(), plan({ price: 480001 }))).toBe(false);
    expect(priceWithin(plan(), plan({ price: 319999 }))).toBe(false);
    expect(priceWithin(plan({ price: null }), plan({ price: 400000 }))).toBe(false);
    expect(priceWithin(plan(), plan({ price: null }))).toBe(false);
  });

  it("writes only the price", () => {
    const next = withPriceFrom(plan(), plan({ price: 412990, priceDisplay: "$412,990", description: "Something else." }));
    expect(next).toMatchObject({ price: 412990, priceDisplay: "$412,990", description: "A plan." });
  });

  it("writes onto the record as it stands, so a change approved in between stays", () => {
    const approvedSince = plan({ galleryImages: ["https://x/1.jpg", "https://x/2.jpg"] });
    const queued = withPriceFrom(plan(), plan({ price: 412990, priceDisplay: "$412,990" }));
    const written = ownFieldOnto(approvedSince, queued, "price");
    expect(written.galleryImages).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
    expect(written).toMatchObject({ price: 412990, priceDisplay: "$412,990" });
    // A quick move-in's description the same way.
    const described = ownFieldOnto(approvedSince, { ...approvedSince, description: "New words." }, "description");
    expect(described).toMatchObject({ description: "New words.", galleryImages: approvedSince.galleryImages });
  });
});

describe("photos not looked at for a small gallery (Jeff, 2026-09-26)", () => {
  const photos = (n: number) => Array.from({ length: n }, (_, i) => `https://x/${i}.jpg`);

  it("sorts a gallery of more than five, and leaves five or fewer in the run's order", () => {
    expect(FEW_PHOTOS).toBe(5);
    expect(wantsSorting(plan({ galleryImages: photos(5) }))).toBe(false);
    expect(wantsSorting(plan({ galleryImages: photos(6) }))).toBe(true);
  });
});
