import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { plansFromNextData } from "@/lib/floorplans/extractors/toll-brothers";

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
