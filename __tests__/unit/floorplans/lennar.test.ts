import { describe, it, expect } from "vitest";
import {
  communityHomeType,
  isFutureRelease,
  planDrawings,
  planGallery,
  planPrice,
  plansFromPage,
  preferredPlan,
  seriesLinks,
  withPlanPictures,
} from "@/lib/floorplans/extractors/lennar";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Shaped like Prosperity Lakes' Apollo state (2026-09-23): a community page
// caches a plan's first elevation under `elevationImages({"first":1})`; a
// plan's own page carries every elevation, the walkthrough and the floors.
const cdn = (n: string) => `https://cdn.lennar.com/api/images/contentassets/x/${n}?d=1`;
const dover = {
  __typename: "PlanType",
  name: "Dover",
  id: "p_61238",
  url: "/new-homes/florida/tampa-manatee/parrish/prosperity-lakes/the-estates/dover",
  community: { __ref: "CommunityType:c_7239" },
  startingPrice: 330400,
  sqft: 1555,
  beds: 3,
  baths: 2,
  halfBaths: 0,
  garages: 2,
  overview: "This single-story home optimizes space and prioritizes ease of living.",
  virtualTourUrl: "https://www.modsy.com/homejourney/embed/lennar/community/457/modelhome/2611/virtualtour/2616",
  heroImage: { alt: "living room", url: cdn("tpu_1551_rend_dover_living_2of2_f1_base4.jpg") },
  elevationImages: [
    { title: "Exterior K", image: { alt: "Dover elevation K", url: cdn("tpu_1551_rend_dover_group2_k.jpg") } },
    { title: "Exterior L", image: { alt: "Exterior L", url: cdn("tpu_1551_rend_dover_group2_l.jpg") } },
  ],
  walkthrough: {
    allRooms: [
      { name: "Owner’s Suite", content: { hero: { image: { url: cdn("tpu_1551_rend_dover_ownerssuite.jpg") } }, roomImageGallery: [] } },
      { name: "Kitchen", content: { hero: { image: { url: cdn("tpu_1551_rend_dover_kitchen.jpg") } }, roomImageGallery: [{ image: { url: cdn("tpu_1551_rend_dover_kitchen_2.jpg") } }] } },
      { name: "Laundry Room", content: { hero: { image: { url: cdn("tpu_1551_rend_dover_laundry.jpg") } }, roomImageGallery: [] } },
    ],
  },
  floorplans: [
    {
      name: "1st Floor",
      default: { image: { url: cdn("tpu_1551_fp_dover_mod1_ow.svg") } },
      reversed: { image: { url: cdn("tpu_1551_fp_dover_mod1_ow_revl.svg") } },
    },
  ],
};

describe("Lennar: a plan's own page, whole", () => {
  it("leads with the front, then the rooms by their names, the hero, and the other elevations last", () => {
    const g = planGallery(dover);
    expect(g.urls).toEqual([
      cdn("tpu_1551_rend_dover_group2_k.jpg"),
      cdn("tpu_1551_rend_dover_kitchen.jpg"),
      cdn("tpu_1551_rend_dover_kitchen_2.jpg"),
      cdn("tpu_1551_rend_dover_living_2of2_f1_base4.jpg"),
      cdn("tpu_1551_rend_dover_ownerssuite.jpg"),
      cdn("tpu_1551_rend_dover_laundry.jpg"),
      cdn("tpu_1551_rend_dover_group2_l.jpg"),
    ]);
    expect(g.meta[cdn("tpu_1551_rend_dover_ownerssuite.jpg")].room).toBe("bedroom");
  });

  it("takes each floor's drawing and its reverse", () => {
    expect(planDrawings(dover)).toEqual([cdn("tpu_1551_fp_dover_mod1_ow.svg"), cdn("tpu_1551_fp_dover_mod1_ow_revl.svg")]);
  });

  it("reads a field cached under arguments, as the community page caches the first elevation", () => {
    const brief = { ...dover, walkthrough: null, elevationImages: undefined, 'elevationImages({"first":1})': [dover.elevationImages[0]] };
    expect(planGallery(brief).urls[0]).toBe(cdn("tpu_1551_rend_dover_group2_k.jpg"));
  });
});

