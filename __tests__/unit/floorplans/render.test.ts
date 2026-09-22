import { describe, expect, it } from "vitest";
import { pageLooksUnrendered } from "@/lib/floorplans/extractors/rendered";

describe("pageLooksUnrendered", () => {
  it("knows a page that draws its plans after loading", () => {
    // Richmond American's community page, distilled: 15,000 characters of
    // navigation and not one dollar sign (probed 2026-09-22). The same
    // test tells the plain engine to say so, and tells the browser when
    // the page has finished filling itself in.
    const shell =
      "Estates at Rivers Edge in Parrish, Florida | Richmond American Homes Skip to main content " +
      "Menu Close Search new homes Why Richmond? Home design Design Center Quality homes Resources " +
      "Overview Ratings & reviews Home collections Homebuyer guides Agent resources Blog About us " +
      "Our company Careers Contact us Investors Land acquisition Warranty Request Sign in";
    expect(pageLooksUnrendered(shell)).toBe(true);
  });

  it("leaves a page that did render alone, whatever it reported", () => {
    // One price, one size or one bed count is the page speaking for itself.
    expect(pageLooksUnrendered("Mayport $324,990 Available in October 2026")).toBe(false);
    expect(pageLooksUnrendered("The Hawthorne offers 2,145 sq ft of living space.")).toBe(false);
    expect(pageLooksUnrendered("3 Bed 2 Bath — now selling")).toBe(false);
    // A sold-out community that still prices what it had is the page's own truth.
    expect(pageLooksUnrendered("We are sold out. Homes from $299,990 at our nearest community.")).toBe(false);
  });

  it("is not fooled by a phone number or a year", () => {
    expect(pageLooksUnrendered("Call 941.263.5638 · © 2026 Richmond American Homes")).toBe(true);
  });
});
