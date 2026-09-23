import { describe, it, expect } from "vitest";
import {
  HOME_TYPES,
  asTour,
  builderDefaults,
  largestInRange,
  standardGarages,
  standardHomeType,
  standardizePlan,
} from "@/lib/floorplans/standardize";
import type { NormalizedPlan } from "@/lib/floorplans/types";

describe("standardHomeType", () => {
  it("maps what builders call their homes onto the five standard types", () => {
    expect(standardHomeType("Single-Family Home")).toBe("Single Family Home");
    expect(standardHomeType("single family")).toBe("Single Family Home");
    expect(standardHomeType("Detached")).toBe("Single Family Home");
    expect(standardHomeType("Estate Homes")).toBe("Single Family Home");
    expect(standardHomeType("Townhomes")).toBe("Townhome");
    expect(standardHomeType("Town House")).toBe("Townhome");
    expect(standardHomeType("Condo")).toBe("Condominium");
    expect(standardHomeType("Condominiums")).toBe("Condominium");
    expect(standardHomeType("Coach Homes")).toBe("Coach Home");
    expect(standardHomeType("Carriage Home")).toBe("Coach Home");
    expect(standardHomeType("Villa")).toBe("Attached Villa");
    expect(standardHomeType("Paired Villas")).toBe("Attached Villa");
    expect(standardHomeType("Duplex")).toBe("Attached Villa");
  });

  it("keeps a standard value as is, and gives nothing for nothing or for a label it cannot place", () => {
    for (const t of HOME_TYPES) expect(standardHomeType(t)).toBe(t);
    expect(standardHomeType(null)).toBeNull();
    expect(standardHomeType("  ")).toBeNull();
    expect(standardHomeType("Lot")).toBeNull();
  });
});

describe("largestInRange", () => {
  it("takes the larger end of a range and leaves a single value alone", () => {
    expect(largestInRange("3-4")).toBe("4");
    expect(largestInRange("3–4")).toBe("4");
    expect(largestInRange("2.5 - 3.5")).toBe("3.5");
    expect(largestInRange("3 to 4")).toBe("4");
    expect(largestInRange("4")).toBe("4");
    expect(largestInRange("3+")).toBe("3+");
    expect(largestInRange("")).toBe("");
    expect(largestInRange(null)).toBe("");
  });
});

describe("standardizePlan", () => {
  const plan: NormalizedPlan = {
    planKey: "lori",
    name: "Lori",
    price: 1_000_000,
    priceDisplay: "$1,000,000",
    beds: "3-4",
    baths: "3-4.5",
    sqft: 2598,
    garages: "3 car",
    homeType: "Single-Family Home",
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: null,
    galleryImages: [],
    blueprintImages: [],
    raw: { masterPlanID: 14510 },
  };

  it("standardizes the home type and takes the larger bed and bath counts, keeping the builder's label in raw", () => {
    const out = standardizePlan(plan);
    expect(out.homeType).toBe("Single Family Home");
    expect(out.beds).toBe("4");
    expect(out.baths).toBe("4.5");
    expect(out.raw).toEqual({ masterPlanID: 14510, homeTypeRaw: "Single-Family Home" });
  });

  it("records nothing in raw when the label was already standard", () => {
    expect(standardizePlan({ ...plan, homeType: "Townhome" }).raw).toEqual({ masterPlanID: 14510 });
  });

  it("drops a tour that is only an interactive floor plan, and keeps the address in raw", () => {
    // Perry's "3D Tour" button opens a drawing to click around, not a
    // walkthrough of the house (Jeff, 2026-09-22).
    const out = standardizePlan({
      ...plan,
      virtualTourUrl: "https://www.blu-plan.com/perryhomes/3024F/",
      virtualTourImage: "https://cdn/still.jpg",
    });
    expect(out.virtualTourUrl).toBeNull();
    expect(out.virtualTourImage).toBeNull();
    expect(out.raw).toMatchObject({ interactivePlanUrl: "https://www.blu-plan.com/perryhomes/3024F/" });
  });

  it("leaves a real tour, and a plan that never had one, alone", () => {
    const real = standardizePlan({
      ...plan,
      virtualTourUrl: "https://my.matterport.com/show/?m=abc123",
      virtualTourImage: "https://cdn/still.jpg",
    });
    expect(real.virtualTourUrl).toBe("https://my.matterport.com/show/?m=abc123");
    expect(real.virtualTourImage).toBe("https://cdn/still.jpg");
    expect(standardizePlan(plan).raw).not.toHaveProperty("interactivePlanUrl");
  });
});

