import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { galleryFromScData, homeTypeOf, plansFromScData, tourUrl } from "@/lib/floorplans/extractors/taylor-morrison";
import { orderGallery } from "@/lib/floorplans/gallery-order";

// Real scDataStore.data dumps from the Firethorn community pages
// (round-7 discovery; pruned — arrays capped, long strings truncated).
const dump = (name: string) =>
  JSON.parse(
    readFileSync(
      path.resolve(__dirname, `../../fixtures/floorplans/${name}`),
      "utf8"
    )
  );

const ORIGIN = "https://www.taylormorrison.com";

describe("plansFromScData (Taylor Morrison)", () => {
  it("maps floorPlansListDataArray to base plans with series names", () => {
    const plans = plansFromScData(dump("taylor-floor-plans.scdata.pruned.json"), ORIGIN);
    const bases = plans.filter((p) => !p.quickMoveIn);
    expect(bases.length).toBeGreaterThan(0);
    const finch = bases.find((p) => p.planKey === "finch")!;
    expect(finch.price).toBe(309999);
    expect(finch.priceDisplay).toBe("$309,999");
    expect(finch.beds).toBe("3");
    expect(finch.baths).toBe("2");
    expect(finch.sqft).toBe(1476);
    expect(finch.garages).toBe("2 car");
    expect(finch.sourceUrl).toBe(`${ORIGIN}/fl/tampa/parrish/firethorn/floor-plans/finch`);
    expect(finch.raw?.series).toBe("50' Journey Series");
    expect(finch.galleryImages[0]).toMatch(/^https:\/\/www\.taylormorrison\.com\/-\/media\//);
    expect(finch.homeType).toBe("Single Family Home");
    expect(finch.description).toMatch(/^Finch is a thoughtfully designed single-story home/);
  });

  it("takes each plan's virtual tour link from the listing, in the form the sites use", () => {
    const plans = plansFromScData(dump("taylor-floor-plans.scdata.pruned.json"), ORIGIN);
    const byKey = new Map(plans.map((p) => [p.planKey, p]));
    expect(byKey.get("saint-vincent")?.virtualTourUrl).toBe("https://my.matterport.com/show/?m=QoXA7UeGcsG");
    expect(byKey.get("eagle")?.virtualTourUrl).toBe("https://my.matterport.com/show/?m=hQDfH6fSk8s");
    expect(byKey.get("finch")?.virtualTourUrl).toBeNull();
    expect(tourUrl("  ")).toBeNull();
    expect(tourUrl("javascript:void(0)")).toBeNull();
    expect(tourUrl("https://example.com/tour")).toBe("https://example.com/tour");
  });

  it("files plans by their collection: twin villas are attached villas, towns are townhomes, the rest single-family", () => {
    expect(homeTypeOf("Twin Villa Collection", "Esplanade at Azario Lakewood Ranch")).toBe("Attached Villa");
    expect(homeTypeOf("Detached Villa Golf Collection", "Esplanade at Azario Lakewood Ranch")).toBe("Single Family Home");
    expect(homeTypeOf("62' Golf Collection", "Esplanade at Azario Lakewood Ranch")).toBe("Single Family Home");
    expect(homeTypeOf("16' Collection", "The Towns at Firethorn")).toBe("Townhome");
    expect(homeTypeOf("Signature Collection", "Esplanade at Azario Lakewood Ranch")).toBe("Single Family Home");
    expect(homeTypeOf("50' Journey Series", "Firethorn")).toBe("Single Family Home");
    expect(homeTypeOf(null, "The Towns at Firethorn")).toBe("Townhome");
    expect(homeTypeOf(null, "The Townhomes at Azario")).toBe("Townhome");
    expect(homeTypeOf(null, null)).toBe("Single Family Home");
  });

  it("maps availableHomesList homes to address-named QMIs", () => {
    const plans = plansFromScData(dump("taylor-available-homes.scdata.pruned.json"), ORIGIN);
    const qmis = plans.filter((p) => p.quickMoveIn);
    expect(qmis.length).toBeGreaterThan(0);
    const camelot = qmis.find((p) => p.name === "13509 Camelot Court")!;
    expect(camelot.price).toBe(331929);
    expect(camelot.beds).toBe("3");
    expect(camelot.sqft).toBe(1603);
    expect(camelot.raw?.relatedPlan).toBe("spruce");
    expect(camelot.raw?.relatedPlanName).toBe("Spruce");
    expect(camelot.homeType).toBe("Single Family Home");
    expect(camelot.sourceUrl).toContain("/home-available-now-at-13509-camelot-court");
  });

  it("skips truncation markers and nameless entries", () => {
    const plans = plansFromScData(dump("taylor-floor-plans.scdata.pruned.json"), ORIGIN);
    for (const p of plans) expect(p.planKey).toBeTruthy();
  });
});

// The Roma gallery page at Esplanade at Azario, as its data stood on
// 2026-09-21: five categories, of which "Design Collections" is left out.
describe("galleryFromScData (Taylor Morrison)", () => {
  const gallery = galleryFromScData(dump("taylor-roma-gallery.scdata.json"), ORIGIN)!;

  it("finds the gallery entry among the page's others", () => {
    expect(gallery).not.toBeNull();
    expect(galleryFromScData({ model1: { navLinks: [] }, model_endpoints: {} }, ORIGIN)).toBeNull();
  });

  it("takes the interiors and exteriors, never the design collections", () => {
    const srcs = gallery.photos.map((p) => p.src);
    expect(srcs).toHaveLength(6);
    expect(srcs.some((s) => /5bb140ca|8f4950e5/.test(s))).toBe(false);
    expect(gallery.photos.filter((p) => p.kind === "exterior").map((p) => p.caption)).toEqual(["Coastal Exterior A", "Mediterranean Exterior A"]);
    // A caption that is only the file's name is no caption.
    expect(gallery.photos.filter((p) => p.kind === "photo").every((p) => p.caption === null)).toBe(true);
  });

  it("prefers the largest rendition offered and makes every picture absolute", () => {
    expect(gallery.photos[0].src).toBe(`${ORIGIN}/-/media/sites/tm/homes/florida/sarasota/master-plans/r/roma/interior/esplanade-at-azario/esp-at-azario-lwr-roma-7750-16x9.jpg?mw=1800&hash=C7750`);
    expect(gallery.photos[1].src).toBe(`${ORIGIN}/-/media/sites/tm/homes/florida/sarasota/master-plans/r/roma/interior/esplanade-at-azario/esp-at-azario-lwr-roma-8063-16x9.jpg?mw=900&hash=A8063`);
    for (const src of [...gallery.photos.map((p) => p.src), ...gallery.blueprints]) expect(src).toMatch(/^https:\/\//);
  });

  it("files the Floor Plan pictures as drawings and the Virtual Tour entry as the tour", () => {
    expect(gallery.blueprints).toHaveLength(2);
    expect(gallery.blueprints[0]).toContain("Roma-FirstFloor");
    expect(gallery.tour).toBe("https://my.matterport.com/show/?m=HQbhXvSWEWt");
  });

  it("orders for the sites with the exteriors last", () => {
    const ordered = orderGallery(gallery.photos);
    expect(ordered.urls).toHaveLength(6);
    expect(ordered.urls.slice(-2).every((u) => /ROMACOAA|ROMAMEDA/.test(u))).toBe(true);
    expect(ordered.meta[ordered.urls[5]].kind).toBe("exterior");
  });
});
