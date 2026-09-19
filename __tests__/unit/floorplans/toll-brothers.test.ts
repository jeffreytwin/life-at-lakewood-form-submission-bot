import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { enrichPlanFromModelPage, hasShowcase, modelFromPlanPage, plansFromNextData } from "@/lib/floorplans/extractors/toll-brothers";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// The pruned discovery dumps are real __NEXT_DATA__ captures from the
// The Isles at Lakewood Ranch pages (arrays capped at 3 items, long strings
// truncated) — enough to lock in the parsing paths.
const dump = (name: string) =>
  JSON.parse(
    readFileSync(
      path.resolve(__dirname, `../../fixtures/floorplans/toll-${name}.pruned.json`),
      "utf8"
    )
  );

describe("plansFromNextData (Toll Brothers)", () => {
  it("extracts base models from a master community page", () => {
    const plans = plansFromNextData(dump("isles-main"));
    const bases = plans.filter((p) => !p.quickMoveIn);
    expect(bases.map((p) => p.planKey)).toContain("avery");
    expect(bases.map((p) => p.planKey)).toContain("carver");
    const avery = bases.find((p) => p.planKey === "avery")!;
    expect(avery.price).toBeGreaterThan(0);
    expect(avery.quickMoveIn).toBe(false);
  });

  it("harvests QMI inventory nested in communities[].homes.models[].qmis", () => {
    const plans = plansFromNextData(dump("isles-main"));
    const qmis = plans.filter((p) => p.quickMoveIn);
    expect(qmis.length).toBeGreaterThan(0);
    for (const q of qmis) {
      expect(q.planKey).toBeTruthy();
      expect(q.raw?.relatedPlan).toBeTruthy();
    }
    // QMIs are named by street address, like the Lennar extractor.
    expect(qmis.some((q) => /^\d/.test(q.name))).toBe(true);
  });

  it("extracts from a collection page (communityComponent, no masterCommunityComponent)", () => {
    const plans = plansFromNextData(dump("isles-captiva"));
    expect(plans.length).toBeGreaterThan(0);
    const qmis = plans.filter((p) => p.quickMoveIn);
    expect(qmis.length).toBeGreaterThan(0);
    // The nameless QMI-only model wrapper must not surface as a base plan.
    expect(plans.every((p) => p.planKey)).toBe(true);
  });

  it("never emits a base-plan row flagged as QMI from model shells", () => {
    const plans = plansFromNextData(dump("isles-main"));
    for (const p of plans.filter((x) => !x.quickMoveIn)) {
      expect(p.name).toBeTruthy();
    }
  });
});

// Jeff, 2026-09-19: the rest of the gallery (exterior designs, showcase
// photos) and the 3D walkthrough live in other parts of the page than the
// headshot, and the sites want the Matterport share link in the tour field.
describe("Toll Brothers media", () => {
  const plans = plansFromNextData(dump("isles-main"));
  const avery = plans.find((p) => p.planKey === "avery")!;
  const carver = plans.find((p) => p.planKey === "carver")!;

  it("turns a Matterport walkthrough into the share link the Lakewood rows already use, with its still", () => {
    expect(avery.virtualTourUrl).toBe("https://my.matterport.com/show/?m=HQYuPU2ve1n&qs=1&play=1");
    expect(avery.virtualTourImage).toMatch(/^https:\/\/cdn\.tollbrothers\.com\/.*matterports\/.*\.jpg$/);
  });

  it("keeps an InsideMaps walkthrough link as the builder gives it", () => {
    expect(carver.virtualTourUrl).toMatch(/^https:\/\/www\.insidemaps\.com\/app\/walkthrough-v2\/\?projectId=/);
  });

  it("leads with the headshot and trails with the other exterior designs, each named", () => {
    const [primary, ...rest] = avery.galleryImages;
    expect(primary).toMatch(/AVER_CRB_/);
    expect(rest).toHaveLength(2);
    expect(rest).not.toContain(primary);
    expect(avery.galleryMeta?.[primary]).toEqual({ caption: "Caribbean", room: "primary", kind: "primary" });
    expect(rest.map((u) => avery.galleryMeta?.[u]?.caption)).toEqual(["Antilles", "Island Colonial"]);
    expect(rest.every((u) => avery.galleryMeta?.[u]?.kind === "exterior")).toBe(true);
    // Drawings stay out of the photo gallery.
    expect(avery.blueprintImages).toEqual([expect.stringMatching(/floorplans-original\/.*\.svg$/)]);
  });

  it("carries the builder's description", () => {
    expect(avery.description).toMatch(/^Contemporary elegance\./);
  });
});

