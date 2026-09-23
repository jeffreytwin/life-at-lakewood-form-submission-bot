import { describe, expect, it } from "vitest";
import { homeFromRecord, planFromRecord, scriptLists } from "@/lib/floorplans/extractors/kb";

const ORIGIN = "https://www.kbhome.com";

// Plan 1286 at Creekside at Rutland Ranch as the page writes it (2026-09-23).
const plan1286 = {
  specialCopy: null,
  pricedFrom: "329990",
  stories: "1",
  pricingHtml: "From <span class='pl-1'>$329,990</span>",
  style: "Single Family",
  pricedFromDisplayText: "$329,990",
  floorPlanID: "03012070-140.1286",
  title: "Plan 1286",
  size: "1286",
  bedroomsMax: "3",
  bedroomsMin: "3",
  bathroomsMin: "2",
  bathroomsMax: "2",
  garagesMin: "2",
  garagesMax: "2",
  thumbnailImage: {
    image: "/globalassets/images/community-images/florida/sarasota-bradenton/creekside-at-rutland-ranch/floor-plan/exterior-images-front/1286_a_sch1_shutters.jpg",
    caption: "Exterior A",
  },
  name: "Plan 1286",
  pageUrl: "/new-homes-sarasota-bradenton/creekside-at-rutland-ranch/plan-1286",
  isActive: false,
};

describe("scriptLists", () => {
  it("reads each list of records a page hands its scripts, brackets in strings and all", () => {
    const html = `<script>
      window.appData.config.bookingsData.communityId = "03012070";
      var FloorPlanList = ${JSON.stringify([plan1286, { ...plan1286, title: "Plan 1541 [Modeled]", floorPlanID: "x.1541" }])};
      var jitHeading = "Join Interest List";
      var Empty = [];
      var Numbers = [1, 2];
    </script>`;
    const lists = scriptLists(html);
    expect(Object.keys(lists)).toEqual(["FloorPlanList", "Empty"]);
    expect(lists.FloorPlanList.map((r) => r.title)).toEqual(["Plan 1286", "Plan 1541 [Modeled]"]);
  });
});

describe("planFromRecord", () => {
  it("takes a plan's facts, its page and its front off its card's record", () => {
    expect(planFromRecord(plan1286, ORIGIN)).toMatchObject({
      name: "Plan 1286",
      price: 329990,
      priceDisplay: "$329,990",
      beds: "3",
      baths: "2",
      sqft: 1286,
      garages: "2 car",
      homeType: "Single Family Home",
      quickMoveIn: false,
      sourceUrl: "https://www.kbhome.com/new-homes-sarasota-bradenton/creekside-at-rutland-ranch/plan-1286",
      galleryImages: [
        "https://www.kbhome.com/globalassets/images/community-images/florida/sarasota-bradenton/creekside-at-rutland-ranch/floor-plan/exterior-images-front/1286_a_sch1_shutters.jpg",
      ],
      raw: { planId: "03012070-140.1286" },
    });
  });

  it("gives a range where the plan offers one", () => {
    expect(planFromRecord({ ...plan1286, bedroomsMax: "4", bathroomsMax: "3" }, ORIGIN)).toMatchObject({ beds: "3-4", baths: "2-3" });
  });
});

describe("homeFromRecord", () => {
  it("takes a home for sale by its street, price and plan", () => {
    const home = homeFromRecord(
      { address: "4512 Creekside Loop, Parrish, FL 34219", price: "389990", floorPlanName: "Plan 1541", bedrooms: "3", bathrooms: "2", size: "1541", pageUrl: "/mir/4512" },
      ORIGIN
    );
    expect(home).toMatchObject({ name: "4512 Creekside Loop", price: 389990, quickMoveIn: true, relatedPlanName: "Plan 1541", sqft: 1541, sourceUrl: "https://www.kbhome.com/mir/4512" });
  });

  it("is not fooled by another list's addresses", () => {
    expect(homeFromRecord({ address: "123 Main St", name: "Sales office" }, ORIGIN)).toBeNull();
    expect(homeFromRecord({ address: "Parrish, FL", price: "1", floorPlanName: "x" }, ORIGIN)).toBeNull();
  });
});
