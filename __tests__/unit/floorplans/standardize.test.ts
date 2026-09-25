import { describe, it, expect } from "vitest";
import {
  HOME_TYPES,
  asTour,
  bathsOf,
  bathsStated,
  builderDefaults,
  largestInRange,
  readableName,
  showablePicture,
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

describe("asTour: interactive floor plans and Lennar's own links (Jeff, 2026-09-25)", () => {
  const fixture = (): NormalizedPlan => ({
    planKey: "fresh-spring",
    name: "Fresh Spring",
    price: null,
    priceDisplay: null,
    beds: "3",
    baths: "2",
    sqft: 1800,
    garages: null,
    homeType: null,
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: null,
    galleryImages: [],
    blueprintImages: [],
  });

  it("is no tour for an interactive floor plan", () => {
    expect(asTour("https://ifp.thebdxinteractive.com/NealCommunities-Windward-Kiawah")).toBeNull();
    expect(asTour("https://rifp.ml3ds-iconstage.com/#/floorplan/514358?floorId=651218")).toBeNull();
    expect(asTour("https://planviewer.cpsusa.com/nealsh/floorplan/2056774")).toBeNull();
  });

  it("is no tour for Lennar's own tour link, which shows a broken tour", () => {
    expect(asTour("https://hd.lennar.com/tours/3914/")).toBeNull();
  });

  it("reads Lennar's viewer link as the modsy viewer it stands for, by the same number", () => {
    expect(asTour("https://hd.lennar.com/apps/home-viewer?vtid=24198")).toBe("https://hd.modsy.com/apps/home-viewer?vtid=24198");
  });

  it("keeps real tours as they are", () => {
    for (const tour of [
      "https://my.matterport.com/show/?m=15m2bU6rz8n",
      "https://www.modsy.com/apps/home-viewer?vtid=15489",
      "https://www.zillow.com/view-imx/04195163-6c68-47ae-bbd5-8465f26af991",
      "https://panoviewer.ml3ds-icon.com/mattamy-homes/tampa/greenway",
    ]) {
      expect(asTour(tour)).toBe(tour);
    }
  });

  it("keeps the link it dropped, as an interactive plan or a dropped tour", () => {
    const ifp = standardizePlan({ ...fixture(), virtualTourUrl: "https://ifp.thebdxinteractive.com/NealCommunities-BR-Fresh_Spring" });
    expect(ifp.virtualTourUrl).toBeNull();
    expect(ifp.raw?.interactivePlanUrl).toBe("https://ifp.thebdxinteractive.com/NealCommunities-BR-Fresh_Spring");
    const lennar = standardizePlan({ ...fixture(), virtualTourUrl: "https://hd.lennar.com/tours/3944/" });
    expect(lennar.virtualTourUrl).toBeNull();
    expect(lennar.raw?.droppedTourUrl).toBe("https://hd.lennar.com/tours/3944/");
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

describe("bathsOf: .5 for any half baths, as the whole site writes them", () => {
  it("adds .5 for one half bath or several (Jeff, 2026-09-24)", () => {
    expect(bathsOf(4, 1)).toBe("4.5");
    expect(bathsOf(5, 3)).toBe("5.5");
    expect(bathsOf(6, 4)).toBe("6.5");
  });

  it("gives the full baths alone where there are no half baths", () => {
    expect(bathsOf(2, 0)).toBe("2");
    expect(bathsOf(2, null)).toBe("2");
    expect(bathsOf(null, 1)).toBeNull();
  });
});

describe("bathsStated: the two counts a page gives", () => {
  it("reads Perry's plan page", () => {
    expect(bathsStated("2,016 Sq. Ft. 3 Beds 1 Stories 2 Baths 2 Cars 0 Half Baths Request More Information")).toBe("2");
    expect(bathsStated("5,239 Sq. Ft. 5 Beds 2 Stories 5 Baths 3 Cars 3 Half Baths Request More Information")).toBe("5.5");
    expect(bathsStated("2,844 Sq. Ft. 4 Beds 1 Stories 3 Baths 3 Cars 1 Half Baths")).toBe("3.5");
  });

  it("says nothing for other builders' layouts, which a reading of Perry's would pair wrongly", () => {
    expect(bathsStated("Sq. Ft: 1746 Stories 2 Bedrooms 3 Full Baths 2 Half Bath 1 Car Garage 2")).toBeNull(); // David Weekley
    expect(bathsStated("3 Bed 1,674 Sq.Ft. 2 Bathroom 1 Half Bath 1 Car Garage")).toBeNull(); // Ryan
    expect(bathsStated("Flex Room, 3 Full and 1 Half Bath, Great Room, 2-Car Garage")).toBeNull(); // Kolter
  });

  it("says nothing for a page that states no half baths", () => {
    expect(bathsStated("3 Beds 2.5 Baths 2 Cars")).toBeNull();
    expect(bathsStated("A half bath off the foyer")).toBeNull();
  });
});

describe("showablePicture: only pictures the site can show (Lennar's Coming Soon, 2026-09-24)", () => {
  it("refuses an address on no host", () => {
    expect(showablePicture("/images/com/images/version10/default/qmi/ComingSoon.jpg")).toBe(false);
    expect(showablePicture("images/front.jpg")).toBe(false);
    expect(showablePicture("")).toBe(false);
    expect(showablePicture(null)).toBe(false);
  });

  it("refuses a builder's stand-in for a photo it does not have", () => {
    expect(showablePicture("https://www.lennar.com/images/com/images/version10/default/qmi/ComingSoon.jpg")).toBe(false);
    expect(showablePicture("https://prodmh.b-cdn.net/-/media/misc/Image-Coming-Soon.png")).toBe(false);
    expect(showablePicture("https://x.com/assets/no-image.png?w=400")).toBe(false);
    expect(showablePicture("https://x.com/assets/placeholder.jpg")).toBe(false);
  });

  it("keeps a real photo, whatever words its folders or name hold", () => {
    expect(showablePicture("https://cdn.lennar.com/api/images/contentassets/b32/leh_3283_manor_ryeranch_rend_sorrento_ds.jpg?d=20250220")).toBe(true);
    expect(showablePicture("https://x.com/coming-soon/elevation-a.jpg")).toBe(true);
    expect(showablePicture("https://x.com/sooner-lakes-front.jpg")).toBe(true);
  });

  it("takes stand-ins and addresses on no host out of a plan's pictures and their captions", () => {
    const soon = "/images/com/images/version10/default/qmi/ComingSoon.jpg";
    const front = "https://cdn.lennar.com/front.jpg";
    const got = standardizePlan({
      planKey: "2805", name: "2805 Sweet Pepper Way", price: null, priceDisplay: null, beds: "", baths: "", sqft: null,
      garages: null, homeType: null, quickMoveIn: true, comingSoon: false, sourceUrl: null,
      galleryImages: [soon, front], blueprintImages: ["https://x.com/placeholder.png", "https://x.com/fp.svg"],
      galleryMeta: { [soon]: { kind: "primary" }, [front]: { kind: "exterior" } },
    });
    expect(got.galleryImages).toEqual([front]);
    expect(Object.keys(got.galleryMeta ?? {})).toEqual([front]);
    expect(got.blueprintImages).toEqual(["https://x.com/fp.svg"]);
  });
});

describe("readableName: no name in capitals (Jeff, 2026-09-24)", () => {
  it("title-cases a home's address given in capitals, whole or in part", () => {
    expect(readableName("18355 ARBOR VISTA DR")).toBe("18355 Arbor Vista Dr");
    expect(readableName("12785 JADE EMPRESS LOOP, Unit 202")).toBe("12785 Jade Empress Loop, Unit 202");
    expect(readableName("7910 Lake Powell PL")).toBe("7910 Lake Powell Pl");
    expect(readableName("11316 CLAY AVENUE")).toBe("11316 Clay Avenue");
  });

  it("keeps small words small but for the first, and capitals after a hyphen or an O'", () => {
    expect(readableName("THE RED ROCK")).toBe("The Red Rock");
    expect(readableName("VILLAS AT THE PARK")).toBe("Villas at the Park");
    expect(readableName("SEA-VIEW")).toBe("Sea-View");
    expect(readableName("O'NEIL POINT")).toBe("O'Neil Point");
    expect(readableName("BUILDER'S CHOICE")).toBe("Builder's Choice");
  });

  it("leaves Roman numerals, compass points, single letters and anything with a digit as they are", () => {
    expect(readableName("GATEWAY II")).toBe("Gateway II");
    expect(readableName("MAYFIELD GRANDE III")).toBe("Mayfield Grande III");
    expect(readableName("123 NE MAIN ST")).toBe("123 NE Main St");
    expect(readableName("PLAN A")).toBe("Plan A");
    expect(readableName("2546F")).toBe("2546F");
    expect(readableName("17660 Opal Sand Dr #303")).toBe("17660 Opal Sand Dr #303");
  });

  it("leaves a name already in title case alone", () => {
    for (const name of ["The Hampton", "Birchwood III", "Carmel II", "Isles of Bayview"]) expect(readableName(name)).toBe(name);
  });

  it("is applied to a plan's name and its base plan's", () => {
    const got = standardizePlan({
      planKey: "18355-arbor-vista-dr", name: "18355 ARBOR VISTA DR", price: null, priceDisplay: null, beds: "", baths: "",
      sqft: null, garages: null, homeType: null, quickMoveIn: true, comingSoon: false, sourceUrl: null,
      galleryImages: [], blueprintImages: [], relatedPlanName: "HAMPTON II",
    });
    expect(got.name).toBe("18355 Arbor Vista Dr");
    expect(got.relatedPlanName).toBe("Hampton II");
    expect(got.planKey).toBe("18355-arbor-vista-dr");
  });
});
