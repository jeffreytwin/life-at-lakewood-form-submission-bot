import { describe, expect, it } from "vitest";
import {
  availableHomesPage,
  communityRecordIn,
  homeIsIn,
  homesListedIn,
  listedPrices,
  normalizeArHome,
  normalizeArPlan,
  planIdsOf,
  planTour,
  type ArHome,
  type ArPlan,
} from "@/lib/floorplans/extractors/arhomes";

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

// Lakewood Ranch's home finder, AR only (build[]=34701): a card per plan, and one per home built.
const card = (name: string, price: string, village: string, kinds = "Custom, Single-Family Home") => `
  <div class="hotel ">
    <div class="hotel-photo relative" style="background-image:url(https://lakewoodranch.com/wp-content/uploads/2025/01/${name.replace(/\W+/g, "-")}.jpg);">
      <a class="full-link" href="https://lakewoodranch.com/homes/${name.toLowerCase().replace(/\W+/g, "-")}/"></a>
      <div class="bedbathoverlay"><li class="bed">4 Bed //</li><li class="bath">4.5 Bath //</li><li class="garages">3 Car // </li><li class="sf">4,254 SF</li></div>
    </div>
    <p class="subhead mb-10"><em>${kinds}</em></p>
    <h4 class="coral bold no-btm">${name}</h4>
    <h4 class="dark-grey mb-10">${price}</h4>
    <p class="no-btm"><strong>Village: </strong>${village}</p>
    <p><strong>Builder: </strong>Arthur Rutenberg Homes</p>
  </div>`;
const finder = `<div class="flex-grid hotels home-finder">
  ${card("The Talise II 1746", "Homes From $2,773,800", "Waterside &#8211; Wild Blue")}
  ${card("Avila", "Homes From $2,255,300", "Waterside &#8211; Wild Blue")}
  ${card("123 Crystal Waters Drive", "$3,178,655", "Waterside &#8211; Wild Blue", "Move-In Ready, Single-Family Home")}
  ${card("Talise", "Homes From $1,900,000", "Star Farms")}
</div><footer></footer>`;

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

  it("reads the prices Lakewood Ranch advertises for the village's plans, and no home already built", () => {
    expect(listedPrices(finder, "Waterside - Wild Blue")).toEqual([
      { name: "The Talise II 1746", price: 2773800, page: "https://lakewoodranch.com/homes/the-talise-ii-1746/" },
      { name: "Avila", price: 2255300, page: "https://lakewoodranch.com/homes/avila/" },
    ]);
    expect(listedPrices(finder, "Star Farms")).toEqual([{ name: "Talise", price: 1900000, page: "https://lakewoodranch.com/homes/talise/" }]);
    expect(listedPrices(finder, "Waterside - Kingfisher Estates")).toEqual([]);
  });

  it("makes a plan of a plan's record, priced as Lakewood Ranch advertises it, with its photos and drawing", () => {
    const plan = normalizeArPlan(talise, listedPrices(finder, "Waterside - Wild Blue"))!;
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
    const plain = normalizeArPlan({ ...talise, id: 19584, slug: "talise", title: { rendered: "Talise" } }, listedPrices(finder, "Waterside - Wild Blue"))!;
    expect(plain.price).toBeNull();
  });

  it("leaves a plan Lakewood Ranch does not advertise without a price (Eventide), whatever arhomes.com's records say", () => {
    const eventide = normalizeArPlan({ ...talise, id: 1, slug: "eventide", title: { rendered: "Eventide" } }, listedPrices(finder, "Waterside - Wild Blue"))!;
    expect(eventide.price).toBeNull();
    expect(eventide.priceDisplay).toBeNull();
  });
});

describe("a plan's virtual tour (Eventide, Jeff 2026-09-28)", () => {
  const matterport = "https://my.matterport.com/show/?m=TKipoYvkC4W&play=1";

  it("takes a tour the plan's record carries, in whatever field", () => {
    const withTour = { ...talise, acf: { ...talise.acf, virtual_tour: matterport } } as ArPlan;
    expect(normalizeArPlan(withTour, [])?.virtualTourUrl).toBe("https://my.matterport.com/show/?m=TKipoYvkC4W");
    expect(normalizeArPlan(talise, [])?.virtualTourUrl).toBeNull();
  });

  it("reads the tour off the plan's page: embedded, linked, or behind a page of the builder's", async () => {
    const pages: Record<string, string> = {
      "https://www.arhomes.com/plan/lago/": `<iframe src="${matterport}"></iframe>`,
      "https://www.arhomes.com/plan/eventide/": '<a class="btn" href="https://my.matterport.com/show/?m=EvEnTiDe1"><span>Virtual Tour</span></a>',
      "https://www.arhomes.com/plan/talise/": '<a href="https://www.arhomes.com/tours/talise/">VIRTUAL TOUR</a>',
      "https://www.arhomes.com/tours/talise/": '<iframe src="https://my.matterport.com/show/?m=TaLiSe22"></iframe>',
      "https://www.arhomes.com/plan/atwater/": '<a href="#">Request information</a>',
    };
    const read = async (url: string) => {
      if (!(url in pages)) throw new Error(`fetch ${url}: 404`);
      return pages[url];
    };
    expect(await planTour("https://www.arhomes.com/plan/lago/", read)).toBe("https://my.matterport.com/show/?m=TKipoYvkC4W");
    expect(await planTour("https://www.arhomes.com/plan/eventide/", read)).toBe("https://my.matterport.com/show/?m=EvEnTiDe1");
    expect(await planTour("https://www.arhomes.com/plan/talise/", read)).toBe("https://my.matterport.com/show/?m=TaLiSe22");
    expect(await planTour("https://www.arhomes.com/plan/atwater/", read)).toBeNull();
  });
});

