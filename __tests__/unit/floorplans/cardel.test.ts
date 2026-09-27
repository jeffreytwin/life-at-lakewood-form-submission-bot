import { describe, expect, it } from "vitest";
import { cardelCommunityOf, homesIn, normalizeCardelHome, readLiteral, streetOf } from "@/lib/floorplans/extractors/cardel";

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
});
