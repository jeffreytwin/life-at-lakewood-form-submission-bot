import { describe, it, expect } from "vitest";
import {
  describePlan,
  looksLikeSpecList,
  neighborhoodName,
  rewriteKey,
  speaksAsOwner,
  withDescriptions,
} from "@/lib/floorplans/description";
import type { NormalizedPlan } from "@/lib/floorplans/types";

describe("speaksAsOwner", () => {
  it("hears the builder speaking as the owner: we, our, us and their contractions, as whole words", () => {
    expect(speaksAsOwner("Our Lori plan features a great room.")).toBe(true);
    expect(speaksAsOwner("We've designed every detail. Contact us today.")).toBe(true);
    expect(speaksAsOwner("This is ours to share.")).toBe(true);
    expect(speaksAsOwner("The Lori plan features a great room with your family in mind.")).toBe(false);
    expect(speaksAsOwner("Hours of sunshine on the lanai; flowers by the entry.")).toBe(false);
  });

  it("does not mistake the country, or nothing, for the builder", () => {
    expect(speaksAsOwner("Built to US standards.")).toBe(false);
    expect(speaksAsOwner(null)).toBe(false);
    expect(speaksAsOwner("")).toBe(false);
  });
});

describe("rewriteKey", () => {
  it("is the builder and the exact text, so the same description is reworded once", () => {
    expect(rewriteKey("Toll Brothers", "Our Lori plan.")).toBe(rewriteKey("Toll Brothers", "Our Lori plan."));
    expect(rewriteKey("Toll Brothers", "Our Lori plan.")).not.toBe(rewriteKey("Lennar", "Our Lori plan."));
    expect(rewriteKey("Toll Brothers", "Our Lori plan.")).not.toBe(rewriteKey("Toll Brothers", "Our Lori plan"));
    expect(rewriteKey("Toll Brothers", "x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("neighborhoodName", () => {
  it("names the neighborhood the way a sentence would", () => {
    expect(neighborhoodName("Waterside - Wild Blue")).toBe("Wild Blue");
    expect(neighborhoodName("Esplanade at Wellen Park")).toBe("Esplanade at Wellen Park");
    expect(neighborhoodName("Broadleaf")).toBe("Broadleaf");
  });
});

describe("describePlan", () => {
  const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
    planKey: "wyndam-iv",
    name: "Wyndam IV",
    price: 1929990,
    priceDisplay: "$1,929,990",
    beds: "4",
    baths: "4.5",
    sqft: 4477,
    garages: "4 car",
    homeType: "Single Family Home",
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: null,
    galleryImages: [],
    blueprintImages: [],
    ...over,
  });

  it("writes the plan's own sentence from its fields", () => {
    expect(describePlan(plan(), "Waterside - Wild Blue")).toBe(
      "The Wyndam IV is available to be built in Wild Blue. The price shown is the base price. This plan features 4 Bedrooms, 4.5 Baths and a 4 car garage."
    );
  });

  it("leaves out a feature the builder left blank rather than writing a blank", () => {
    expect(describePlan(plan({ garages: null }), "Broadleaf")).toBe(
      "The Wyndam IV is available to be built in Broadleaf. The price shown is the base price. This plan features 4 Bedrooms and 4.5 Baths."
    );
    expect(describePlan(plan({ beds: "", baths: "", garages: null }), "Broadleaf")).toBe(
      "The Wyndam IV is available to be built in Broadleaf. The price shown is the base price."
    );
  });
});

describe("looksLikeSpecList", () => {
  it("knows the spec line a page prints under the plan name", () => {
    expect(
      looksLikeSpecList(
        "Four Bedroom (Opt. Bonus Room), Four Full and 1/2 Bath, Great Room, Dining Room, Two 2-Car Garage"
      )
    ).toBe(true);
    expect(looksLikeSpecList("Three Bedroom, Three Bath, Great Room, Study, Outdoor Living")).toBe(true);
  });

  it("leaves prose alone, however many commas it carries", () => {
    expect(
      looksLikeSpecList(
        "The Wyndam IV opens on a great room, a dining room and a study, with the lanai beyond."
      )
    ).toBe(false);
    expect(looksLikeSpecList("A great room, a study and a lanai")).toBe(false);
    expect(looksLikeSpecList("Great Room, Dining Room")).toBe(false);
    expect(looksLikeSpecList("")).toBe(false);
    expect(looksLikeSpecList(null)).toBe(false);
  });
});

describe("withDescriptions", () => {
  const base: NormalizedPlan = {
    planKey: "wyndam-iv",
    name: "Wyndam IV",
    price: null,
    priceDisplay: null,
    beds: "4",
    baths: "4",
    sqft: null,
    garages: "3 car",
    homeType: null,
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: null,
    galleryImages: [],
    blueprintImages: [],
  };

  it("fills in only the base plans the builder left without one", () => {
    const [written, kept, home] = withDescriptions(
      [
        base,
        { ...base, planKey: "kept", description: "The builder's own words." },
        { ...base, planKey: "13300-santini-circle", name: "13300 Santini Circle", quickMoveIn: true },
      ],
      "Waterside - Wild Blue"
    );
    expect(written.description).toContain("is available to be built in Wild Blue");
    expect(kept.description).toBe("The builder's own words.");
    // A quick move-in is a house on a lot, not a plan to be built.
    expect(home.description).toBeUndefined();
  });

  it("counts a spec line as no description, keeping it in raw", () => {
    const line = "Four Bedroom, Four and 1/2 Bath, Great Room, Dining Room, Two 2-Car Garage";
    const [written, home] = withDescriptions(
      [
        { ...base, description: line },
        { ...base, planKey: "lot-226", quickMoveIn: true, description: line },
      ],
      "Waterside - Wild Blue"
    );
    expect(written.description).toContain("is available to be built in Wild Blue");
    expect(written.raw?.featuresLine).toBe(line);
    expect(home.description).toBeNull();
    expect(home.raw?.featuresLine).toBe(line);
  });
});
