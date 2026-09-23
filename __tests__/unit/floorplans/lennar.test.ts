import { describe, it, expect } from "vitest";
import { communityHomeType, planDrawings, planGallery, plansFromPage } from "@/lib/floorplans/extractors/lennar";

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
});
