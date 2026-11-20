import { describe, expect, it } from "vitest";
import { pageIsBotCheck, pageLooksUnrendered } from "@/lib/floorplans/extractors/rendered";
import { pressLost } from "@/lib/floorplans/extractors/render";

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

describe("pageIsBotCheck", () => {
  it("knows Cloudflare's check standing in front of a plan's page (Neal Signature, 2026-09-24)", () => {
    const check =
      "<html><head><title>Just a moment...</title></head><body><h1>nealsignaturehomes.com</h1>" +
      "<h2>Performing security verification</h2><p>This website uses a security service to protect against malicious bots.</p></body></html>";
    expect(pageIsBotCheck(check)).toBe(true);
    expect(pageIsBotCheck("<title>x</title><p>Verify you are human by completing the action below.</p>")).toBe(true);
  });

  it("leaves a page that only carries the check's script alone (Lakewood Ranch)", () => {
    const page =
      "<title>Home Finder - Lakewood Ranch</title><script src='/cdn-cgi/challenge-platform/h/b/jsd/oneshot/d76008a69eab/x'></script>" +
      "<h1>Find Your perfect Florida home.</h1>";
    expect(pageIsBotCheck(page)).toBe(false);
  });
});

describe("pressLost", () => {
  const ryeManor = "https://www.richmondamerican.com/florida/tampa-new-homes/parrish/rye-manor/";

  it("knows a page that loaded itself again after its tab was pressed (Rye Manor, 2026-11-20)", () => {
    // The mark left before the press is gone, and the page is where it was.
    expect(pressLost(ryeManor, ryeManor, false)).toBe(true);
    expect(pressLost(ryeManor, `${ryeManor}#move-in-ready`, false)).toBe(true);
  });

  it("leaves a page that kept its mark alone", () => {
    expect(pressLost(ryeManor, ryeManor, true)).toBe(false);
    expect(pressLost(ryeManor, `${ryeManor}#move-in-ready`, true)).toBe(false);
  });

  it("takes a tab that went to an address of its own as the tab's page", () => {
    expect(pressLost(ryeManor, `${ryeManor}?tab=move-in-ready`, false)).toBe(false);
  });
});
