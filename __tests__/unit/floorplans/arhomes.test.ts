import { describe, expect, it } from "vitest";
import { communityRecordIn, normalizeArPlan, planIdsOf, tilePrices, type ArPlan } from "@/lib/floorplans/extractors/arhomes";

// The shapes AR Homes' WordPress answers with for Wild Blue at Waterside (2026-09-27).
const community = {
  acf: {
    layout: [
      { acf_fc_layout: "hero_section" },
      {
        tiles: [
          {
            title: "Avila 1427",
            description:
              '<a href="https://www.arhomes.com/builder/nelson-homes-inc/plan/avila-1427/"><strong>3 Bedrooms | 3 Bathrooms | 3,134 Sq. Ft. | $2,255,300</strong><br />\r\n<br />\r\nPricing includes our executive level home finishes, a $450,000 Lot Value, with a $290,000 Pool, Spa / Outdoor Living Package.<br /><strong>VIEW PLAN</strong></a>',
          },
          { title: "Talise II 1746", description: '<a href="https://www.arhomes.com/builder/nelson-homes-inc/plan/talise-ii-1746/"><strong>4 Bedrooms | 4.5 Bathrooms | 4,254 Sq. Ft. | $2,773,800</strong></a>' },
          { title: "Coming soon", description: "<p>Ask us about our next model.</p>" },
        ],
      },
      { plans_list: [34050, 19584, 34050] },
    ],
  },
};

const talise: ArPlan = {
  id: 34050,
  slug: "talise-ii",
  link: "https://www.arhomes.com/plan/talise-ii/",
  title: { rendered: "Talise II" },
  acf: {
    bedrooms: "4",
    bathrooms: "4",
    half_baths: "1",
    square_feet: "4254",
    garages: "3",
    banner_image: { url: "https://www.arhomes.com/wp-content/uploads/2022/07/Talise_FrontDusk01.webp" },
    gallery: [{ url: "https://www.arhomes.com/wp-content/uploads/2022/07/Talise_FrontDusk01.webp" }, { url: "https://www.arhomes.com/wp-content/uploads/2022/07/Talise_ElevC.webp" }],
    interior_gallery: [{ url: "https://www.arhomes.com/wp-content/uploads/2022/07/TaliseFrontDay01.webp" }],
    plan_pdf_image: { url: "https://www.arhomes.com/wp-content/uploads/2022/07/Talise-II-floor-plan.webp" },
  },
};

describe("Arthur Rutenberg's plans from its WordPress (Wild Blue, Jeff 2026-09-27)", () => {
  it("finds the community's record in the page", () => {
    const html = `<link rel="alternate" title="JSON" type="application/json" href="https://www.arhomes.com/wp-json/wp/v2/community/32027" />`;
    expect(communityRecordIn(html)).toBe("https://www.arhomes.com/wp-json/wp/v2/community/32027");
    expect(communityRecordIn("<html></html>")).toBeNull();
  });

  it("lists the grid's plans once each, in order", () => {
    expect(planIdsOf(community)).toEqual([34050, 19584]);
    expect(planIdsOf({ acf: { layout: [{ plans_list: [{ ID: 7 }, { id: 8 }] }] } })).toEqual([7, 8]);
  });

  it("reads each featured tile's price and the plan it names", () => {
    expect(tilePrices(community)).toEqual([
      { name: "Avila", slug: "avila", price: 2255300 },
      { name: "Talise II", slug: "talise-ii", price: 2773800 },
    ]);
  });

  it("makes a plan of a plan's record, priced by its tile, with its photos and drawing", () => {
    const plan = normalizeArPlan(talise, tilePrices(community))!;
    expect(plan).toMatchObject({
      planKey: "talise-ii",
      name: "Talise II",
      price: 2773800,
      priceDisplay: "$2,773,800",
      beds: "4",
      baths: "4.5",
      sqft: 4254,
      garages: "3 car",
      quickMoveIn: false,
      sourceUrl: "https://www.arhomes.com/plan/talise-ii/",
      blueprintImages: ["https://www.arhomes.com/wp-content/uploads/2022/07/Talise-II-floor-plan.webp"],
    });
    expect(plan.galleryImages).toEqual([
      "https://www.arhomes.com/wp-content/uploads/2022/07/Talise_FrontDusk01.webp",
      "https://www.arhomes.com/wp-content/uploads/2022/07/Talise_ElevC.webp",
      "https://www.arhomes.com/wp-content/uploads/2022/07/TaliseFrontDay01.webp",
    ]);
  });

  it("does not give the Talise the Talise II's price", () => {
    const plain = normalizeArPlan({ ...talise, id: 19584, slug: "talise", title: { rendered: "Talise" } }, tilePrices(community))!;
    expect(plain.price).toBeNull();
  });
});
