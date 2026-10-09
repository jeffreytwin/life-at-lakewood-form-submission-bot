import { describe, it, expect } from "vitest";
import { communityHomeType, homesOnPage, planLinks, planNameFrom, readDrhPage, homePageUrl } from "@/lib/floorplans/extractors/drhorton";

// Shaped like Oakfield Lakes as fetched on 2026-09-23, pruned.
const COMMUNITY = "https://www.drhorton.com/florida/manatee-sarasota/parrish/oakfield-lakes";
const home = (over: Record<string, unknown>) =>
  JSON.stringify({
    ItemId: "5f77b909-2899-41c3-b6ae-25283b9cdb0e",
    JdeBrandName: "Express Homes",
    PlanName: "Alford",
    PlanCode: "E313",
    Address: "10416 Curving Creek Loop",
    SquareFootage: 1739,
    NumberOfBedrooms: 5,
    NumberOfBathrooms: 2,
    NumberOfGarages: 1,
    Price: 319000,
    MonthlyPricing: { ItemId: { Guid: "26bb", IsNull: false }, JdeIsUnderContract: false, IsPending: false },
    JdeIsSold: false,
    Thumbnail: "/-/media/drhorton/productcatalog/397/e313/0202/alford-c-gen3-elev_ind_.jpg?iar=1&w=425",
    Status: "Available",
    Url: "/florida/manatee-sarasota/parrish/oakfield-lakes/qmis/10416-curving-creek-loop",
    LotNumber: "     474",
    ...over,
  });
const communityPage = `<h1>Homes for sale at Oakfield Lakes</h1>
  <script>var qmis = [${home({})},${home({ Address: "12416 Hopscotch Avenue", Status: "Under Contract" })},${home({ Address: "13117 Old Canoe Way", PlanName: "Robie", Price: 314000 })}];</script>
  <a href="/florida/manatee-sarasota/parrish/oakfield-lakes/floor-plans/3eab">Allex</a>
  <a href="/florida/manatee-sarasota/parrish/oakfield-lakes/floor-plans/e313/">Alford</a>
  <a href="/florida/manatee-sarasota/parrish/oakfield-trails/floor-plans/3eab">Allex at Trails</a>`;

const planPage = `<script type="application/ld+json">
	{"@context":"http://schema.org","@type":"FloorPlan","url":"${COMMUNITY}/floor-plans/3eab","numberOfBedrooms":3,"floorSize":1504,"numberOfBathroomsTotal":2}
</script>
<div class="PropertyGallery-container"><div class="PropertyGallery"><div class="sevenImages">
  <div class="property-gallery property-photo"><img data-lazy="/-/media/drhorton/productcatalog/3eab/allex_front.jpg?as=1&amp;w=494&amp;rev=5e" alt="Allex Exterior" src="/-/media/drhorton/productcatalog/3eab/allex_front.jpg?as=1&amp;w=494&amp;rev=5e"></div>
  <div class="property-gallery property-photo"><img data-lazy="/-/media/drhorton/productcatalog/3eab/1-kitchen.jpg?as=1&amp;w=494" alt="Kitchen"></div>
  <div class="property-gallery property-photo"><img data-lazy="/-/media/drhorton/productcatalog/3eab/7-master_bed.jpg?as=1&amp;w=494" alt="Primary Bedroom"></div>
  <div class="property-gallery property-photo"><img data-lazy="/-/media/drhorton/productcatalog/3eab/14-back_elevation.jpg?as=1&amp;w=494" alt="Allex Rear Exterior"></div>
  <div class="property-gallery property-photo"><img data-lazy="/-/media/drhorton/productcatalog/3eab/3-dining.jpg?as=1&amp;w=494" alt="Dining"></div>
</div></div><div class="mobile-carousel"></div>
<div class="mobile-3d-tour-button"><a href="https://www.zillow.com/view-imx/ebf4e1ec-e96b-4365-91c0-2bd1c62918ff?setAttribution=mls&amp;wl=true">3D Tour</a></div>
</div>
<h1>Oakfield Lakes Allex Floor Plan</h1><h2>starting at $293,990</h2><h3>|Express Series&reg;</h3>
<p>3 Bed | 2 Bath | 2 Garage | 1 Story 1,504 Sq. Ft.</p>
<div class="about-this-plan">
		<h3>About this floor plan</h3>
			<p>
			This all-concrete block constructed, one-story, two-car garage home optimizes living space.
			</p>
		<br/>
	</div>
	</div><section><div id="relatedmovein" class="related-move-in">Sort By $329,000 12412 Hopscotch Avenue</div></section>
<h2>21 homes for sale in this community</h2>`;