describe("Lennar: what a community builds", () => {
  it("reads the home type from the collection's name, then its types", () => {
    expect(communityHomeType({ name: "The Townhomes", types: ["MULTI_FAMILY"] })).toBe("Townhome");
    expect(communityHomeType({ name: "Coach Homes", types: ["MULTI_FAMILY"] })).toBe("Coach Home");
    expect(communityHomeType({ name: "The Estates", types: ["SINGLE_FAMILY"] })).toBe("Single Family Home");
    expect(communityHomeType({ name: "Veranda Condominiums" })).toBe("Condominium");
    // Calusa Country Club (2026-09-23): the buildings' names, and nothing else.
    expect(communityHomeType({ name: "Veranda Golf Collection", types: ["MULTI_FAMILY"] })).toBe("Condominium");
    expect(communityHomeType({ name: "Terrace Resort Collection", types: ["MULTI_FAMILY"] })).toBe("Condominium");
  });

  it("gives every plan and each home on it the plan's facts, drawings and type", () => {
    const apollo = {
      "PlanType:p_61238": dover,
      "CommunityType:c_7239": { name: "The Estates", types: ["SINGLE_FAMILY"] },
      "HomesiteType:h_1": { plan: { __ref: "PlanType:p_61238" }, address: "12715 Teal Topaz Lane", price: 304400, beds: 3, baths: 2, url: "/x/dover/15198575097", elevationImage: { url: cdn("dover_k.jpg") } },
    };
    const [plan, home] = plansFromPage(apollo, "/new-homes/florida/tampa-manatee/parrish/prosperity-lakes");
    expect(plan.homeType).toBe("Single Family Home");
    expect(plan.blueprintImages).toHaveLength(2);
    expect(plan.description).toMatch(/single-story/);
    expect(plan.garages).toBe("2 car");
    expect(home.quickMoveIn).toBe(true);
    expect(home.homeType).toBe("Single Family Home");
    expect(home.raw?.relatedPlan).toBe("Dover");
  });

  it("takes no front for a home whose picture is Lennar's Coming Soon stand-in (Jeff, 2026-09-24)", () => {
    const apollo = {
      "PlanType:p_61238": dover,
      "CommunityType:c_7239": { name: "The Estates", types: ["SINGLE_FAMILY"] },
      "HomesiteType:h_2": {
        plan: { __ref: "PlanType:p_61238" }, address: "2805 Sweet Pepper Way", price: 404990, beds: 4, baths: 3,
        url: "/x/sorrento/23414600478", elevationImage: { url: "/images/com/images/version10/default/qmi/ComingSoon.jpg" },
      },
    };
    const home = plansFromPage(apollo, "/new-homes/florida/tampa-manatee/parrish/prosperity-lakes").find((p) => p.quickMoveIn)!;
    expect(home.name).toBe("2805 Sweet Pepper Way");
    expect(home.galleryImages).toEqual([]);
  });
});

describe("planPrice", () => {
  it("takes the starting price of a plan Lennar prices", () => {
    expect(planPrice(dover)).toBe(330400);
    // The Princeton at Calusa Country Club: coming soon, and priced.
    expect(planPrice({ startingPrice: 670999, status: "COMING_SOON", customPrice: null })).toBe(670999);
  });

  it("takes none for a plan Lennar shows as Coming Soon in place of a price (2026-10-02)", () => {
    // Prosperity Lakes and Seaire: every plan at $999,999.
    expect(planPrice({ startingPrice: 999999, status: "COMING_SOON", customPrice: "Coming Soon" })).toBeNull();
    // Calusa Country Club: $51,000.
    expect(planPrice({ startingPrice: 51000, status: "COMING_SOON", customPrice: "Coming Soon" })).toBeNull();
    expect(planPrice({ startingPrice: 999999 })).toBeNull();
    expect(planPrice({ startingPrice: 0 })).toBeNull();
  });

  it("leaves a Coming Soon plan with no price on the page it is read from", () => {
    const apollo = {
      "PlanType:p_1": { ...dover, name: "Steely", startingPrice: 999999, status: "COMING_SOON", customPrice: "Coming Soon" },
    };
    const [plan] = plansFromPage(apollo, "/new-homes/florida/tampa-manatee/parrish/prosperity-lakes");
    expect(plan.comingSoon).toBe(true);
    expect(plan.price).toBeNull();
    expect(plan.priceDisplay).toBeNull();
  });
});

