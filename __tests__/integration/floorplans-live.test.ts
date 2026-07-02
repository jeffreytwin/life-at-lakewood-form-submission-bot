// Live extractor verification — network required, so this suite only runs
// when FP_LIVE=1 (set by the Floor Plan Slice workflow on a GitHub runner;
// the dev sandbox has no egress to builder domains). It exercises the real
// extractors end to end against the live sources.
import { describe, it, expect } from "vitest";
import { extractMeritage } from "@/lib/floorplans/extractors/meritage";
import { extractTollBrothers } from "@/lib/floorplans/extractors/toll-brothers";

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