describe("D.R. Horton's community page (Oakfield Lakes, 2026-09-23)", () => {
  it("reads the homes for sale it carries as data, leaving out those under contract", () => {
    const homes = homesOnPage(communityPage);
    expect(homes.map((h) => h.Address)).toEqual(["10416 Curving Creek Loop", "13117 Old Canoe Way"]);
    expect(homes[0]).toMatchObject({ PlanName: "Alford", SquareFootage: 1739, Price: 319000 });
  });

  it("finds its own floor plans' pages, and not another community's", () => {
    expect(planLinks(communityPage, COMMUNITY)).toEqual([`${COMMUNITY}/floor-plans/3eab`, `${COMMUNITY}/floor-plans/e313`]);
  });
});

describe("D.R. Horton's plan page", () => {
  const page = readDrhPage(planPage);

  it("reads the facts, the price, the description and the tour", () => {
    expect(page).toMatchObject({ price: 293990, beds: "3", baths: "2", sqft: 1504, garages: "2 car" });
    expect(page.description).toBe("This all-concrete block constructed, one-story, two-car garage home optimizes living space.");
    expect(page.tour).toBe("https://www.zillow.com/view-imx/ebf4e1ec-e96b-4365-91c0-2bd1c62918ff");
    expect(planNameFrom(page.name!, ["Oakfield Lakes"])).toBe("Allex");
  });

  it("reads the gallery whole, each picture at its own size and with its title", () => {
    expect(page.gallery.map((g) => g.caption)).toEqual(["Allex Exterior", "Kitchen", "Primary Bedroom", "Allex Rear Exterior", "Dining"]);
    expect(page.gallery[0].src).toBe("https://www.drhorton.com/-/media/drhorton/productcatalog/3eab/allex_front.jpg");
  });
});

describe("what D.R. Horton's pages say besides their pictures", () => {
  it("reads the community's home type from its own description", () => {
    const lakes = `<h2>About our community</h2><p>Oakfield Lakes offers a variety of carefully crafted single-family home floorplans.</p><h2>Tour</h2>`;
    const ashcombe = `<h2>About our community</h2><p>Ashcombe brings a fresh take on modern townhome living.</p><h3>Schools</h3>`;
    expect(communityHomeType(lakes)).toBe("Single Family Home");
    expect(communityHomeType(ashcombe)).toBe("Townhome");
    expect(communityHomeType("<h1>Oakfield</h1>")).toBeNull();
    // Rye Crossing's description names no kind of home; its title does.
    expect(communityHomeType("<title>Houses For Sale in Parrish, FL | Rye Crossing | D.R. Horton</title><h1>Rye Crossing</h1>")).toBe("Single Family Home");
    expect(communityHomeType("<title>Townhomes For Sale in Venice, FL | Ashcombe</title>")).toBe("Townhome");
  });

  it("takes a picture titled Floor Plan but named for an elevation as a photo (Fletcher, 2026-09-23)", () => {
    const page = readDrhPage(`<div class="PropertyGallery-container">
      <img data-lazy="/-/media/x/e410/freeportii-elevation-a-2carfl-cs7.jpg?w=494" alt="Fletcher Floor Plan">
      <img data-lazy="/-/media/x/e410/fletcher-fp.jpg?w=494" alt="Floor Plan">
    </div><div class="mobile-carousel"></div>`);
    expect(page.gallery.map((g) => g.src)).toEqual(["https://www.drhorton.com/-/media/x/e410/freeportii-elevation-a-2carfl-cs7.jpg"]);
    expect(page.drawings).toEqual(["https://www.drhorton.com/-/media/x/e410/fletcher-fp.jpg"]);
  });

  it("takes the rooms of a plan that titles every picture Floor Plan as photos (Hawthorne, 2026-09-23)", () => {
    const page = readDrhPage(`<div class="PropertyGallery-container">
      <img data-lazy="/-/media/x/hawthorne_kitchen_web.jpg?w=494" alt="Floor Plan">
      <img data-lazy="/-/media/x/hawthorne_primary_bedroom_web.jpg?w=494" alt="Floor Plan">
      <img data-lazy="/-/media/x/hawthorne_first_floor.jpg?w=494" alt="Floor Plan">
      <img data-lazy="/-/media/x/hawthorne_bonus_room_floorplan.jpg?w=494" alt="Floor Plan">
    </div><div class="mobile-carousel"></div>`);
    expect(page.gallery).toEqual([
      { src: "https://www.drhorton.com/-/media/x/hawthorne_kitchen_web.jpg", caption: "" },
      { src: "https://www.drhorton.com/-/media/x/hawthorne_primary_bedroom_web.jpg", caption: "" },
    ]);
    expect(page.drawings).toEqual([
      "https://www.drhorton.com/-/media/x/hawthorne_first_floor.jpg",
      "https://www.drhorton.com/-/media/x/hawthorne_bonus_room_floorplan.jpg",
    ]);
  });

  it("takes a bonus room, an 'elev' and the next numbered photo titled Floor Plan as photos (Star Farms, Bella Lago, 2026-09-26)", () => {
    const page = readDrhPage(`<div class="PropertyGallery-container">
      <img data-lazy="/-/media/x/3emb/01.jpg?w=494" alt="Harper">
      <img data-lazy="/-/media/x/3emb/13.jpg?w=494" alt="Harper">
      <img data-lazy="/-/media/x/3emb/14.jpg?w=494" alt="Floor Plan">
      <img data-lazy="/-/media/x/2795/14-saddlestone-camden-bonus_room.jpg?w=494" alt="Floor Plan">
      <img data-lazy="/-/media/x/4eab/aria-c-siding-stone-gen3-elev_ind.jpg?w=494" alt="Floor Plan">
      <img data-lazy="/-/media/x/3emb/harper-fp.jpg?w=494" alt="Floor Plan">
    </div><div class="mobile-carousel"></div>`);
    expect(page.drawings).toEqual(["https://www.drhorton.com/-/media/x/3emb/harper-fp.jpg"]);
    expect(page.gallery.map((g) => g.src)).toEqual([
      "https://www.drhorton.com/-/media/x/3emb/01.jpg",
      "https://www.drhorton.com/-/media/x/3emb/13.jpg",
      "https://www.drhorton.com/-/media/x/2795/14-saddlestone-camden-bonus_room.jpg",
      "https://www.drhorton.com/-/media/x/3emb/14.jpg",
      "https://www.drhorton.com/-/media/x/4eab/aria-c-siding-stone-gen3-elev_ind.jpg",
    ]);
  });

  it("leaves out the sale's badge and leads with a home's front titled for its floor plan (Rye Crossing, Oakfield Lakes, 2026-10-09)", () => {
    const page = readDrhPage(`<div class="PropertyGallery-container">
      <img class="rte-badge" src="/-/media/files/rte/resources/rte_event-banner.svg?rev=c3f6" data-lazy="/-/media/files/rte/resources/rte_event-banner.svg?rev=c3f6">
      <img data-lazy="/-/media/x/0057-17926-wheat-stack-ct/rye_crossing_17926_wheat_stack_ct.jpg?w=494" alt="Alford floor plan exterior of a single-story single family home with a two car garage.">
      <img data-lazy="/-/media/x/0034-10632-hidden-banks-glen/oakfield_lakes_10632_hidden_banks_glen.jpg?w=494" alt="Robie floorplan two story single family home with two car garage">
      <img data-lazy="/-/media/x/0057-17926-wheat-stack-ct/01_entryway.jpg?w=494" alt="Entryway">
    </div><div class="mobile-carousel"></div>`);
    expect(page.drawings).toEqual([]);
    expect(page.gallery).toEqual([
      { src: "https://www.drhorton.com/-/media/x/0057-17926-wheat-stack-ct/rye_crossing_17926_wheat_stack_ct.jpg", caption: "Exterior" },
      { src: "https://www.drhorton.com/-/media/x/0034-10632-hidden-banks-glen/oakfield_lakes_10632_hidden_banks_glen.jpg", caption: "Exterior" },
      { src: "https://www.drhorton.com/-/media/x/0057-17926-wheat-stack-ct/01_entryway.jpg", caption: "Entryway" },
    ]);
  });
});

