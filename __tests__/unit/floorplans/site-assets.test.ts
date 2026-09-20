import { describe, it, expect } from "vitest";
import { VIRTUAL_TOUR_BUTTONS, virtualTourButtonFor } from "@/lib/floorplans/site-assets";

describe("virtualTourButtonFor", () => {
  it("gives each site its own button, as the freelancers filed it", () => {
    expect(virtualTourButtonFor("lifeatlakewood.com")).toContain("d0be81_d1e78d3ae03d4ccea69c0b71447771f3~mv2.png");
    expect(virtualTourButtonFor("www.lifeinwellenpark.com")).toContain("d0be81_c058298041a44e13a3424f3ac0fe2a85~mv2.png");
    expect(virtualTourButtonFor("LifeAtParrish.com")).toContain("Virtual%20Tour%20Button%20-%20Parrish.png");
    for (const uri of Object.values(VIRTUAL_TOUR_BUTTONS)) {
      expect(uri).toMatch(/^wix:image:\/\/v1\/[^/]+\/[^#]+#originWidth=2718&originHeight=854$/);
    }
  });

  it("is nothing for a site without one", () => {
    expect(virtualTourButtonFor("lifeinlongboatkey.com")).toBeNull();
    expect(virtualTourButtonFor(null)).toBeNull();
    expect(virtualTourButtonFor("")).toBeNull();
  });
});
