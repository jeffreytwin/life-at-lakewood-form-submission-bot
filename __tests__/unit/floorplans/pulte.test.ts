import { describe, expect, it } from "vitest";
import { communityIdOf, homeFromRecord, planFromRecord, pulteGallery, type PulteHome, type PultePlan } from "@/lib/floorplans/extractors/pulte";

const ORIGIN = "https://www.pulte.com";
const RIVERSONG = "https://www.pulte.com/homes/florida/tampa/parrish/riversong-211407";
const pic = (n: number) => `https://pultegroup.picturepark.com/Go/x/V/${n}/13`;

// Daylen at Riversong as the plans feed carries it (2026-09-23), pictures
// in the feed's own order, which is not the gallery's.
const daylen: PultePlan = {
  id: 699105,
  planName: "Daylen",
  planTypeName: "Single Family Home",
  planTypeNameActual: "Single Family Home",
  bedrooms: 4,
  maxBedrooms: 4,
  bathrooms: 2,
  halfBaths: 0,
  maxBathrooms: 2,
  maxHalfBaths: 0,
  squareFeet: 1580,
  garages: 2,
  price: 342990,
  isSoldOut: false,
  description: "Embrace the Daylen's thoughtful design and comfort.",
  pageURL: "/homes/florida/sarasota/parrish/riversong-211407/daylen-699105",
  virtualTour: "",
  images: [
    { path: pic(1), altText: "Daylen Exterior ", caption: "Daylen Exterior ", imageRank: 1, imageType: "Home Exterior" },
    { path: pic(20), altText: "Elevation C1", caption: "Elevation C1", imageRank: 20, imageType: "Home Exterior" },
    { path: pic(9), altText: "Perfect for Entertaining ", caption: "Open-Concept Design ", imageRank: 9, imageType: "Home Interior" },
    { path: pic(5), altText: "Designer Kitchen ", caption: "Designer Kitchen ", imageRank: 5, imageType: "Home Interior" },
    { path: pic(10), altText: "Owner's Suite ", caption: "Owner's Suite ", imageRank: 10, imageType: "Home Interior" },
    { path: pic(18), altText: "Spacious Covered Lanai ", caption: "Spacious Covered Lanai ", imageRank: 18, imageType: "Home Exterior" },
  ],
};

describe("communityIdOf", () => {
  it("reads the number a community's address ends with", () => {
    expect(communityIdOf(RIVERSONG)).toBe("211407");
    expect(communityIdOf("https://www.delwebb.com/homes/florida/sarasota/lakewood-ranch/del-webb-catalina-211202/")).toBe("211202");
    expect(communityIdOf("https://www.pulte.com/homes/florida")).toBeNull();
  });
});

