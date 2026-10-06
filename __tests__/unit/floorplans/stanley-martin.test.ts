import { describe, expect, it } from "vitest";
import { communityOf, galleryOf, homeFrom, pictureUrl, planFrom, streetName } from "@/lib/floorplans/extractors/stanley-martin";
import { linkQuickMoveIns } from "@/lib/floorplans/quick-move-ins";

const OAKFIELD = "https://www.stanleymartin.com/florida/tampa/parrish/oft/oakfield-trails";
const community = { page: OAKFIELD };
const IK = "https://ik.imagekit.io/p40fshsib";

describe("communityOf", () => {
  it("reads the community's id from the step before its name", () => {
    expect(communityOf(`${OAKFIELD}/`)).toEqual({ page: OAKFIELD, origin: "https://www.stanleymartin.com", id: "oft" });
  });

  it("finds none in an address with no community in it", () => {
    expect(communityOf("https://www.stanleymartin.com/")).toBeNull();
    expect(communityOf("not a url")).toBeNull();
  });
});

describe("pictureUrl", () => {
  it("drops the time each answer stamps on a picture, and the empty transform, and keeps updatedAt", () => {
    expect(pictureUrl(`${IK}/Home%20Asset%20Library/Sadler/S_AGS_FRG_INT_Sadler_%20FAM.jpg?updatedAt=1780602710465&t=1791321503&tr=fo-undefined`)).toBe(
      `${IK}/Home%20Asset%20Library/Sadler/S_AGS_FRG_INT_Sadler_%20FAM.jpg?updatedAt=1780602710465`
    );
    expect(pictureUrl(`${IK}/specs/181395/specicon.jpg?t=1791321459`)).toBe(`${IK}/specs/181395/specicon.jpg`);
    expect(pictureUrl("")).toBeNull();
  });
});

describe("streetName", () => {
  it("writes the feed's capitals as a street is written", () => {
    expect(streetName("10123 MORNING MEADOWLARK TRL")).toBe("10123 Morning Meadowlark Trl");
  });
});

describe("galleryOf", () => {
  it("leads with the front, puts the rooms in order, and the other elevations last", () => {
    const got = galleryOf(
      null,
      [{ imageUrl: `${IK}/a.jpg?t=1`, caption: "Elevation A" }, { imageUrl: `${IK}/b.jpg?t=1`, caption: "Elevation B" }],
      [{ imageUrl: `${IK}/bd2.jpg?t=1`, caption: "Bedroom #2" }, { imageUrl: `${IK}/kit.jpg?t=1`, caption: "Kitchen" }]
    );
    expect(got.galleryImages[0]).toBe(`${IK}/a.jpg`);
    expect(got.galleryImages[got.galleryImages.length - 1]).toBe(`${IK}/b.jpg`);
    expect(got.galleryImages.indexOf(`${IK}/kit.jpg`)).toBeLessThan(got.galleryImages.indexOf(`${IK}/bd2.jpg`));
    expect(got.galleryMeta?.[`${IK}/kit.jpg`]).toMatchObject({ caption: "Kitchen", room: "kitchen" });
  });
});

// Oakfield Trails as its feeds gave it (2026-10-06).
const sadler = {
  name: "The Sadler",
  productId: "003462V00",
  productType: "Single Family",
  minBaseSalesPrice: 380990,
  numberBedrooms: 3,
  numberFullBaths: 2,
  numberHalfBaths: 1,
  numberGarageSpaces: 2,
  minSQFeet: 2110,
  maxSQFeet: 2110,
  imageUrl: `${IK}/projects/oft/products/003462V00/producticon.jpg?t=1`,
};

describe("planFrom", () => {
  it("takes a floor plan with its price, facts, page, photos and description", () => {
    const plan = planFrom(sadler, community, {
      elevationImages: [{ imageUrl: `${IK}/The_Sadler-Elevation_A.jpg?updatedAt=1&t=2`, caption: "Elevation A" }],
      images: [{ imageUrl: `${IK}/Sadler_KIT_2.jpg?updatedAt=1&t=2`, caption: "Kitchen" }],
      briefDescription: "<p>Discover The Sadler, a beautifully designed two-story home.</p>",
    })!;
    expect(plan).toMatchObject({
      planKey: "the-sadler",
      name: "The Sadler",
      price: 380990,
      priceDisplay: "$380,990",
      beds: "3",
      baths: "2.5",
      sqft: 2110,
      garages: "2 car",
      homeType: "Single Family Home",
      quickMoveIn: false,
      sourceUrl: `${OAKFIELD}/floorplan/003462V00/the-sadler`,
      description: "Discover The Sadler, a beautifully designed two-story home.",
      raw: { planId: "003462V00" },
    });
    expect(plan.galleryImages).toEqual([`${IK}/The_Sadler-Elevation_A.jpg?updatedAt=1`, `${IK}/Sadler_KIT_2.jpg?updatedAt=1`]);
    expect(plan.pageUnread).toBeUndefined();
  });

  it("keeps the card's facts and picture where the plan's own feed could not be read", () => {
    const plan = planFrom(sadler, community, null)!;
    expect(plan).toMatchObject({ price: 380990, pageUnread: true });
    expect(plan.galleryImages).toEqual([`${IK}/projects/oft/products/003462V00/producticon.jpg`]);
  });
});

describe("homeFrom", () => {
  const listing = {
    id: 181409,
    productName: "Cortez II",
    productType: "Single Family",
    imageUrl: `${IK}/specs/181409/specicon.jpg?t=1`,
    address: "10063 MORNING MEADOWLARK TRL",
    bedroomCount: 4,
    fullBathCount: 2,
    halfBathCount: 1,
    garageCount: 2,
    squareFootage: 1876,
    salesPrice: 334990,
  };

  it("takes a home for sale by its street, with its own picture first and its plan's id", () => {
    const home = homeFrom(listing, community, { productId: "003464V01", lotNumber: "4145", images: [{ imageUrl: `${IK}/kit.jpg?t=1`, caption: "Kitchen" }] })!;
    expect(home).toMatchObject({
      planKey: "10063-morning-meadowlark-trl",
      name: "10063 Morning Meadowlark Trl",
      price: 334990,
      beds: "4",
      baths: "2.5",
      sqft: 1876,
      quickMoveIn: true,
      relatedPlanName: "Cortez II",
      sourceUrl: `${OAKFIELD}/new-homes/181409/10063-morning-meadowlark-trl`,
      raw: { planId: "003464V01", lot: "4145", sold: false },
    });
    expect(home.galleryImages).toEqual([`${IK}/specs/181409/specicon.jpg`, `${IK}/kit.jpg`]);
  });

  it("marks a home under contract sold", () => {
    expect(homeFrom(listing, community, { isContract: true })?.raw?.sold).toBe(true);
  });

  it("is tied to its plan by the plan's id, though the list names it more shortly", () => {
    const plan = planFrom({ ...sadler, name: "The Cortez II", productId: "003464V01" }, community, null)!;
    const home = homeFrom(listing, community, { productId: "003464V01" })!;
    expect(linkQuickMoveIns([plan, home])[1]).toMatchObject({ relatedPlanKey: "the-cortez-ii", relatedPlanMatch: "plan-id" });
  });
});