describe("asTour", () => {
  it("knows an interactive floor plan from a tour", () => {
    expect(asTour("https://blu-plan.com/x/")).toBeNull();
    expect(asTour("https://www.blu-plan.com/perryhomes/3024F/")).toBeNull();
    expect(asTour("http://BLU-PLAN.COM")).toBeNull();
    expect(asTour("https://my.matterport.com/show/?m=abc")).toBe("https://my.matterport.com/show/?m=abc");
    // Not a blanket ban on the word: another host that merely contains it.
    expect(asTour("https://tours.blu-planner.com/123")).toBe("https://tours.blu-planner.com/123");
    expect(asTour(null)).toBeNull();
    expect(asTour("  ")).toBeNull();
  });
});

describe("standardGarages", () => {
  it("keeps the builder's number of cars as it is, a half included, the larger end of a range", () => {
    expect(standardGarages("2.5 car")).toBe("2.5 car");
    expect(standardGarages("3 car")).toBe("3 car");
    expect(standardGarages("2-3")).toBe("3 car");
    expect(standardGarages("2-car garage")).toBe("2 car");
    expect(standardGarages("0")).toBe("0 car");
    expect(standardGarages("3.0")).toBe("3 car");
  });

  it("reads a bare number typed in the edit overlay as that many cars", () => {
    expect(standardGarages("2")).toBe("2 car");
    expect(standardGarages(" 3 ")).toBe("3 car");
    expect(standardGarages("2 cars")).toBe("2 car");
  });

  it("counts a number the builder spelled out", () => {
    expect(standardGarages("Three Car Garage")).toBe("3 car");
    expect(standardGarages("Two Car Garage")).toBe("2 car");
    expect(standardGarages("Double Garage")).toBe("2 car");
  });

  it("multiplies out a label that counts garages rather than cars", () => {
    // Stock writes this for the four bays its own icon row shows (Jeff, 2026-09-22).
    expect(standardGarages("Two 2-Car Garage")).toBe("4 car");
    expect(standardGarages("Three 2 car garages")).toBe("6 car");
    expect(standardGarages("Two 2.5-Car Garages")).toBe("5 car");
  });

  it("keeps a label with no number for a person to fix, and gives nothing for nothing", () => {
    expect(standardGarages("Yes")).toBe("Yes");
    expect(standardGarages(null)).toBeNull();
    expect(standardGarages("  ")).toBeNull();
  });

  it("is applied by standardizePlan, the builder's label kept in raw", () => {
    const plan: NormalizedPlan = {
      planKey: "lori", name: "Lori", price: null, priceDisplay: null, beds: "3", baths: "3", sqft: null,
      garages: "2.5 car", homeType: null, quickMoveIn: false, comingSoon: false, sourceUrl: null, galleryImages: [], blueprintImages: [],
    };
    const out = standardizePlan({ ...plan, garages: "2.5-car garage" });
    expect(out.garages).toBe("2.5 car");
    expect(out.raw?.garagesRaw).toBe("2.5-car garage");
    expect(standardizePlan(plan).garages).toBe("2.5 car");
    expect(standardizePlan(plan).raw?.garagesRaw).toBeUndefined();
  });
});

describe("builderDefaults", () => {
  it("reads a home type the builder always builds, and ignores anything else", () => {
    expect(builderDefaults({ homeType: "Single Family Home" })).toEqual({ homeType: "Single Family Home" });
    expect(builderDefaults({ homeType: "Mansion" })).toEqual({ homeType: null });
    expect(builderDefaults({ candidateUrls: ["https://x.test"] })).toEqual({ homeType: null });
    expect(builderDefaults(null)).toEqual({ homeType: null });
  });

  it("writes the builder's type over whatever the page said, keeping the page's own in raw", () => {
    // Stock builds single-family homes and nothing else (Jeff, 2026-09-22).
    const plan = {
      planKey: "wyndam-iv",
      name: "Wyndam IV",
      price: null,
      priceDisplay: null,
      beds: "4",
      baths: "4",
      sqft: null,
      garages: null,
      homeType: "Townhome",
      quickMoveIn: false,
      comingSoon: false,
      sourceUrl: null,
      galleryImages: [],
      blueprintImages: [],
    };
    const out = standardizePlan(plan, { homeType: "Single Family Home" });
    expect(out.homeType).toBe("Single Family Home");
    expect(out.raw?.homeTypeRaw).toBe("Townhome");
    // And with no setting the page still decides.
    expect(standardizePlan(plan).homeType).toBe("Townhome");
  });
});
