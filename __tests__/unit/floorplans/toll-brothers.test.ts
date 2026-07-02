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
      path.resolve(__dirname, `../../../pipeline/slice/discovery/${name}.pruned.json`),
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
