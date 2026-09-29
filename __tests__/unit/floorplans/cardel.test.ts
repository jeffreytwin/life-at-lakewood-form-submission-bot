import { describe, expect, it } from "vitest";
import { cardelCommunityOf, cardelHomeType, elevationPictures, homesIn, normalizeCardelHome, readLiteral, streetOf, withElevations } from "@/lib/floorplans/extractors/cardel";

// The quick move-ins page's data as Cardel's page carried it (2026-09-27), cut down.
const page = `<script>kit.start(app, element, { node_ids: [0, 18], data: [{type:"data",data:{user:null}},{type:"data",data:{homes:{
"coasterra":[{address:"2945 Stewart Creek Circle",community:"coasterra",pricing:{current:461990,previous:577685},status:"available"}],
"north-river-ranch":[{flavorText:{text:"",foreground:"#ffffff",background:"#2e5d8e"},address:"10709 Wading River Ave Parrish, FL 34219 - Lot 17",bedroomsBasement:null,availability:"Move-in ready",community:"north-river-ranch",bathrooms:2.5,bedrooms:3,squareFootage:2104,name:"Sylvan Paired Home",poster:{src:{thumbnail:"https://firebasestorage.googleapis.com/x_200x200.webp",sm:"https://firebasestorage.googleapis.com/x_640x640.webp","2xl":"https://firebasestorage.googleapis.com/x_1536x1536.webp"},alt:"Sylvan"},slug:"sylvan-paired-10709-wading-river-ave-parrish-fl",gallery:[{image:{alt:"Front",paths:{thumbnail:"public/galleries/7-web_200x200.webp","2xl":"public/galleries/7-web_1536x1536.webp"}}},{image:{src:{sm:"https://firebasestorage.googleapis.com/k_640x640.webp",xl:"https://firebasestorage.googleapis.com/k_1280x1280.webp"}}}],pricing:{current:389990,previous:436490,infoString:"",text:""},status:"available",extraInfo:"\\u003Cp>Ready\\u003C/p>",id:"H0pta8QudHkwtGLf6Efp"},
{address:"10705 Wading River Ave",name:"Sylvan Paired Home",pricing:{current:null},status:"sold",slug:"sylvan-10705"},
{address:"10721 Wading River Ave Parrish, FL ",availability:"Ready in 2026",bathrooms:2.5,bedrooms:3,squareFootage:2302,name:"Timberland Paired ",slug:"timberland-paired-10721-wading-river-ave-parrish-fl",gallery:[],pricing:{current:457390},status:"available",when:new Date(1790000000000),ref:a}]
}}}] });</script>`;

