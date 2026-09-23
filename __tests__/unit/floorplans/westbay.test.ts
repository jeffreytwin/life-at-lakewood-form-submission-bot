import { describe, expect, it } from "vitest";
import { communityIdIn, homeFromRecord, planFromRecord, residenceName } from "@/lib/floorplans/extractors/westbay";

// Star Farms at Lakewood Ranch as WestBay's page and feeds gave it (2026-09-23).
describe("communityIdIn", () => {
  it("reads the id the page hands the lists it draws", () => {
    const page = `<series-list :community="24" :community-name="'Star Farms at Lakewood Ranch'"></series-list>
      <community-page-toggle-list :region="1" :community="24" :home-count="5" :residence-count="47">`;
    expect(communityIdIn(page)).toBe("24");
    expect(communityIdIn(`<base-form :context-region="1" :context-community="31">`)).toBe("31");
    expect(communityIdIn("<div>no community here</div>")).toBeNull();
  });
});

describe("planFromRecord", () => {
  it("takes a plan's facts as the feed gives them, the smaller size and the larger ranges kept as ranges", () => {
    const plan = planFromRecord({
      id: 331,
      cover: "https://d3ep4ovemm7dcp.cloudfront.net/mixed-media/a02aeb27/large/Abruzzo-I-Coastal-D.jpg",
      coverAlt: null,
      name: "Abruzzo I",
      series_name: "Masterpiece",
      price: 1070990,
      beds: "3 - 4",
      baths: 4,
      sqft: "3,418 - 3,626",
      garage: 3,
      floors: 1,
      url: "https://www.homesbywestbay.com/floorplans/abruzzo-i",
    })!;
    expect(plan).toMatchObject({
      planKey: "abruzzo-i",
      name: "Abruzzo I",
      price: 1070990,
      priceDisplay: "$1,070,990",
      beds: "3-4",
      baths: "4",
      sqft: 3418,
      garages: "3 car",
      homeType: "Single Family Home",
      quickMoveIn: false,
      sourceUrl: "https://www.homesbywestbay.com/floorplans/abruzzo-i",
      galleryImages: ["https://d3ep4ovemm7dcp.cloudfront.net/mixed-media/a02aeb27/large/Abruzzo-I-Coastal-D.jpg"],
      raw: { planId: "331", series: "Masterpiece" },
    });
  });

  it("calls a villa series' plans attached villas", () => {
    expect(planFromRecord({ name: "Siesta", series_name: "Villas", price: 400000 })!.homeType).toBe("Attached Villa");
  });
});

describe("homeFromRecord", () => {
  it("names a home by its street and ties it to the plan its title names", () => {
    const home = homeFromRecord({
      id: 1362,
      cover: { hd: "https://d3ep4ovemm7dcp.cloudfront.net/mixed-media/a15514b9/hd/Egret%20III-Coastal-E.jpg" },
      coverAlts: { default: "Egret III - Coastal E - COA4 Color Scheme - Flat Tile" },
      title: "Egret III at Star Farms at Lakewood Ranch",
      series_name: "Innovation Series",
      address: "18716 Heartland Place",
      price: 786043,
      beds: 3,
      baths: 3,
      sqft: "2,624",
      garage: 2,
      url: "https://www.homesbywestbay.com/where-we-build/quick-move-in-homes/18716-heartland-place-1783014134",
      availability_headline: "Estimated Completion: Nov / Dec",
    })!;
    expect(home).toMatchObject({
      planKey: "18716-heartland-place",
      name: "18716 Heartland Place",
      price: 786043,
      beds: "3",
      baths: "3",
      sqft: 2624,
      garages: "2 car",
      quickMoveIn: true,
      relatedPlanName: "Egret III",
      galleryImages: ["https://d3ep4ovemm7dcp.cloudfront.net/mixed-media/a15514b9/hd/Egret%20III-Coastal-E.jpg"],
    });
  });

  it("leaves out a record with no street", () => {
    expect(homeFromRecord({ title: "Egret III at Star Farms", price: 1 })).toBeNull();
  });
});

describe("residenceName", () => {
  it("names the plan a residence is of, however the feed spells it", () => {
    expect(residenceName({ name: "Sandpiper", series_name: "Innovation" })).toBe("Sandpiper");
    expect(residenceName({ plan_name: "Heron II", name: "Heron II - Star Farms" })).toBe("Heron II");
    expect(residenceName({ plan: { name: "Pelican" } })).toBe("Pelican");
    expect(residenceName({ title: "Egret III at Star Farms at Lakewood Ranch" })).toBe("Egret III");
  });
});
