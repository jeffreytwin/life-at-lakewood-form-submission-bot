import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeDrbItem } from "@/lib/floorplans/extractors/drb";

// Real inventory item for Biscayne Landing at Seaire (communityId 281),
// captured in round-8 discovery and slimmed to the mapped fields.
const fixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../fixtures/floorplans/drb-inventory-fixture.json"),
    "utf8"
  )
);

describe("normalizeDrbItem", () => {
  it("maps a Seaire inventory home", () => {
    const plan = normalizeDrbItem(fixture.items[0])!;
    expect(plan).not.toBeNull();
    expect(plan.quickMoveIn).toBe(true);
    expect(plan.raw?.relatedPlan).toBe("Eider");
    expect(plan.price).toBe(594990);
    expect(plan.priceDisplay).toBe("$594,990");
    expect(plan.beds).toBe("3");
    expect(plan.baths).toBe("2.5");
    expect(plan.sqft).toBe(2480);
    expect(plan.garages).toBe("3 car");
    // Address recovered from image titles when present.
    expect(plan.name).toBe("8320 Golden Beach Court");
    expect(plan.galleryImages.length).toBeGreaterThan(0);
    for (const u of plan.galleryImages) expect(u).toMatch(/^https:/);
  });

  it("falls back to plan + homesite naming without image addresses", () => {
    const plan = normalizeDrbItem({ planName: "Eider", homesite: "92", price: 1 })!;
    expect(plan.name).toBe("Eider (Homesite 92)");
  });

  it("returns null for items with no identity", () => {
    expect(normalizeDrbItem({})).toBeNull();
  });
});
