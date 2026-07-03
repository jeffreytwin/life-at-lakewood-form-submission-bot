import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { plansFromSearchData, normalizeMattamyCard } from "@/lib/floorplans/extractors/mattamy";

// Real /search-data layout-service payload captured in round-7 discovery
// (pruned: arrays capped at 5, long strings truncated).
const capture = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../fixtures/floorplans/mattamy-search-data.pruned.json"
    ),
    "utf8"
  )
);

describe("plansFromSearchData (Mattamy)", () => {
  it("scopes cards by community page path prefix", () => {
    // Avila plan cards live at /florida/palm-city-stuart/jensen-beach/avila/…
    const plans = plansFromSearchData(capture.data, "/florida/palm-city-stuart/jensen-beach/avila");
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(p.sourceUrl).toContain("/avila/");
    const oceana = plans.find((p) => p.planKey === "oceana")!;
    expect(oceana.price).toBe(506990);
    expect(oceana.priceDisplay).toBe("$506,990");
    expect(oceana.beds).toBe("3");
    expect(oceana.baths).toBe("2.5");
    expect(oceana.sqft).toBe(2351);
    expect(oceana.garages).toBe("2 car");
    expect(oceana.quickMoveIn).toBe(false);
  });

  it("maps QMI cards with address names and related plans", () => {
    const plans = plansFromSearchData(capture.data, "/florida/tampa/palmetto/sanderling");
    const qmis = plans.filter((p) => p.quickMoveIn);
    expect(qmis.length).toBeGreaterThan(0);
    const soaring = qmis.find((p) => p.name === "1758 Soaring Vida St")!;
    expect(soaring.price).toBe(389878);
    expect(soaring.raw?.relatedPlan).toBe("Woodruff");
  });

  it("returns null for cards without a title", () => {
    expect(normalizeMattamyCard({}, { quickMoveIn: false })).toBeNull();
  });
});