describe("Cardel's homes for sale from its quick move-ins page (North River Ranch, Jeff 2026-09-27)", () => {
  it("reads a script's object literal", () => {
    const text = `{a:1,"b-c":[true,false,null,void 0,-2.5],d:"x\\"y\\u003Cz",e:{f:ref},g:new Date(5)}`;
    expect(readLiteral(text, 0).value).toEqual({ a: 1, "b-c": [true, false, null, null, -2.5], d: 'x"y<z', e: { f: null }, g: null });
  });

  it("finds one community's homes and no other's", () => {
    const homes = homesIn(page, "north-river-ranch");
    expect(homes.map((h) => h.address)).toEqual([
      "10709 Wading River Ave Parrish, FL 34219 - Lot 17",
      "10705 Wading River Ave",
      "10721 Wading River Ave Parrish, FL ",
    ]);
    expect(homesIn(page, "fieldstone")).toEqual([]);
  });

  it("names a home by its street address alone", () => {
    expect(streetOf("10709 Wading River Ave Parrish, FL 34219 - Lot 17")).toBe("10709 Wading River Ave");
    expect(streetOf("17017 Wading River Ave. Parrish, FL 34219 - Lot 15")).toBe("17017 Wading River Ave");
    expect(streetOf("11830 Richmond Trl, Parrish, FL")).toBe("11830 Richmond Trl");
  });

  it("makes a quick move-in of each home still for sale, with its plan, page and pictures", () => {
    const homes = homesIn(page, "north-river-ranch").map((h) => normalizeCardelHome(h, "florida", "north-river-ranch"));
    expect(homes[1]).toBeNull();
    expect(homes[0]).toMatchObject({
      planKey: "10709-wading-river-ave",
      name: "10709 Wading River Ave",
      price: 389990,
      priceDisplay: "$389,990",
      beds: "3",
      baths: "2.5",
      sqft: 2104,
      quickMoveIn: true,
      relatedPlanName: "Sylvan Paired",
      sourceUrl: "https://www1.cardelhomes.com/florida/north-river-ranch/quick-move-ins/sylvan-paired-10709-wading-river-ave-parrish-fl",
      galleryImages: [
        "https://firebasestorage.googleapis.com/x_1536x1536.webp",
        "https://storage.googleapis.com/cardel-website.appspot.com/public/galleries/7-web_1536x1536.webp",
        "https://firebasestorage.googleapis.com/k_1280x1280.webp",
      ],
    });
    expect(homes[2]).toMatchObject({ name: "10721 Wading River Ave", relatedPlanName: "Timberland Paired", price: 457390 });
  });

  it("reads the community from the connection's page", () => {
    expect(cardelCommunityOf("https://www1.cardelhomes.com/florida/north-river-ranch/homes")).toEqual({ region: "florida", community: "north-river-ranch" });
    expect(cardelCommunityOf("https://example.com/")).toBeNull();
  });

  it("gives a plan its home type from its name: the paired plans are villas", () => {
    const plan = normalizeCardelHome({ address: "1 Test Ave", status: "available" }, "florida", "north-river-ranch")!;
    const asPlan = (name: string) => ({ ...plan, quickMoveIn: false, name, homeType: null });
    expect(cardelHomeType(asPlan("Birchwood Paired")).homeType).toBe("Attached Villa");
    expect(cardelHomeType(asPlan("Brighton")).homeType).toBe("Single Family Home");
    expect(cardelHomeType(asPlan("Northwood Rf")).homeType).toBe("Single Family Home");
    expect(cardelHomeType({ ...asPlan("Brighton"), homeType: "Townhome" }).homeType).toBe("Townhome");
    expect(cardelHomeType(plan).homeType).toBeNull();
  });
});

