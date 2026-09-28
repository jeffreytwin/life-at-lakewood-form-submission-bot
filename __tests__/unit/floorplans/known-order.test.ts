import { describe, expect, it } from "vitest";
import { fieldChanges, type CanonicalRecord } from "@/lib/floorplans/diff";
import { inKnownOrder } from "@/lib/floorplans/pictures";
import { withLookedAtRooms, type PhotoLabel } from "@/lib/floorplans/photo-rooms";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// D.R. Horton's Jordyn II at Legacy Preserve, as the queue had it (Jeff, 2026-09-28).
const at = (n: string) => `https://cdn.drhorton.com/3278/${n}.jpg`;
const front = at("jordyn_ii-h-stone-3car-gen3-elev_ind");
const looked = new Map<string, PhotoLabel | null>([
  [front, "front"],
  [at("08"), "kitchen"],
  [at("13"), "loft"],
  [at("10"), "bedroom"],
  [at("11"), "bedroom"],
  [at("12"), "bedroom"],
  [at("15"), "bedroom"],
  [at("14"), "bedroom"],
  [at("16"), "bathroom"],
]);

const plan = (galleryImages: string[]): NormalizedPlan => ({
  planKey: "jordyn-ii",
  name: "Jordyn II",
  price: 500000,
  priceDisplay: "$500,000",
  beds: "5",
  baths: "3",
  sqft: 2800,
  garages: "3 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages,
  blueprintImages: [],
});

const live = withLookedAtRooms(plan([front, at("08"), at("13"), at("10"), at("11"), at("12"), at("15"), at("14"), at("16")]), looked);

describe("inKnownOrder: photos in one room keep the record's order", () => {
  it("proposes nothing when the page lists the same bedrooms in another order", () => {
    const tonight = plan([front, at("08"), at("13"), at("14"), at("10"), at("11"), at("12"), at("15"), at("16")]);
    expect(withLookedAtRooms(tonight, looked).galleryImages).not.toEqual(live.galleryImages);
    const run = withLookedAtRooms(inKnownOrder(tonight, live), looked);
    expect(run.galleryImages).toEqual(live.galleryImages);
    expect(fieldChanges(live as CanonicalRecord, run).map((c) => c.field)).not.toContain("galleryImages");
  });

  it("keeps a new photo where the page put it among the known ones", () => {
    const fresh = at("99");
    const tonight = plan([front, at("08"), at("13"), at("14"), fresh, at("10"), at("11"), at("12"), at("15"), at("16")]);
    const ordered = inKnownOrder(tonight, live).galleryImages;
    // After 14, which the record shows last of the bedrooms, and before the bathroom.
    expect(ordered).toEqual([front, at("08"), at("13"), at("10"), at("11"), at("12"), at("15"), at("14"), fresh, at("16")]);
  });

  it("still moves a photo whose room changed", () => {
    const relooked = new Map(looked);
    relooked.set(at("14"), "loft");
    const run = withLookedAtRooms(inKnownOrder(plan(live.galleryImages), live), relooked);
    expect(run.galleryImages.indexOf(at("14"))).toBe(run.galleryImages.indexOf(at("13")) + 1);
  });

  it("leaves a plan the record does not have alone", () => {
    const tonight = plan([front, at("14"), at("10")]);
    expect(inKnownOrder(tonight, null)).toBe(tonight);
  });
});