describe("a tour from Lakewood Ranch's page for the plan (Jeff, 2026-09-28)", () => {
  it("keeps the plan's page there, and reads it for a tour where AR's page has none", async () => {
    const plan = normalizeArPlan(talise, listedPrices(finder, "Waterside - Wild Blue"))!;
    expect(plan.raw?.listedPage).toBe("https://lakewoodranch.com/homes/the-talise-ii-1746/");
    const pages: Record<string, string> = {
      "https://www.arhomes.com/plan/talise-ii/": '<a href="#">Request information</a>',
      "https://lakewoodranch.com/homes/the-talise-ii-1746/": '<iframe src="https://my.matterport.com/show/?m=LwRtAl1se"></iframe>',
    };
    const read = async (url: string) => pages[url] ?? "";
    expect(await planTour(plan.sourceUrl!, read)).toBeNull();
    expect(await planTour(String(plan.raw?.listedPage), read)).toBe("https://my.matterport.com/show/?m=LwRtAl1se");
  });
});

describe("Arthur Rutenberg's quick move-ins from its Available Homes (Wild Blue, Jeff 2026-10-09)", () => {
  // Nelson Homes' Available Homes page and two of the records it lists (2026-10-09).
  const listing = `<script id="arhomes-corp-main-js-after">
window.arhData = window.arhData || {};
            window.arhData ['id6ac937a07b6a4'] = {"useApi":false,"pageSlug":"builder\\/nelson-homes-inc\\/available-homes","results":[{"id":46312,"link":"https:\\/\\/www.arhomes.com\\/builder\\/nelson-homes-inc\\/available-homes\\/custom-lago-at-wild-blue-2\\/","title":"Custom Lago at Wild Blue","sale_price":3479875},{"id":41782,"link":"https:\\/\\/www.arhomes.com\\/builder\\/nelson-homes-inc\\/available-homes\\/lago-model-at-wild-blue\\/","title":"Lago Model at Wild Blue","sale_price":3178655},{"id":50001,"title":"Avila at Lakewood National","sale_price":2100000}]};
</script>`;
  const lago: ArHome = {
    id: 46312,
    link: "https://www.arhomes.com/builder/nelson-homes-inc/available-homes/custom-lago-at-wild-blue-2/",
    title: { rendered: "Custom Lago at Wild Blue" },
    acf: {
      sale_price: 3479875,
      address_text: " 8613 Sandpoint Street, Sarasota, Florida",
      bedrooms: 3,
      baths: 3,
      half_baths: "1",
      sq_ft: 3632,
      garages: 3,
      banner_image: { url: "https://www.arhomes.com/wp-content/uploads/2026/05/Lago-1951B_Elevation-B-Front.webp" },
      photo_gallery: [
        { url: "https://www.arhomes.com/wp-content/uploads/2025/02/Lago1951_GreatRoom01.webp" },
        { url: "https://www.arhomes.com/wp-content/uploads/2026/05/Lago-1951B_Elevation-B-Front.webp" },
      ],
      plan_pdf_image: { url: "https://www.arhomes.com/wp-content/uploads/2026/05/BC91_CustomLagoShowcase_WebFP-scaled.webp" },
    },
  };

  it("finds the builder's Available Homes page from the community's page", () => {
    expect(availableHomesPage("https://www.arhomes.com/builder/nelson-homes-inc/communities/wild-blue-in-waterside/")).toBe(
      "https://www.arhomes.com/builder/nelson-homes-inc/available-homes/"
    );
    expect(availableHomesPage("https://www.arhomes.com/communities/wild-blue/")).toBeNull();
  });

  it("lists the homes the page carries, and keeps the community's own", () => {
    const homes = homesListedIn(listing);
    expect(homes.map((h) => h.id)).toEqual([46312, 41782, 50001]);
    const title = "Wild Blue at Waterside in Lakewood Ranch";
    expect(homes.filter((h) => homeIsIn(h.title ?? "", title)).map((h) => h.id)).toEqual([46312, 41782]);
    expect(homeIsIn("Lago Model", title)).toBe(false);
  });

  it("makes a quick move-in of a home's record, named by its street and tied to its plan", () => {
    const home = normalizeArHome(lago)!;
    expect(home).toMatchObject({
      planKey: "8613-sandpoint-street",
      name: "8613 Sandpoint Street",
      price: 3479875,
      priceDisplay: "$3,479,875",
      beds: "3",
      baths: "3.5",
      sqft: 3632,
      garages: "3 car",
      quickMoveIn: true,
      relatedPlanName: "Lago",
      sourceUrl: "https://www.arhomes.com/builder/nelson-homes-inc/available-homes/custom-lago-at-wild-blue-2/",
      blueprintImages: ["https://www.arhomes.com/wp-content/uploads/2026/05/BC91_CustomLagoShowcase_WebFP-scaled.webp"],
    });
    expect(home.galleryImages).toEqual([
      "https://www.arhomes.com/wp-content/uploads/2026/05/Lago-1951B_Elevation-B-Front.webp",
      "https://www.arhomes.com/wp-content/uploads/2025/02/Lago1951_GreatRoom01.webp",
    ]);
    const model = normalizeArHome({ ...lago, title: { rendered: "Lago Model at Wild Blue" }, acf: { ...lago.acf, address_text: "263 Crystal Waters Drive, Sarasota, FL " } })!;
    expect(model.name).toBe("263 Crystal Waters Drive");
    expect(model.relatedPlanName).toBe("Lago");
  });

  it("leaves out a home the page keeps at $0, sold", () => {
    expect(normalizeArHome({ ...lago, acf: { ...lago.acf, sale_price: 0 } })).toBeNull();
  });
});
