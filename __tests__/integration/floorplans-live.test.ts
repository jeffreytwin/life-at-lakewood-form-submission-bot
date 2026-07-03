// Live extractor verification — network required, so this suite only runs
// when FP_LIVE=1 (set by the Floor Plan Slice workflow on a GitHub runner;
// the dev sandbox has no egress to builder domains). It exercises the real
// extractors end to end against the live sources.
import { describe, it, expect } from "vitest";
import { extractMeritage } from "@/lib/floorplans/extractors/meritage";
import { extractTollBrothers } from "@/lib/floorplans/extractors/toll-brothers";
import { extractTaylorMorrison } from "@/lib/floorplans/extractors/taylor-morrison";
import { extractMattamy } from "@/lib/floorplans/extractors/mattamy";
import { extractDrb } from "@/lib/floorplans/extractors/drb";
import { extractMpcAggregator } from "@/lib/floorplans/extractors/mpc-aggregator";

const live = process.env.FP_LIVE === "1";

describe.runIf(live)("live: Meritage via Sitecore Discover", () => {
  it("extracts Salt Meadows homes for both series", async () => {
    const plans = await extractMeritage({ communityName: "Salt Meadows" });
    console.log(`meritage: ${plans.length} plans`);
    console.log(JSON.stringify(plans.slice(0, 2), null, 1));
    expect(plans.length).toBeGreaterThanOrEqual(4);
    for (const p of plans) {
      expect(p.planKey).toBeTruthy();
      expect(p.quickMoveIn).toBe(true);
    }
    expect(plans.some((p) => (p.price ?? 0) > 100_000)).toBe(true);
    expect(plans.some((p) => p.galleryImages.length > 0)).toBe(true);
  }, 90_000);
});

describe.runIf(live)("live: Taylor Morrison inline scData", () => {
  it("extracts Firethorn base plans and available homes", async () => {
    const plans = await extractTaylorMorrison({
      url: "https://www.taylormorrison.com/fl/tampa/parrish/firethorn",
    });
    const bases = plans.filter((p) => !p.quickMoveIn);
    const qmis = plans.filter((p) => p.quickMoveIn);
    console.log(`taylor-morrison: ${bases.length} base plans, ${qmis.length} QMIs`);
    console.log(JSON.stringify([bases[0], qmis[0]], null, 1));
    expect(bases.length).toBeGreaterThanOrEqual(10); // page shows 37 plans
    expect(qmis.length).toBeGreaterThanOrEqual(1);
    expect(bases.some((p) => (p.price ?? 0) > 100_000)).toBe(true);
    for (const q of qmis) expect(q.raw?.relatedPlan).toBeTruthy();
  }, 90_000);
});

describe.runIf(live)("live: Mattamy via JSS search-data", () => {
  it("extracts Brightmore plans and QMIs", async () => {
    const plans = await extractMattamy({
      url: "https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/brightmore",
    });
    const bases = plans.filter((p) => !p.quickMoveIn);
    const qmis = plans.filter((p) => p.quickMoveIn);
    console.log(`mattamy: ${bases.length} base plans, ${qmis.length} QMIs`);
    console.log(JSON.stringify([bases[0], qmis[0]].filter(Boolean), null, 1));
    expect(plans.length).toBeGreaterThanOrEqual(3);
    expect(plans.some((p) => (p.price ?? 0) > 100_000)).toBe(true);
  }, 120_000);
});

describe.runIf(live)("live: DRB inventory sweep", () => {
  it("extracts Biscayne Landing at Seaire homes", async () => {
    const plans = await extractDrb({ communityName: "Seaire" });
    console.log(`drb: ${plans.length} inventory homes`);
    console.log(JSON.stringify(plans.slice(0, 2), null, 1));
    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (const p of plans) {
      expect(p.quickMoveIn).toBe(true);
      expect(p.raw?.relatedPlan).toBeTruthy();
    }
  }, 180_000);
});

describe.runIf(live)("live: MPC aggregator (Wellen Park) for blocked builders", () => {
  it("sources ICI Homes at Oakbend from wellenpark.com", async () => {
    const plans = await extractMpcAggregator({ builderName: "ICI Homes", communityName: "Oakbend" });
    console.log(`ici@oakbend via wellenpark: ${plans.length} homes`);
    console.log(JSON.stringify(plans.slice(0, 2), null, 1));
    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (const p of plans) {
      expect(p.raw?.builderSlug).toBe("ici-homes");
      expect(p.raw?.neighborhood).toBe("oakbend");
      expect((p.price ?? 0) > 100_000).toBe(true);
    }
  }, 90_000);

  it("sources M/I Homes at Palmera from wellenpark.com", async () => {
    const plans = await extractMpcAggregator({ builderName: "M/I Homes", communityName: "Palmera" });
    console.log(`mi@palmera via wellenpark: ${plans.length} homes`);
    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (const p of plans) expect(p.raw?.builderSlug).toBe("mi-homes");
  }, 90_000);
});

describe.runIf(live)("live: Toll Brothers QMI harvest", () => {
  it("extracts base plans AND quick move-ins from The Isles master page", async () => {
    const plans = await extractTollBrothers({
      url: "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch",
    });
    const bases = plans.filter((p) => !p.quickMoveIn);
    const qmis = plans.filter((p) => p.quickMoveIn);
    console.log(`toll: ${bases.length} base plans, ${qmis.length} QMIs`);
    console.log(JSON.stringify(qmis.slice(0, 2), null, 1));
    expect(bases.length).toBeGreaterThanOrEqual(5);
    expect(qmis.length).toBeGreaterThanOrEqual(1); // legacy shows 6 at The Isles
    for (const q of qmis) {
      expect(q.raw?.relatedPlan).toBeTruthy();
    }
  }, 90_000);
});
