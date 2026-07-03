import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCards, normalizeCard } from "@/lib/floorplans/extractors/mpc-aggregator";

// Real Wellen Park home-search cards (round mpc3 capture): a homes-by-towne
// move-in-ready (address in <h3>), a mattamy move-in-ready, and an M/I
// to-be-built plan (plan name in <h3>, "FROM $…" in <h4>).
const html = readFileSync(
  path.resolve(__dirname, "../../fixtures/floorplans/wellenpark-cards.html"),
  "utf8"
);
const cards = parseCards(html);

describe("MPC aggregator card parsing", () => {
  it("parses every property card with its data attributes", () => {
    expect(cards.length).toBe(3);
    const slugs = cards.map((c) => c.attrs["builder-name"]);
    expect(slugs).toContain("mi-homes");
    expect(slugs).toContain("homes-by-towne");
  });

  it("maps a move-in-ready card to an address-named QMI", () => {
    const card = cards.find((c) => c.attrs["builder-name"] === "homes-by-towne")!;
    const plan = normalizeCard(card)!;
    expect(plan.quickMoveIn).toBe(true);
    expect(plan.name).toBe("18045 Foxtail Loop");
    expect(plan.price).toBe(1269900);
    expect(plan.priceDisplay).toBe("$1,269,900");
    expect(plan.beds).toBe("3");
    expect(plan.baths).toBe("3");
    expect(plan.sqft).toBe(2867);
    expect(plan.raw?.neighborhood).toBe("palmera");
    expect(plan.galleryImages[0]).toMatch(/^https:\/\/static\.wellenpark\.com\//);
    expect(plan.sourceUrl).toContain("/home/");
  });

  it("maps a to-be-built card to a base plan named by the plan", () => {
    const card = cards.find((c) => c.attrs["builder-name"] === "mi-homes")!;
    const plan = normalizeCard(card)!;
    expect(plan.quickMoveIn).toBe(false);
    expect(plan.name).toBe("Reflection");
    expect(plan.price).toBe(859990); // parsed out of "FROM $859,990"
    expect(plan.raw?.relatedPlan).toBe("Reflection");
    expect(plan.raw?.builderSlug).toBe("mi-homes");
  });
});
