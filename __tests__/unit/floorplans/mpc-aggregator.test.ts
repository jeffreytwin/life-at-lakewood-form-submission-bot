import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractMpcAggregator, folderOf, mpcHomeType, parseCards, normalizeCard, readDetailPage } from "@/lib/floorplans/extractors/mpc-aggregator";

// Real Wellen Park home-search cards (round mpc3 capture): a homes-by-towne
// move-in-ready (address in <h3>), a mattamy move-in-ready, and an M/I
// to-be-built plan (plan name in <h3>, "FROM $…" in <h4>).
const html = readFileSync(
  path.resolve(__dirname, "../../fixtures/floorplans/wellenpark-cards.html"),
  "utf8"
);
const cards = parseCards(html);

describe("MPC aggregator card parsing", () => {
  it("parses every property card with its data attributes", () => {
    expect(cards.length).toBe(3);
    const slugs = cards.map((c) => c.attrs["builder-name"]);
    expect(slugs).toContain("mi-homes");
    expect(slugs).toContain("homes-by-towne");
  });

  it("maps a move-in-ready card to an address-named QMI", () => {
    const card = cards.find((c) => c.attrs["builder-name"] === "homes-by-towne")!;
    const plan = normalizeCard(card)!;
    expect(plan.quickMoveIn).toBe(true);
    expect(plan.name).toBe("18045 Foxtail Loop");
    expect(plan.price).toBe(1269900);
    expect(plan.priceDisplay).toBe("$1,269,900");
    expect(plan.beds).toBe("3");
    expect(plan.baths).toBe("3");
    expect(plan.sqft).toBe(2867);
    expect(plan.raw?.neighborhood).toBe("palmera");
    expect(plan.galleryImages[0]).toMatch(/^https:\/\/static\.wellenpark\.com\//);
    expect(plan.sourceUrl).toContain("/home/");
  });

  it("maps a to-be-built card to a base plan named by the plan", () => {
    const card = cards.find((c) => c.attrs["builder-name"] === "mi-homes")!;
    const plan = normalizeCard(card)!;
    expect(plan.quickMoveIn).toBe(false);
    expect(plan.name).toBe("Reflection");
    expect(plan.price).toBe(859990); // parsed out of "FROM $859,990"
    expect(plan.raw?.relatedPlan).toBe("Reflection");
    expect(plan.raw?.builderSlug).toBe("mi-homes");
  });
});

describe("a home's own page on the aggregator (wellenpark.com/home/…/detail)", () => {
  const img = (id: string, ext = "jpg") => `https://static.wellenpark.com/Images/Homes/ICIHo8875/${id}.${ext}`;
  const page = `
    <header><img src="https://wellenpark.com/wp-content/uploads/2020/05/grand-palm.jpg"></header>
    <h1>Ava</h1>
    <div class="slider"><img src="${img("110705387-260712")}"><img src="${img("82500852-240815")}"><img src="${img("81829164-240729")}"><img src="${img("110705387-260712")}"></div>
    <div class="plans"><img src="${img("82501101-250820", "svg")}"></div>
    <a href="https://my.matterport.com/show/?m=bNgGWuY3fsk">INTERACTIVE PLAN</a>
    <h2>More Homes in Palmera Wellen Park - ICI Homes</h2>
    <img src="${img("82501074-240815")}">
    <img src="https://static.wellenpark.com/Images/Homes/NealC9425/max1500_31891545-190122.jpg">`;

  it("takes the home's photos once each, its drawing apart, and its tour — and nothing of the homes after it", () => {
    const read = readDetailPage(page);
    expect(read.photos).toEqual([img("110705387-260712"), img("82500852-240815"), img("81829164-240729")]);
    expect(read.drawings).toEqual([img("82501101-250820", "svg")]);
    expect(read.tour).toBe("https://my.matterport.com/show/?m=bNgGWuY3fsk");
  });
});

describe("a Wellen Park home's page names its type and describes it (M/I's Palm, 2026-09-23)", () => {
  const page = `<nav>…</nav><main class="container content-main home-details-content">
    <header class="row between home-details-header bottom">
      <div class="col-36-21 no-pad-left no-pad-right">
        <p>Multi-Family</p>
        <q class="mobile">FROM $472,990</q>
        <h1>Palm</h1>
        <ul><li>3 BED</li><li>2 BATH</li><li>2,425 SQFT</li></ul>
      </div>
    </header>
    <div class="content">
      <p><strong>Description</strong><br> Introducing the Palm by M/I Homes! This 2-story floorplan features 3 bedrooms, a loft &amp; 2.5 bathrooms.</p>
      <p><strong>Amenities</strong><br> Playground, Park</p>
    </div>
    <h2>More Homes in Palmera At Wellen Park</h2>`;

  it("reads a Multi-Family home as the townhome the site files it as, and keeps the description", () => {
    const read = readDetailPage(page);
    expect(read.homeType).toBe("Townhome");
    expect(read.description).toBe("Introducing the Palm by M/I Homes! This 2-story floorplan features 3 bedrooms, a loft & 2.5 bathrooms.");
  });

  it("reads the same word on a card", () => {
    expect(mpcHomeType("multi-family")).toBe("Townhome");
    expect(mpcHomeType("single-family")).toBe("Single Family Home");
    expect(mpcHomeType(null)).toBeNull();
  });
});

describe("folderOf", () => {
  it("reads the builder's folder a listing picture sits in", () => {
    expect(folderOf("https://static.wellenpark.com/Images/Homes/NealC9425/82211950-240808.jpg")).toBe("nealc9425");
    expect(folderOf("https://static.wellenpark.com/Images/Homes/MattamyCorp/99831138-251007.jpg")).toBe("mattamycorp");
    expect(folderOf("https://example.com/other.jpg")).toBeNull();
  });
});

describe("sister plans keep the pictures they share (M/I's Foxtail and Foxtail II, 2026-09-24)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const mi = (n: number) => `https://static.wellenpark.com/Images/Homes/MIHomes/${n}-260803.jpg`;
  const card = (id: number, name: string) => `
    <article data-comp="property" data-builder-name="mi-homes" data-neighborhood="palmera" data-type="multi-family"
      data-beds="3" data-baths="2" data-sqft="1706" data-availability="">
      <a href="https://wellenpark.com/home/${id}/detail/" class="box"><figure class="img-box"><img src="${mi(111508119)}"></figure>
      <div class="content"><h3>${name}</h3><h4>FROM $373,990</h4></div></a>
    </article>`;
  const page = (name: string, pictures: number[]) =>
    `<h1>${name}</h1>${pictures.map((n) => `<figure class="img-box"><img src="${mi(n)}"></figure>`).join("")}<h2>More Homes in Palmera At Wellen Park</h2>`;
  const pages: Record<string, string> = {
    "https://wellenpark.com/available-homes/": card(3072060, "Foxtail") + card(3392086, "Foxtail II"),
    "https://wellenpark.com/home/3072060/detail/": page("Foxtail", [111508119, 111508702, 111508714]),
    "https://wellenpark.com/home/3392086/detail/": page("Foxtail II", [111508119, 111508702, 111508714, 111508702]),
  };

  it("keeps every picture each page shows, once within each plan", async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response(pages[url] ?? "", { status: pages[url] ? 200 : 404 }));
    const plans = await extractMpcAggregator({ builderName: "M/I Homes", neighborhood: "palmera", url: "https://wellenpark.com/available-homes/" });
    const gallery = (name: string) => plans.find((p) => p.name === name)?.galleryImages;
    expect(gallery("Foxtail")).toEqual([111508119, 111508702, 111508714].map(mi));
    expect(gallery("Foxtail II")).toEqual([111508119, 111508702, 111508714].map(mi));
  });
});
