import { describe, it, expect } from "vitest";
import { HOME_TYPES, largestInRange, standardGarages, standardHomeType, standardizePlan } from "@/lib/floorplans/standardize";
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