describe("seriesLinks", () => {
  const aurora = "/new-homes/florida/sarasota-manatee/lakewood-ranch/aurora-at-lakewood-ranch";

  it("finds the series one level beneath a community, and not their plans", () => {
    const html = String.raw`{"url":"${aurora}/townhomes","x":1}<a href="${aurora}/patio-homes?tab=plans">` +
      String.raw`{\"url\":\"${aurora}/townhomes/avery\"}<a href='${aurora}/patio-homes'>`;
    expect(seriesLinks(html, aurora + "/")).toEqual([
      `https://www.lennar.com${aurora}/townhomes`,
      `https://www.lennar.com${aurora}/patio-homes`,
    ]);
  });

  it("does not take a neighbouring community whose name begins the same", () => {
    expect(seriesLinks(`"${aurora}-west/townhomes"`, aurora)).toEqual([]);
  });
});

describe("withPlanPictures", () => {
  const base = (over: Partial<NormalizedPlan>): NormalizedPlan => ({
    planKey: "x", name: "x", price: null, priceDisplay: null, beds: "", baths: "", sqft: null, garages: null,
    homeType: null, quickMoveIn: false, comingSoon: false, sourceUrl: null, galleryImages: [], blueprintImages: [], ...over,
  });
  // 6028 Mound Key Run, whose page shows its own front and then The Princeton's twelve.
  const princeton = base({
    planKey: "the princeton", name: "The Princeton", raw: { planId: "PlanType:p_71321" },
    galleryImages: ["princeton-f.jpg", "kitchen.jpg"],
    galleryMeta: { "princeton-f.jpg": { kind: "primary", room: "primary" }, "kitchen.jpg": { room: "kitchen", caption: "Kitchen" } },
    blueprintImages: ["fp.svg"], virtualTourUrl: "https://my.matterport.com/show/?m=x", description: "Single-story.",
  });
  const home = base({ planKey: "6028 mound key run", name: "6028 Mound Key Run", quickMoveIn: true, galleryImages: ["lot-front.jpg"], raw: { planId: "PlanType:p_71321" } });

  it("gives a home its plan's gallery, drawings and tour after its own front", () => {
    const [, got] = withPlanPictures([princeton, home]);
    expect(got.galleryImages).toEqual(["lot-front.jpg", "princeton-f.jpg", "kitchen.jpg"]);
    expect(got.galleryMeta?.["lot-front.jpg"]?.kind).toBe("primary");
    expect(got.galleryMeta?.["princeton-f.jpg"]?.kind).toBe("exterior");
    expect(got.blueprintImages).toEqual(["fp.svg"]);
    expect(got.virtualTourUrl).toBe("https://my.matterport.com/show/?m=x");
    expect(got.description).toBe("Single-story.");
  });

  it("leads a home with no front of its own with its plan's front", () => {
    const [, got] = withPlanPictures([princeton, { ...home, galleryImages: [] }]);
    expect(got.galleryImages).toEqual(["princeton-f.jpg", "kitchen.jpg"]);
    expect(got.galleryMeta?.["princeton-f.jpg"]?.kind).toBe("primary");
  });

  it("leaves a home whose plan did not come back as it was", () => {
    const [got] = withPlanPictures([{ ...home, raw: { planId: "PlanType:elsewhere" } }]);
    expect(got.galleryImages).toEqual(["lot-front.jpg"]);
  });
});

