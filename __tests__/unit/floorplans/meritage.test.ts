import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { communityPlans, normalizeMeritageHome, normalizeMeritagePlan, withPlanFactsFromHomes } from "@/lib/floorplans/extractors/meritage";

// Real Sitecore Discover response for Salt Meadows - Classic Series,
// captured in round-6 discovery (pruned: arrays capped, long strings
// truncated — enough to lock in the field mapping).
const dump = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../fixtures/floorplans/meritage-discover-response.pruned.json"
    ),
    "utf8"
  )
);

const grid = dump.data.widgets.find(
  (w: { rfk_id?: string }) => w.rfk_id === "rfkid_503"
);
const homes = grid.content.filter((c: unknown) => typeof c === "object");

describe("normalizeMeritageHome", () => {
  it("maps Discover home entities to QMI records named by address", () => {
    const plans = homes.map((h: Record<string, unknown>) => normalizeMeritageHome(h));
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p).not.toBeNull();
      expect(p!.planKey).toBeTruthy();
      expect(p!.quickMoveIn).toBe(true);
      expect(p!.raw?.relatedPlan).toBeTruthy();
    }
    const bluebell = plans.find((p: { raw?: { relatedPlan?: string } }) => p!.raw?.relatedPlan === "Bluebell")!;
    expect(bluebell.name).toBe("7734 Satterfield Ter");
    expect(bluebell.price).toBe(340000);
    expect(bluebell.priceDisplay).toBe("$340,000");
    expect(bluebell.beds).toBe("3");
    expect(bluebell.baths).toBe("2");
    expect(bluebell.sqft).toBe(1491);
  });

  it("keeps only real image URLs and separates the blueprint", () => {
    const plan = normalizeMeritageHome(homes[0])!;
    for (const u of plan.galleryImages) expect(u).toMatch(/^https?:\/\//);
    // interactive_floorplan_image goes to blueprints, not the gallery
    if (homes[0].interactive_floorplan_image) {
      expect(plan.blueprintImages).toContain(homes[0].interactive_floorplan_image);
    }
  });

  it("returns null for entities without a usable name", () => {
    expect(normalizeMeritageHome({})).toBeNull();
  });
});

// Oakfield Trails Premier Series' page as it answered (2026-10-06): its
// Next.js data carries the four plans its "See our thoughtfully designed
// floorplans" carousel shows, which Discover does not hold.
describe("Meritage's floor plans from a series page", () => {
  const PREMIER = "https://www.meritagehomes.com/state/fl/tampa/oakfield-trails-premier-series";
  const html = readFileSync(path.resolve(__dirname, "../../fixtures/floorplans/meritage-oakfield-premier.next-data.html"), "utf8");

  it("finds the plans in the page's data", () => {
    expect(communityPlans(html).map((p) => p.name)).toEqual(["Denali II", "Yellowstone", "Zion", "Acadia"]);
    expect(communityPlans("<html>no data</html>")).toEqual([]);
  });

  it("takes a plan's facts, its photos once each, its drawing and its tour", () => {
    const denali = normalizeMeritagePlan(communityPlans(html)[0], PREMIER)!;
    expect(denali).toMatchObject({ planKey: "denali-ii", name: "Denali II", quickMoveIn: false, beds: "3", baths: "2", sqft: 1269, price: null, sourceUrl: PREMIER });
    expect(new Set(denali.galleryImages).size).toBe(denali.galleryImages.length);
    expect(denali.galleryImages.length).toBeLessThan(9);
    expect(denali.blueprintImages).toHaveLength(1);
    expect(denali.virtualTourUrl).toBe("https://3dtours.elevatedplans.com/embed.html?key=Zd3Q3368");
  });

  it("gives a plan the garages of its homes, and leaves one without homes to be filled in", () => {
    const plans = communityPlans(html).map((p) => normalizeMeritagePlan(p, PREMIER)!);
    const home = (relatedPlan: string, garages: string) =>
      ({ ...normalizeMeritageHome({ address: `1 ${relatedPlan} Way`, floorplan_name: relatedPlan, garages: Number(garages) })!, garages: `${garages} car` });
    const out = withPlanFactsFromHomes([...plans, home("Denali II", "2"), home("Denali II", "2"), home("Acadia", "1")]);
    expect(out.find((p) => p.name === "Denali II")!.garages).toBe("2 car");
    expect(out.find((p) => p.name === "Acadia")!.garages).toBe("1 car");
    expect(out.find((p) => p.name === "Zion")!.garages).toBeNull();
  });
});
