import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { plansFromScData } from "@/lib/floorplans/extractors/taylor-morrison";

// Real scDataStore.data dumps from the Firethorn community pages
// (round-7 discovery; pruned — arrays capped, long strings truncated).
const dump = (name: string) =>
  JSON.parse(
    readFileSync(
      path.resolve(__dirname, `../../fixtures/floorplans/${name}`),
      "utf8"
    )
  );

const ORIGIN = "https://www.taylormorrison.com";

describe("plansFromScData (Taylor Morrison)", () => {
  it("maps floorPlansListDataArray to base plans with series names", () => {
    const plans = plansFromScData(dump("taylor-floor-plans.scdata.pruned.json"), ORIGIN);
    const bases = plans.filter((p) => !p.quickMoveIn);
    expect(bases.length).toBeGreaterThan(0);
    const finch = bases.find((p) => p.planKey === "finch")!;
    expect(finch.price).toBe(309999);
    expect(finch.priceDisplay).toBe("$309,999");
    expect(finch.beds).toBe("3");
    expect(finch.baths).toBe("2");
    expect(finch.sqft).toBe(1476);
    expect(finch.garages).toBe("2 car");
    expect(finch.sourceUrl).toBe(`${ORIGIN}/fl/tampa/parrish/firethorn/floor-plans/finch`);
    expect(finch.raw?.series).toBe("50' Journey Series");
    expect(finch.galleryImages[0]).toMatch(/^https:\/\/www\.taylormorrison\.com\/-\/media\//);
  });

  it("maps availableHomesList homes to address-named QMIs", () => {
    const plans = plansFromScData(dump("taylor-available-homes.scdata.pruned.json"), ORIGIN);
    const qmis = plans.filter((p) => p.quickMoveIn);
    expect(qmis.length).toBeGreaterThan(0);
    const camelot = qmis.find((p) => p.name === "13509 Camelot Court")!;
    expect(camelot.price).toBe(331929);
    expect(camelot.beds).toBe("3");
    expect(camelot.sqft).toBe(1603);
    expect(camelot.raw?.relatedPlan).toBe("spruce");
    expect(camelot.sourceUrl).toContain("/home-available-now-at-13509-camelot-court");
  });

  it("skips truncation markers and nameless entries", () => {
    const plans = plansFromScData(dump("taylor-floor-plans.scdata.pruned.json"), ORIGIN);
    for (const p of plans) expect(p.planKey).toBeTruthy();
  });
});
