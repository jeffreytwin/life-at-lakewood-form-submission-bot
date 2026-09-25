import { describe, expect, it } from "vitest";
import { normalizeCard, parseCards, parseHotelCards, readSitePlanPage } from "@/lib/floorplans/extractors/mpc-aggregator";

// Lakewood Ranch's home finder, Lee Wetherington only (build[]=34708), as served 2026-09-25.
const hotel = (name: string, price: string, village: string, picture: string, slug: string, baths = "3", sf = "2,380") => `
  <div class="hotel ">
    <div class="hotel-photo relative" style="background-image:url(${picture});">
      <img decoding="async" src="/wp-content/themes/bvk-theme/img/hotel-ph.jpg" class="no-vis fill"/>
      <a class="full-link" href="https://lakewoodranch.com/homes/${slug}/"></a>
      <div class="bedbathoverlay">
        <li class="bed den">
          3 Bed + Den //
        </li><!--
        -->
        <li class="bath">
          ${baths}                                            Bath //
        </li>
        <li class="garages">3 Car // </li>                                        <li class="sf">${sf} SF</li>
      </div><!--/bedbathoverlay-->
    </div>
    <p class="subhead mb-10"><em>\t\t\tCustom\t\t\t, \t\t\tSingle-Family Home</em></p>
    <h4 class="coral bold no-btm">${name}</h4>
    <h4 class="dark-grey mb-10">${price}</h4>
    <p class="no-btm"><strong>Village: </strong>${village}</p>
    <p><strong>Builder: </strong>Lee Wetherington Homes</p>
  </div>`;
const finder = `<div class="flex-grid hotels home-finder">
  ${hotel("Azure", "Homes From $1,368,000", "Waterside &#8211; Wild Blue", "https://lakewoodranch.com/wp-content/uploads/2023/09/WildBlue_WellenPark_Azure-Transitional.jpg", "azure")}
  ${hotel("Cyan", "Homes From $1,486,000", "Waterside &#8211; Wild Blue", "https://lakewoodranch.com/wp-content/uploads/2023/09/Wildblue_WellenPark_Cyan_West_Indies-A.jpg", "cyan", "3.5", "2,727")}
</div><footer></footer>`;

describe("Lee Wetherington from Lakewood Ranch's home finder (Jeff, 2026-09-25)", () => {
  it("reads each card: the plan, its price and facts, its picture, village and builder", () => {
    const cards = parseHotelCards(finder, "https://lakewoodranch.com");
    expect(cards.map((c) => c.plan.name)).toEqual(["Azure", "Cyan"]);
    expect(cards[0].village).toBe("Waterside – Wild Blue");
    expect(cards[0].builder).toBe("Lee Wetherington Homes");
    expect(cards[1].plan).toMatchObject({
      planKey: "cyan",
      price: 1486000,
      priceDisplay: "$1,486,000",
      beds: "3",
      baths: "3.5",
      sqft: 2727,
      garages: "3 car",
      homeType: "Single Family Home",
      quickMoveIn: false,
      sourceUrl: "https://lakewoodranch.com/homes/cyan/",
      galleryImages: ["https://lakewoodranch.com/wp-content/uploads/2023/09/Wildblue_WellenPark_Cyan_West_Indies-A.jpg"],
    });
  });

  it("reads a card named for its address as a home for sale", () => {
    const [home] = parseHotelCards(hotel("800 Blue Shell Loop", "$1,599,000", "Waterside &#8211; Shellstone", "https://lakewoodranch.com/wp-content/uploads/x.jpg", "800-blue-shell-loop"), "https://lakewoodranch.com");
    expect(home.plan.quickMoveIn).toBe(true);
  });
});

describe("Lee Wetherington from Wellen Park's builder page (Jeff, 2026-09-25)", () => {
  // wellenpark.com/builder/lee-wheterington-homes/: the builder is data-builder, not data-builder-name.
  const card = `<article class="col-36-12 homes-item fadeUp" data-comp="property"
      data-home_id="2987870"
      data-neighborhood="everly"
      data-builder="lee-wetherington-homes"
      data-garage="3"
      data-price="1348"
      data-type="single-family" data-beds="3"
      data-sqft="3480"
      data-availability=""
      data-baths="4" data-stories="1"
      data-is55="false">
      <a href="https://wellenpark.com/home/2987870/detail/" class="box">
        <figure class="img-box"><img src="https://static.wellenpark.com/Images/Homes/LeeWe88873/80300980-240610.jpeg" alt=""></figure>
        <div class="content"><p>Single Family</p><h3>Solstice II</h3><h4>FROM $1,348,000 </h4><p>Everly at Wellen Park</p></div>
      </a></article>`;

  it("knows the builder by data-builder too", () => {
    const [parsed] = parseCards(card);
    const plan = normalizeCard(parsed)!;
    expect(plan).toMatchObject({ name: "Solstice II", price: 1348000, beds: "3", baths: "4", sqft: 3480, garages: "3 car" });
    expect(plan.raw?.builderSlug).toBe("lee-wetherington-homes");
    expect(plan.sourceUrl).toBe("https://wellenpark.com/home/2987870/detail/");
  });
});

describe("a plan's page on Lakewood Ranch's site", () => {
  it("takes its photos, not WordPress's smaller copies, the site's icons or a brochure's pages", () => {
    const up = "https://lakewoodranch.com/wp-content/uploads";
    const page = `<link rel="apple-touch-icon" href="${up}/2023/10/apple-touch-icon-brown.png">
      <img src="${up}/2026/04/LWR_HORIZONTAL_FLA_RED-lg-1024x170.png">
      <a href="${up}/2025/06/sand-dollar-custom-built-home-foyer-study-001.jpg"><img src="${up}/2025/06/sand-dollar-custom-built-home-foyer-study-001-300x200.jpg"></a>
      <a href="${up}/2025/06/LWH-24103-Sand-Dollar-4-pager-FIN-FOR-WEB-1.jpg"></a>
      <iframe src="https://my.matterport.com/show/?m=bxTr9izXr4F"></iframe>
      <footer><img src="${up}/2024/01/footer-promo.jpg"></footer>`;
    const read = readSitePlanPage(page);
    expect(read.photos).toEqual([`${up}/2025/06/sand-dollar-custom-built-home-foyer-study-001.jpg`]);
    expect(read.tour).toBe("https://my.matterport.com/show/?m=bxTr9izXr4F");
  });
});