describe("homePageUrl (Oakfield Trails, 2026-10-06)", () => {
  const TRAILS = "https://www.drhorton.com/florida/manatee-sarasota/parrish/oakfield-trails";

  it("takes the page the community gives a home beneath it", () => {
    expect(homePageUrl({ Url: "/florida/manatee-sarasota/parrish/oakfield-trails/qmis/10641-fern-hollow-run", Address: "10641 Fern Hollow Run" }, TRAILS)).toBe(
      `${TRAILS}/qmis/10641-fern-hollow-run`
    );
  });

  it("does not take a page elsewhere on the site for the home's", () => {
    // The community page gave the Holden at 10641 Fern Hollow Run the Cali's page in South Carolina.
    expect(homePageUrl({ Url: "/south-carolina/columbia/gilbert/seases-pond/floor-plans/1774", Address: "10641 Fern Hollow Run" }, TRAILS)).toBe(
      `${TRAILS}/qmis/10641-fern-hollow-run`
    );
    expect(homePageUrl({ Url: "/florida/manatee-sarasota/parrish/oakfield-trails-50s/qmis/1-main-st", Address: "1 Main St" }, TRAILS)).toBe(`${TRAILS}/qmis/1-main-st`);
  });

  it("gives a home with no page the one D.R. Horton gives every home there", () => {
    expect(homePageUrl({ Address: "10649 Fern Hollow Run" }, `${TRAILS}/`)).toBe(`${TRAILS}/qmis/10649-fern-hollow-run`);
    expect(homePageUrl({ Address: "" }, TRAILS)).toBeNull();
  });
});