describe("preferredPlan: two plans of one name in a community (Jeff, 2026-10-03)", () => {
  // Prosperity Lakes: the Estates' Columbia is MODEL ONLY, the Manors' sells from $358,490 with two homes.
  const apollo = {
    "PlanType:p_62037": { ...dover, name: "Columbia", id: "p_62037", url: "/new-homes/florida/tampa-manatee/parrish/prosperity-lakes/the-estates/columbia",
      startingPrice: 369990, customPrice: "MODEL ONLY", availableHomesitesCount: 0 },
    "PlanType:p_61248": { ...dover, name: "Columbia", id: "p_61248", url: "/new-homes/florida/tampa-manatee/parrish/prosperity-lakes/the-manors/columbia",
      startingPrice: 358490, customPrice: null, availableHomesitesCount: 2 },
  };
  const [estates, manors] = plansFromPage(apollo, "/new-homes/florida/tampa-manatee/parrish/prosperity-lakes");

  it("keeps the plan that is for sale, whichever was read first", () => {
    expect(estates.price).toBeNull();
    expect(preferredPlan(estates, manors)).toBe(manors);
    expect(preferredPlan(manors, estates)).toBe(manors);
    expect(manors.priceDisplay).toBe("$358,490");
  });

  it("between two priced plans, keeps the one with more homes on offer, else the first", () => {
    const more = { ...estates, price: 369990, raw: { ...estates.raw, homesOnOffer: 3 } };
    expect(preferredPlan(manors, more)).toBe(more);
    expect(preferredPlan(manors, { ...more, raw: { ...more.raw, homesOnOffer: 2 } })).toBe(manors);
  });
});

describe("Future release: a plan Lennar shows with no home to sell (Jeff, 2026-10-09)", () => {
  // The Stanford's page at Calusa Country Club reads "Future release"; The
  // Richmond's "3 Homes available in this community"; Napoli Grande's
  // "This plan is coming soon" (2026-10-09).
  const site = (status: string) => ({ __typename: "HomesiteType", name: "The Richmond", status });

  it("reads the plan's page as Lennar does: no home on offer, neither coming soon nor sold out", () => {
    expect(isFutureRelease({ name: "The Stanford", status: "ACTIVE", availableHomesitesCount: 0, homesites: [] })).toBe(true);
    expect(isFutureRelease({ name: "The Richmond", status: "ACTIVE", homesites: [site("UNDER_CONSTRUCTION"), site("MOVE_IN_READY")] })).toBe(false);
    expect(isFutureRelease({ name: "Napoli Grande", status: "COMING_SOON", homesites: [] })).toBe(false);
    expect(isFutureRelease({ name: "Gone", status: "SOLD_OUT", homesites: [] })).toBe(false);
    // A home Lennar has no status for is not one on offer.
    expect(isFutureRelease({ name: "The Stanford", status: "ACTIVE", homesites: [site("UNDEFINED")] })).toBe(true);
  });

  it("goes by the community page's count where the plan's homes are not listed", () => {
    expect(isFutureRelease({ name: "Angelina", status: "ACTIVE", availableHomesitesCount: 0 })).toBe(true);
    expect(isFutureRelease({ name: "Victoria", status: "ACTIVE", availableHomesitesCount: 2 })).toBe(false);
    expect(isFutureRelease({ name: "Unknown", status: "ACTIVE" })).toBe(false);
  });

  it("marks the plan it reads", () => {
    const base = "/new-homes/florida/sarasota-manatee/lakewood-ranch/calusa-country-club";
    const apollo = {
      "PlanType:p_71322": { __typename: "PlanType", name: "The Stanford", url: `${base}/manor-golf-collection/the-stanford`, status: "ACTIVE", availableHomesitesCount: 0, startingPrice: 698999 },
      "PlanType:p_71351": { __typename: "PlanType", name: "The Richmond", url: `${base}/manor-golf-collection/the-richmond`, status: "ACTIVE", availableHomesitesCount: 3, startingPrice: 751999 },
    };
    const plans = plansFromPage(apollo, base);
    expect(plans.map((p) => [p.name, p.raw?.futureRelease])).toEqual([
      ["The Stanford", true],
      ["The Richmond", false],
    ]);
  });
});
