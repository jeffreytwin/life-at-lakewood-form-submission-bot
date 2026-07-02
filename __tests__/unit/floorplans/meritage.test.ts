import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeMeritageHome } from "@/lib/floorplans/extractors/meritage";

// Real Sitecore Discover response for Salt Meadows - Classic Series,
// captured in round-6 discovery (pruned: arrays capped, long strings
// truncated — enough to lock in the field mapping).
const dump = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../../pipeline/slice/discovery/round6/meritage-classic.response-0.pruned.json"
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