describe("planFromRecord", () => {
  const plan = planFromRecord(daylen, ORIGIN, RIVERSONG)!;

  it("takes the plan's facts as the feed gives them", () => {
    expect(plan).toMatchObject({
      name: "Daylen",
      price: 342990,
      priceDisplay: "$342,990",
      beds: "4",
      baths: "2",
      sqft: 1580,
      garages: "2 car",
      homeType: "Single Family Home",
      quickMoveIn: false,
      sourceUrl: "https://www.pulte.com/homes/florida/sarasota/parrish/riversong-211407/daylen-699105",
      description: "Embrace the Daylen's thoughtful design and comfort.",
      virtualTourUrl: null,
      raw: { planId: "699105" },
    });
  });

  it("leads with the front of the house and keeps the elevations as outside views", () => {
    expect(plan.galleryImages[0]).toBe(pic(1));
    expect(plan.galleryMeta?.[pic(1)]).toMatchObject({ kind: "primary", caption: "Daylen Exterior" });
    expect(plan.galleryMeta?.[pic(20)]).toMatchObject({ kind: "exterior", caption: "Elevation C1" });
    expect(plan.galleryMeta?.[pic(5)]?.room).toBe("kitchen");
    expect(plan.galleryMeta?.[pic(10)]?.room).toBe("bedroom");
    expect(plan.galleryImages.indexOf(pic(5))).toBeLessThan(plan.galleryImages.indexOf(pic(10)));
  });

  it("gives a range where the builder offers one, and a half bath as a half", () => {
    const p = planFromRecord({ ...daylen, bedrooms: 3, maxBedrooms: 5, bathrooms: 2, halfBaths: 1, maxBathrooms: 3, maxHalfBaths: 0 }, ORIGIN, RIVERSONG)!;
    expect(p.beds).toBe("3-5");
    expect(p.baths).toBe("2.5-3");
  });

  it("leaves out a plan the builder has sold out or no longer offers", () => {
    expect(planFromRecord({ ...daylen, isSoldOut: true }, ORIGIN, RIVERSONG)).toBeNull();
    expect(planFromRecord({ ...daylen, isPlanActive: false }, ORIGIN, RIVERSONG)).toBeNull();
  });

  it("says nothing of a price still to come, and marks the plan coming soon", () => {
    const p = planFromRecord({ ...daylen, priceComingSoon: true }, ORIGIN, RIVERSONG)!;
    expect(p.price).toBeNull();
    expect(p.comingSoon).toBe(true);
  });

  it("builds the plan's address from its name and id when the feed gives none", () => {
    expect(planFromRecord({ ...daylen, pageURL: null }, ORIGIN, RIVERSONG)!.sourceUrl).toBe(`${RIVERSONG}/daylen-699105`);
  });
});

describe("homeFromRecord", () => {
  // 16817 Harmony River Lane, a Pinecrest (2026-09-23): its feed pads the
  // address and leads its pictures with the community's amenity campus.
  const home: PulteHome = {
    inventoryHomeID: 1154558,
    address: { street1: "16817 Harmony River Lane      " },
    price: 427310,
    finalPrice: 427310,
    callForPricingFlag: false,
    soldDate: null,
    squareFeet: 2262,
    bedrooms: 4,
    bathrooms: 3,
    halfBaths: 0,
    totalBaths: 3,
    garages: 2,
    planId: 699478,
    planName: "Pinecrest",
    plan: { planTypeName: "Single Family Home", pageURL: "/homes/florida/sarasota/parrish/riversong-211407/pinecrest-699478" },
    images: [
      { path: pic(26), altText: "Expansive Amenity Campus", imageRank: 26, imageType: "Community Amenity" },
      { path: pic(2), altText: "Front Exterior", imageRank: 1, imageType: "Home Exterior" },
      { path: pic(3), altText: "Kitchen", imageRank: 2, imageType: "Home Interior" },
    ],
  };

  it("takes the home's facts, its plan, and only the pictures of the home", () => {
    expect(homeFromRecord(home, ORIGIN)).toMatchObject({
      name: "16817 Harmony River Lane",
      price: 427310,
      beds: "4",
      baths: "3",
      sqft: 2262,
      garages: "2 car",
      homeType: "Single Family Home",
      quickMoveIn: true,
      relatedPlanName: "Pinecrest",
      galleryImages: [pic(2), pic(3)],
      raw: { planId: "699478" },
    });
  });

  it("leaves out a home already sold, and gives no price where the builder asks you to call", () => {
    expect(homeFromRecord({ ...home, soldDate: "2026-09-01" }, ORIGIN)).toBeNull();
    expect(homeFromRecord({ ...home, callForPricingFlag: true }, ORIGIN)!.price).toBeNull();
  });
});

describe("pulteGallery", () => {
  it("leads with the first picture where none shows the outside", () => {
    const g = pulteGallery([{ path: pic(7), caption: "Cafe Area", imageRank: 3, imageType: "Home Interior" }]);
    expect(g.urls).toEqual([pic(7)]);
    expect(g.meta[pic(7)].kind).toBe("primary");
  });
});
