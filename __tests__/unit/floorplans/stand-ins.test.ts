import { describe, it, expect } from "vitest";
import { homesOfPlan, standInPlan, withStandIns, type StandInRule } from "@/lib/floorplans/stand-ins";
import { linkQuickMoveIns } from "@/lib/floorplans/quick-move-ins";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const plan = (over: Partial<NormalizedPlan>): NormalizedPlan => ({
  planKey: "lori",
  name: "Lori",
  price: 1_000_000,
  priceDisplay: "$1,000,000",
  beds: "3",
  baths: "3",
  sqft: 2598,
  garages: "3 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages: [],
  blueprintImages: [],
  ...over,
});

const home = (over: Partial<NormalizedPlan>): NormalizedPlan =>
  plan({ quickMoveIn: true, relatedPlanKey: null, relatedPlanMatch: "unmatched", ...over });

const rule: StandInRule = { planKey: "kingsdale-elite", planName: "Kingsdale Elite", sourcePlanKey: "17645-palmiste-dr" };

const palmiste = home({
  planKey: "17645-palmiste-dr",
  name: "17645 Palmiste Dr",
  price: 1_293_000,
  priceDisplay: "$1,293,000",
  relatedPlanName: "Kingsdale Elite",
  sourceUrl: "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles/17645-Palmiste-Dr",
  galleryImages: ["https://img/p1.jpg"],
  blueprintImages: ["https://img/plan-a.svg"],
  description: "A home.",
  virtualTourUrl: "https://my.matterport.com/show/?m=abc",
  raw: { masterPlanID: 500, commPlanID: 9001 },
});
const other = home({
  planKey: "17800-palmiste-dr",
  name: "17800 Palmiste Dr",
  price: 1_199_000,
  priceDisplay: "$1,199,000",
  beds: "4",
  relatedPlanName: "Kingsdale Elite",
  galleryImages: ["https://img/q1.jpg", "https://img/q2.jpg", "https://img/q3.jpg"],
  blueprintImages: ["https://img/plan-a.svg", "https://img/plan-b.svg"],
  description: null,
  raw: { masterPlanID: 500, commPlanID: 9002 },
});

describe("homesOfPlan", () => {
  it("finds the quick move-ins named for the plan, and the one the rule was made from whatever it is named", () => {
    const unnamed = home({ planKey: "17645-palmiste-dr", name: "17645 Palmiste Dr", relatedPlanName: null });
    const stranger = home({ planKey: "1-elsewhere-ln", name: "1 Elsewhere Ln", relatedPlanName: "Bianca" });
    const base = plan({ planKey: "kingsdale-elite", name: "Kingsdale Elite" });
    expect(homesOfPlan(rule, [unnamed, other, stranger, base]).map((h) => h.name)).toEqual(["17645 Palmiste Dr", "17800 Palmiste Dr"]);
  });
});

describe("standInPlan", () => {
  it("builds the plan from the richest home's pictures and the cheapest home's price, drawings from every home", () => {
    const built = standInPlan(rule, [palmiste, other])!;
    expect(built.planKey).toBe("kingsdale-elite");
    expect(built.name).toBe("Kingsdale Elite");
    expect(built.quickMoveIn).toBe(false);
    expect(built.galleryImages).toEqual(other.galleryImages);
    expect(built.blueprintImages).toEqual(["https://img/plan-a.svg", "https://img/plan-b.svg"]);
    expect(built.price).toBe(1_199_000);
    expect(built.priceDisplay).toBe("$1,199,000");
    expect(built.beds).toBe("4");
    // Anything the richest home lacks comes from another home.
    expect(built.description).toBe("A home.");
    expect(built.virtualTourUrl).toBe("https://my.matterport.com/show/?m=abc");
    expect(built.sourceUrl).toBeNull();
    expect(built.hasQuickMoveIns).toBe(true);
    expect(built.score).toBeNull();
    expect(built.standInFor).toEqual(["17645 Palmiste Dr", "17800 Palmiste Dr"]);
    expect(built.relatedPlanName).toBeUndefined();
    expect(built.raw?.commPlanID).toBe(9002);
  });

  it("keeps the one home's page, so the plan can be read from it in full", () => {
    const built = standInPlan(rule, [palmiste])!;
    expect(built.sourceUrl).toBe(palmiste.sourceUrl);
    expect(built.raw?.commPlanID).toBe(9001);
    expect(built.price).toBe(1_293_000);
  });

  it("is nothing without a home", () => {
    expect(standInPlan(rule, [])).toBeNull();
  });
});

describe("withStandIns", () => {
  it("adds the plan when the builder does not list it and ties its homes to it", () => {
    const { plans, standIns } = withStandIns([plan({}), palmiste, other], [rule]);
    expect(standIns.map((p) => p.name)).toEqual(["Kingsdale Elite"]);
    const linked = linkQuickMoveIns(plans);
    const byKey = Object.fromEntries(linked.map((p) => [p.planKey, p]));
    expect(byKey["17645-palmiste-dr"].relatedPlanKey).toBe("kingsdale-elite");
    // The plan keeps its richest home's builder ids, so the homes link by plan id, as with a listed plan.
    expect(byKey["17645-palmiste-dr"].relatedPlanMatch).toBe("plan-id");
    expect(byKey["17800-palmiste-dr"].relatedPlanKey).toBe("kingsdale-elite");
    expect(byKey["kingsdale-elite"].hasQuickMoveIns).toBe(true);
  });

  it("names the source home for the plan when the engine gave it none, or another name", () => {
    const unnamed = home({ planKey: "17645-palmiste-dr", name: "17645 Palmiste Dr", relatedPlanName: null });
    const { plans } = withStandIns([unnamed], [rule]);
    const linked = linkQuickMoveIns(plans);
    expect(linked.find((p) => p.planKey === "17645-palmiste-dr")?.relatedPlanName).toBe("Kingsdale Elite");
    expect(linked.find((p) => p.planKey === "17645-palmiste-dr")?.relatedPlanMatch).toBe("plan-name");
    const renamed = home({ planKey: "17645-palmiste-dr", name: "17645 Palmiste Dr", relatedPlanName: "Kingsdale", raw: { relatedPlan: "Kingsdale" } });
    const again = linkQuickMoveIns(withStandIns([renamed], [rule]).plans);
    expect(again.find((p) => p.planKey === "17645-palmiste-dr")?.relatedPlanKey).toBe("kingsdale-elite");
    expect(again.find((p) => p.planKey === "17645-palmiste-dr")?.relatedPlanName).toBe("Kingsdale Elite");
  });

  it("does nothing when the builder lists the plan again, or when every home has sold", () => {
    const real = plan({ planKey: "kingsdale-elite", name: "Kingsdale Elite" });
    const listed = withStandIns([real, palmiste], [rule]);
    expect(listed.standIns).toEqual([]);
    expect(listed.plans).toHaveLength(2);
    const sold = withStandIns([plan({})], [rule]);
    expect(sold.standIns).toEqual([]);
    expect(sold.plans.map((p) => p.planKey)).toEqual(["lori"]);
    expect(withStandIns([plan({})], []).plans).toHaveLength(1);
  });
});
