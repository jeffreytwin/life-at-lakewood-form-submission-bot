import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeDrbItem, normalizeDrbPlan, planOfferedIn, plansPageOf } from "@/lib/floorplans/extractors/drb";

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

describe("a DRB home's gallery, in the site's order from its titles", () => {
  it("leads with the front of the house, then the rooms, with the other outside views last", () => {
    const u = (n: string) => `https://cdn.drbhomes.com/${n}.jpg`;
    const plan = normalizeDrbItem({
      id: 1,
      planName: "Eagle",
      homesite: 8,
      images: [
        { url: u("bath"), type: "Photo", title: "Primary Bathroom" },
        { url: u("rear"), type: "Photo", title: "Rear Exterior of 8320 Golden Beach Court" },
        { url: u("kitchen"), type: "Photo", title: "Kitchen" },
        { url: u("front"), type: "Photo", title: "Front Exterior of 8320 Golden Beach Court" },
        { url: u("plan"), type: "Floorplan", title: "First Floor" },
      ],
    })!;
    expect(plan.galleryImages).toEqual([u("front"), u("kitchen"), u("bath"), u("rear")]);
    expect(plan.blueprintImages).toEqual([u("plan")]);
    expect(plan.galleryMeta?.[u("kitchen")]?.room).toBe("kitchen");
  });
});

describe("DRB's plans (Biscayne Landing at Seaire, Jeff 2026-09-26)", () => {
  const img = (url: string, sequence: number, title = "") => ({ url, sequence, title, status: "active" });
  const plan = {
    id: 2006,
    name: "Eider",
    status: "active",
    basePrice: 589990,
    bedsMin: 3,
    bedsMax: 4,
    bathsFullMin: 2,
    bathsFullMax: 3,
    bathsHalfMin: 0,
    bathsHalfMax: 1,
    sqFtMin: 2480,
    sqFtMax: 2480,
    garageSpacesMin: 3,
    garageSpacesMax: 3,
    marketingDescription: "<ul><li>Gourmet kitchen with a large island</li><li>Jack &amp; Jill bath</li></ul>",
    planType: { valueForFeed: "Single Family" },
    elevationImages: [img("https://assets.drbhomes.com/e2.jpg", 2), img("https://assets.drbhomes.com/e1.jpg", 1)],
    interiorImages: [img("https://assets.drbhomes.com/kitchen.jpg", 1, "Kitchen")],
    floorplanImages: [img("https://assets.drbhomes.com/fp1.jpg", 1, "First Floor")],
    availableLocations: [{ communityName: "Biscayne Landing at Seaire", id: 281 }],
  };

  it("takes the top of each range, the base price, and its pictures and drawings", () => {
    const p = normalizeDrbPlan(plan, "https://www.drbhomes.com/x/home-plans")!;
    expect(p).toMatchObject({ name: "Eider", quickMoveIn: false, price: 589990, priceDisplay: "$589,990", beds: "4", baths: "3.5", sqft: 2480, garages: "3 car" });
    expect(p.galleryImages[0]).toBe("https://assets.drbhomes.com/e1.jpg");
    expect(p.galleryImages).toContain("https://assets.drbhomes.com/kitchen.jpg");
    expect(p.blueprintImages).toEqual(["https://assets.drbhomes.com/fp1.jpg"]);
    expect(p.description).toBe("Gourmet kitchen with a large island. Jack & Jill bath.");
  });

  it("is the community's when DRB offers it there", () => {
    expect(planOfferedIn(plan, "seaire")).toBe(true);
    expect(planOfferedIn({ ...plan, availableLocations: [{ communityName: "Adagio" }] }, "seaire")).toBe(false);
  });

  it("links the community's plans page", () => {
    expect(plansPageOf("https://www.drbhomes.com/drbhomes/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire/overview")).toBe(
      "https://www.drbhomes.com/drbhomes/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire/home-plans"
    );
  });
});