// Plan pages, captured 2026-09-19 (pipeline/slice/discover-toll-model.mjs):
// a quick move-in page carries its captioned showcase in __NEXT_DATA__; a
// base plan page carries the same model shape with gallery.mediaGroups
// empty, its showcase coming from elsewhere.
describe("Toll Brothers plan pages", () => {
  const qmiPage = dump("qmi-lori");
  const carverPage = dump("model-carver");
  const bare: NormalizedPlan = {
    planKey: "17547-palmiste-dr", name: "17547 Palmiste Dr", price: null, priceDisplay: null, beds: "", baths: "",
    sqft: null, garages: null, homeType: null, quickMoveIn: true, comingSoon: false, sourceUrl: null,
    galleryImages: [], blueprintImages: [], raw: { commPlanID: 286045 },
  };

  it("finds the model behind a plan page by its commPlanID, and nothing for a stranger", () => {
    expect(modelFromPlanPage(qmiPage, 286045)?.name).toBe("Lori Caribbean");
    expect(modelFromPlanPage(carverPage, 246162)?.name).toBe("Carver");
    expect(modelFromPlanPage(carverPage, 999999)).toBeNull();
  });

  it("merges a quick move-in's captioned showcase in room order, its video left out", () => {
    const enriched = enrichPlanFromModelPage(bare, qmiPage);
    const rooms = enriched.galleryImages.map((u) => enriched.galleryMeta?.[u]?.room);
    expect(rooms).toEqual(["primary", "kitchen", "living", "office", "bedroom", "bathroom", "exterior"]);
    expect(enriched.galleryImages[0]).toMatch(/OUTDOOR_LIVING/);
    expect(enriched.galleryMeta?.[enriched.galleryImages[1]]?.caption).toMatch(/^Gourmet kitchen/);
    expect(enriched.galleryImages.every((u) => /^https:\/\/cdn\.tollbrothers\.com\//.test(u))).toBe(true);
    expect(enriched.virtualTourUrl).toBe("https://www.insidemaps.com/app/walkthrough-v2/?projectId=SRFkE8Mz0P&env=production&disableCookie=true");
    expect(enriched.virtualTourImage).toMatch(/Lori-IslandColonial_1920\.jpg$/);
    expect(enriched.description).toMatch(/^The Lori home design/);
    expect(enriched.blueprintImages).toHaveLength(1);
  });

  it("gives a base plan its page's elevations, tour and description, and no photos it does not have", () => {
    const carver = plansFromNextData(dump("isles-main")).find((p) => p.planKey === "carver")!;
    const enriched = enrichPlanFromModelPage(carver, carverPage);
    const kinds = enriched.galleryImages.map((u) => enriched.galleryMeta?.[u]?.kind);
    expect(kinds).toEqual(["primary", "exterior", "exterior"]);
    expect(enriched.virtualTourUrl).toMatch(/insidemaps\.com/);
    expect(enriched.description).toMatch(/^Urban design and style\./);
  });

  it("leaves a plan alone when the page is not its own", () => {
    expect(enrichPlanFromModelPage(bare, carverPage)).toBe(bare);
  });
});

describe("hasShowcase", () => {
  it("is true only for a plan the community page already gave interior photos", () => {
    const plans = plansFromNextData(dump("isles-main"));
    const avery = plans.find((p) => p.planKey === "avery")!;
    expect(hasShowcase(avery)).toBe(false);
    const enriched = enrichPlanFromModelPage(
      { ...avery, planKey: "17547-palmiste-dr", name: "17547 Palmiste Dr", raw: { commPlanID: 286045 } },
      dump("qmi-lori")
    );
    expect(hasShowcase(enriched)).toBe(true);
  });
});

// Bianca Elite is The Isles' decorated model: the one base plan whose page
// carries a Media Showcase (the captions in Jeff's 2026-09-19 screenshot),
// four exterior designs, two drawings and a Matterport walkthrough.
describe("Toll Brothers decorated model page", () => {
  const page = dump("model-bianca-elite");
  const bare: NormalizedPlan = {
    planKey: "bianca-elite", name: "Bianca Elite", price: null, priceDisplay: null, beds: "", baths: "",
    sqft: null, garages: null, homeType: null, quickMoveIn: false, comingSoon: false, sourceUrl: null,
    galleryImages: [], blueprintImages: [], raw: { commPlanID: 269887 },
  };

  it("orders the showcase by room, keeps both drawings, and takes the Matterport share link", () => {
    const plan = enrichPlanFromModelPage(bare, page);
    const rooms = plan.galleryImages.map((u) => plan.galleryMeta?.[u]?.room);
    expect(rooms.slice(0, 9)).toEqual(["primary", "kitchen", "kitchen", "living", "dining", "outdoor", "bedroom", "bathroom", "closet"]);
    expect(rooms.slice(9).length).toBeGreaterThanOrEqual(3);
    expect(rooms.slice(9).every((r) => r === "exterior")).toBe(true);
    expect(plan.galleryMeta?.[plan.galleryImages[1]]?.caption).toBe("Gourmet kitchens designed for both style and function");
    expect(plan.blueprintImages).toHaveLength(2);
    expect(plan.virtualTourUrl).toBe("https://my.matterport.com/show/?m=KN8aBBQRFkX&qs=1&play=1");
    expect(plan.description).toBeTruthy();
    expect(hasShowcase(plan)).toBe(true);
  });
});
