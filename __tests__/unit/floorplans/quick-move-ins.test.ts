import { describe, it, expect } from "vitest";
import {
  linkQuickMoveIns,
  bareKey,
  nearlySameKey,
  planNameOf,
  withQuickMoveInPictures,
  withQuickMoveInPrices,
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

describe("planNameOf", () => {
  it("takes the homesite off a quick move-in's name", () => {
    // SimplyDwell names them for the plan and the lot (Jeff, 2026-09-22).
    expect(planNameOf("Hawthorne Homesite 42")).toBe("Hawthorne");
    expect(planNameOf("Buttonwood Homesite 145")).toBe("Buttonwood");
    expect(planNameOf("Cypress Home Site 57")).toBe("Cypress");
    expect(planNameOf("Cedar 2 Lot 8")).toBe("Cedar 2");
    expect(planNameOf("Maple - Residence 14B")).toBe("Maple");
    expect(planNameOf("Sabal #9")).toBe("Sabal");
  });

  it("leaves an address whole: nothing in it is a homesite", () => {
    expect(planNameOf("17547 Palmiste Dr")).toBe("17547 Palmiste Dr");
    expect(planNameOf("100 Main St")).toBe("100 Main St");
    expect(planNameOf("Lori")).toBe("Lori");
  });
});

describe("nearlySameKey", () => {
  it("allows the builder a letter or two", () => {
    expect(nearlySameKey("hawthorn", "hawthorne")).toBe(true);
    expect(nearlySameKey("hawthorne", "hawthorn")).toBe(true);
    expect(nearlySameKey("maple", "maples")).toBe(true);
    expect(nearlySameKey("azalea", "azalea")).toBe(true);
  });

  it("keeps plans apart that only look alike", () => {
    expect(nearlySameKey("cedar", "cedar-2")).toBe(false);
    expect(nearlySameKey("oak", "oaks")).toBe(false); // too short to risk it
    expect(nearlySameKey("magnolia", "magnolia-grande")).toBe(false);
    expect(nearlySameKey("juniper", "jasmine")).toBe(false);
    expect(nearlySameKey("", "juniper")).toBe(false);
  });
});

describe("linkQuickMoveIns", () => {
  it("ties a home off a builder's own inventory page to the plan it names", () => {
    // Stock lists its homes for sale away from its plans, each named by its
    // address with the plan printed above it (Jeff, 2026-09-22). The home's
    // own page is under /inventory/, nowhere near the plan's.
    const stock = (path: string) => `https://www.stockdevelopment.com/projects/wild-blue-at-waterside/${path}`;
    const linked = linkQuickMoveIns([
      plan({ planKey: "madison-ii", name: "Madison II", sourceUrl: stock("floorplans/madison-ii/") }),
      plan({ planKey: "easton-iii", name: "Easton III", sourceUrl: stock("floorplans/easton-iii/") }),
      plan({
        planKey: "1003-blue-shell-loop",
        name: "1003 Blue Shell Loop",
        quickMoveIn: true,
        relatedPlanName: "Madison II",
        sourceUrl: stock("inventory/20011060173/"),
      }),
    ]);
    expect(linked[2].relatedPlanKey).toBe("madison-ii");
    expect(linked[2].relatedPlanMatch).toBe("plan-name");
    expect(linked[0].hasQuickMoveIns).toBe(true);
    expect(linked[1].hasQuickMoveIns).toBe(false);
  });

  it("ties a home that took its plan's name, and a key of its own, to that plan", () => {
    // What distinctKey leaves behind when the builder names a home for its
    // plan: the key differs, the name it carries is the tie.
    const linked = linkQuickMoveIns([
      plan({ planKey: "madison-ii", name: "Madison II" }),
      plan({
        planKey: "madison-ii-20011060173",
        name: "Madison II",
        quickMoveIn: true,
        relatedPlanName: "Madison II",
        sourceUrl: "https://www.stockdevelopment.com/projects/wild-blue-at-waterside/inventory/20011060173/",
      }),
    ]);
    expect(linked[1].relatedPlanKey).toBe("madison-ii");
    expect(linked[1].relatedPlanName).toBe("Madison II");
    expect(linked[0].hasQuickMoveIns).toBe(true);
  });

  it("ties a quick move-in to the plan whose page its own page sits under", () => {
    // SimplyDwell gives each home a page beneath its plan's, and spells the
    // plan differently in the two places (Jeff, 2026-09-22).
    const sd = (path: string) => `https://simplydwellhomes.com/new-homes/broadleaf/${path}`;
    const plans = linkQuickMoveIns([
      plan({ planKey: "hawthorn", name: "Hawthorn", sourceUrl: sd("hawthorn-broadleaf/") }),
      plan({ planKey: "buttonwood", name: "Buttonwood", sourceUrl: sd("buttonwood/") }),
      plan({
        planKey: "hawthorne-homesite-42",
        name: "Hawthorne Homesite 42",
        quickMoveIn: true,
        sourceUrl: sd("hawthorn-broadleaf/hawthorne-homesite-42/"),
      }),
      plan({
        planKey: "buttonwood-homesite-145",
        name: "Buttonwood Homesite 145",
        quickMoveIn: true,
        sourceUrl: sd("buttonwood/buttonwood-homesite-145"),
      }),
    ]);
    const byKey = Object.fromEntries(plans.map((p) => [p.planKey, p]));
    expect(byKey["hawthorne-homesite-42"]).toMatchObject({
      relatedPlanKey: "hawthorn",
      relatedPlanName: "Hawthorn",
      relatedPlanMatch: "plan-page",
    });
    expect(byKey["buttonwood-homesite-145"]).toMatchObject({
      relatedPlanKey: "buttonwood",
      relatedPlanMatch: "plan-page",
    });
    expect(byKey["hawthorn"].hasQuickMoveIns).toBe(true);
  });

  it("falls back to the quick move-in's own name, less the homesite", () => {
    const plans = linkQuickMoveIns([
      plan({ planKey: "hawthorn", name: "Hawthorn" }),
      plan({ planKey: "magnolia", name: "Magnolia" }),
      plan({ planKey: "hawthorne-homesite-42", name: "Hawthorne Homesite 42", quickMoveIn: true }),
      plan({ planKey: "magnolia-homesite-34", name: "Magnolia Homesite 34", quickMoveIn: true }),
    ]);
    const byKey = Object.fromEntries(plans.map((p) => [p.planKey, p]));
    expect(byKey["hawthorne-homesite-42"]).toMatchObject({ relatedPlanKey: "hawthorn", relatedPlanMatch: "plan-name" });
    expect(byKey["magnolia-homesite-34"]).toMatchObject({ relatedPlanKey: "magnolia", relatedPlanMatch: "plan-name" });
  });

  it("does not guess when a near miss fits two plans, or when the page is shared", () => {
    const list = "https://x.test/community/";
    const plans = linkQuickMoveIns([
      // Both are within a letter of "cedars", so neither is the answer.
      plan({ planKey: "cedar", name: "Cedar", sourceUrl: list }),
      plan({ planKey: "cedars", name: "Cedars", sourceUrl: list }),
      plan({ planKey: "cedarsx-homesite-3", name: "Cedarsx Homesite 3", quickMoveIn: true, sourceUrl: `${list}home-3/` }),
    ]);
    const home = plans.find((p) => p.planKey === "cedarsx-homesite-3");
    expect(home).toMatchObject({ relatedPlanKey: null, relatedPlanMatch: "unmatched" });
  });

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

  it("ties a home to its plan whatever word the builder puts in front of the name (Adams, 2026-09-23)", () => {
    const plans = linkQuickMoveIns([
      plan({ planKey: "6927166thplacee", name: "6927 166TH Place E", quickMoveIn: true, sqft: 1540, relatedPlanName: "1512" }),
      plan({ planKey: "plan1512", name: "Plan 1512", sqft: 1512 }),
      plan({ planKey: "plan1720", name: "Plan 1720", sqft: 1720 }),
    ]);
    expect(plans[0]).toMatchObject({ relatedPlanKey: "plan1512", relatedPlanName: "Plan 1512", relatedPlanMatch: "plan-name" });
    expect(bareKey("The Waterway")).toBe(bareKey("Waterway"));
    expect(bareKey("Plan 1635- B")).toBe(bareKey("1635- B"));
  });

  describe("a home listed by its address alone (M/I at Wellen Park, 2026-09-23)", () => {
    const palm = plan({ planKey: "palm", name: "Palm", sqft: 2425, beds: "3" });
    const sabal = plan({ planKey: "sabal", name: "Sabal", sqft: 1702, beds: "3" });
    const home = (over: Partial<NormalizedPlan>) =>
      plan({ planKey: "17966broadleafloop", name: "17966 Broadleaf Loop", quickMoveIn: true, sqft: 2425, beds: "3", ...over });

    it("is tied to the one plan of its square footage", () => {
      const [linked] = linkQuickMoveIns([home({}), palm, sabal]);
      expect(linked).toMatchObject({ relatedPlanKey: "palm", relatedPlanName: "Palm", relatedPlanMatch: "plan-facts" });
    });

    it("is left unmatched when two plans are that size, or the bedrooms disagree", () => {
      const twin = plan({ planKey: "palmii", name: "Palm II", sqft: 2425, beds: "3" });
      expect(linkQuickMoveIns([home({}), palm, twin])[0].relatedPlanMatch).toBe("unmatched");
      expect(linkQuickMoveIns([home({ beds: "4" }), palm, sabal])[0].relatedPlanMatch).toBe("unmatched");
    });

    it("never overrides a plan the engine named, even one missing from the run", () => {
      const [linked] = linkQuickMoveIns([home({ raw: { relatedPlan: "Banyan" } }), palm]);
      expect(linked).toMatchObject({ relatedPlanMatch: "unmatched", relatedPlanName: "Banyan" });
    });
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

describe("withQuickMoveInPrices", () => {
  const priceless = plan({ planKey: "bianca", name: "Bianca", price: null, priceDisplay: null });
  const homes = [
    plan({ planKey: "17837-palmiste-dr", name: "17837 Palmiste Dr", quickMoveIn: true, relatedPlanName: "Bianca", price: 1_299_000, priceDisplay: "$1,299,000" }),
    plan({ planKey: "17900-palmiste-dr", name: "17900 Palmiste Dr", quickMoveIn: true, relatedPlanName: "Bianca", price: 1_249_000, priceDisplay: "$1,249,000" }),
    plan({ planKey: "1-nowhere-ln", name: "1 Nowhere Ln", quickMoveIn: true, relatedPlanName: "Bianca", price: null, priceDisplay: null }),
  ];

  it("gives a priceless base plan its cheapest quick move-in's price and says which home", () => {
    const [bianca] = withQuickMoveInPrices(linkQuickMoveIns([priceless, ...homes]));
    expect(bianca.price).toBe(1_249_000);
    expect(bianca.priceDisplay).toBe("$1,249,000");
    expect(bianca.priceFromHome).toBe("17900 Palmiste Dr");
    expect(fieldChanges({ ...priceless, priceFromHome: null }, bianca).map((c) => c.label)).toEqual(["price", "quick move-ins available"]);
  });

  it("leaves a priced base plan alone and clears the marker once the builder prices the plan", () => {
    const [lori] = withQuickMoveInPrices(linkQuickMoveIns([plan({}), ...homes]));
    expect(lori.price).toBe(1_000_000);
    expect(lori.priceFromHome).toBeNull();
    const [bianca] = withQuickMoveInPrices(linkQuickMoveIns([{ ...priceless, price: 995_000, priceDisplay: "$995,000" }, ...homes]));
    expect(bianca.priceFromHome).toBeNull();
    expect(bianca.priceDisplay).toBe("$995,000");
  });

  it("gives nothing when no quick move-in of the plan has a price, and never touches a quick move-in", () => {
    const out = withQuickMoveInPrices(linkQuickMoveIns([priceless, homes[2]]));
    expect(out[0].price).toBeNull();
    expect(out[0].priceFromHome).toBeNull();
    expect(out[1]).toMatchObject({ price: null, priceDisplay: null });
    expect(out[1].priceFromHome).toBeUndefined();
  });
});

describe("withQuickMoveInPictures", () => {
  const plan = (over: Partial<NormalizedPlan>): NormalizedPlan => ({
    planKey: "mayport", name: "Mayport", price: 324990, priceDisplay: "$324,990", beds: "3", baths: "2.5", sqft: null, garages: null,
    homeType: "Townhome", quickMoveIn: false, comingSoon: false, sourceUrl: null, galleryImages: [], blueprintImages: [], ...over,
  });
  // Amber Creek (Ryan Homes, 2026-09-23): sold out but for one Mayport.
  const home = (name: string, pictures: number, over: Partial<NormalizedPlan> = {}) =>
    plan({ planKey: name.toLowerCase(), name, quickMoveIn: true, relatedPlanKey: "mayport", sqft: 1674, garages: "1 car",
      galleryImages: Array.from({ length: pictures }, (_, i) => `${name}-${i}.jpg`), ...over });

  it("gives a plan with no picture the pictures, size and garage of its home with the most", () => {
    const [got] = withQuickMoveInPictures([plan({}), home("A", 3), home("B", 31, { blueprintImages: ["b-fp.jpg"] })]);
    expect(got.galleryImages).toHaveLength(31);
    expect(got.galleryImages[0]).toBe("B-0.jpg");
    expect(got.blueprintImages).toEqual(["b-fp.jpg"]);
    expect(got).toMatchObject({ sqft: 1674, garages: "1 car" });
  });

  it("leaves a plan the builder shows pictures of as it is", () => {
    const [got] = withQuickMoveInPictures([plan({ galleryImages: ["own.jpg"] }), home("B", 31)]);
    expect(got.galleryImages).toEqual(["own.jpg"]);
  });
});