describe("a plan's elevations page (Birchwood Paired, Jeff 2026-09-28)", () => {
  const fb = (file: string) => `https://firebasestorage.googleapis.com/v0/b/cardel-website.appspot.com/o/public%2Fposters%2F${file}?alt=media&amp;token=t`;
  const page = `
    <img src="${fb("birchwood-a-southern-prairie-nrr-villa-poster-1_640x640.webp")}" srcset="${fb("birchwood-a-southern-prairie-nrr-villa-poster-1_1536x1536.webp")} 1536w">
    <img src="${fb("birchwood-b-coastal-nrr-villa-poster-2_640x640.webp")}">
    <img src="https://www1.cardelhomes.com/logo.svg">
    <script>const data = {elevations:[{name:"Modern Farmhouse - C",image:{paths:{sm:"public/elevations/birchwood-c-modern-farmhouse-nrr-villa-3_640x640.webp","2xl":"public/elevations/birchwood-c-modern-farmhouse-nrr-villa-3_1536x1536.webp"}}}],
      related:[{poster:{paths:{sm:"public/posters/sylvan-a-southern-prairie-nrr-villa-poster_640x640.webp"}}}]}</script>`;

  it("takes each elevation once, at its largest, and nothing of another plan's or the site's", () => {
    expect(elevationPictures(page, "Birchwood Paired")).toEqual([
      "https://firebasestorage.googleapis.com/v0/b/cardel-website.appspot.com/o/public%2Fposters%2Fbirchwood-a-southern-prairie-nrr-villa-poster-1_1536x1536.webp?alt=media&token=t",
      "https://firebasestorage.googleapis.com/v0/b/cardel-website.appspot.com/o/public%2Fposters%2Fbirchwood-b-coastal-nrr-villa-poster-2_640x640.webp?alt=media&token=t",
      "https://storage.googleapis.com/cardel-website.appspot.com/public/elevations/birchwood-c-modern-farmhouse-nrr-villa-3_1536x1536.webp",
    ]);
  });

  it("adds them after the plan's own picture, which a larger copy replaces in place", async () => {
    const plan = cardelHomeType({
      planKey: "birchwood-paired",
      name: "Birchwood Paired",
      price: 429990,
      priceDisplay: "$429,990",
      beds: "3",
      baths: "2.5",
      sqft: 1920,
      garages: null,
      homeType: null,
      quickMoveIn: false,
      comingSoon: false,
      sourceUrl: "https://www1.cardelhomes.com/florida/north-river-ranch/homes/birchwood-paired",
      galleryImages: ["https://storage.googleapis.com/cardel-website.appspot.com/public/elevations/birchwood-c-modern-farmhouse-nrr-villa-3_640x640.webp"],
      blueprintImages: [],
    });
    const asked: string[] = [];
    const got = await withElevations(plan, async (url) => {
      asked.push(url);
      return page;
    });
    expect(asked).toEqual(["https://www1.cardelhomes.com/florida/north-river-ranch/homes/birchwood-paired/elevations"]);
    expect(got.galleryImages).toHaveLength(3);
    expect(got.galleryImages[0]).toBe("https://storage.googleapis.com/cardel-website.appspot.com/public/elevations/birchwood-c-modern-farmhouse-nrr-villa-3_1536x1536.webp");
  });

  it("takes a paired villa's elevations, whose names put the villas first (Timberland Paired Villa, 2026-09-29)", () => {
    const fbe = (file: string) => `https://firebasestorage.googleapis.com/v0/b/cardel-website.appspot.com/o/public%2Felevations%2F${file}?alt=media&amp;token=t`;
    const villa = `
      <img src="${fb("timberland-b-coastal-nrr-villa-poster-1a045bbe_640x640.webp")}">
      <img src="${fbe("nrr-villa-timberland-a-craftsman-44d838cd_640x640.webp")}" srcset="${fbe("nrr-villa-timberland-a-craftsman-44d838cd_1536x1536.webp")} 1536w">
      <script>const data = {elevations:[{image:{paths:{"2xl":"public/elevations/nrr-villa-timberland-b-coastal-0e8104b6_1536x1536.webp"}}},
        {image:{paths:{"2xl":"public/elevations/nrr-villa-timberland-c-modern-farmhouse-bc6cf421_1536x1536.webp"}}}],
        related:[{poster:{paths:{sm:"public/elevations/nrr-villa-sylvan-a-southern-prairie-2370ee99_640x640.webp"}}}]}</script>`;
    expect(elevationPictures(villa, "Timberland Paired Villa").map((u) => decodeURIComponent(u).replace(/^.*\//, "").replace(/\?.*$/, ""))).toEqual([
      "timberland-b-coastal-nrr-villa-poster-1a045bbe_640x640.webp",
      "nrr-villa-timberland-a-craftsman-44d838cd_1536x1536.webp",
      "nrr-villa-timberland-b-coastal-0e8104b6_1536x1536.webp",
      "nrr-villa-timberland-c-modern-farmhouse-bc6cf421_1536x1536.webp",
    ]);
  });

  it("does not take a plan whose name only begins with this one's", () => {
    const page = `<script>const d = {a:"public/elevations/nrr-villa-timberlandia-a-craftsman_640x640.webp"}</script>`;
    expect(elevationPictures(page, "Timberland Paired Villa")).toEqual([]);
  });

  it("leaves a plan as it was when its elevations page will not load", async () => {
    const plan = { ...cardelHomeType({ planKey: "x", name: "Windsor", price: null, priceDisplay: null, beds: "", baths: "", sqft: null, garages: null, homeType: null, quickMoveIn: false, comingSoon: false, sourceUrl: "https://www1.cardelhomes.com/florida/north-river-ranch/homes/windsor", galleryImages: ["a.webp"], blueprintImages: [] }) };
    expect(await withElevations(plan, async () => { throw new Error("fetch: 404"); })).toBe(plan);
  });
});
