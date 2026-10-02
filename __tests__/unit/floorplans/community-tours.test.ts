import { describe, expect, it } from "vitest";
import { withoutCommunityTour } from "@/lib/floorplans/community-tours";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const p = (name: string, virtualTourUrl: string | null, over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: name.toLowerCase(), name, price: null, priceDisplay: null, beds: "", baths: "", sqft: null, garages: null,
  homeType: null, quickMoveIn: false, comingSoon: false, sourceUrl: null, galleryImages: [], blueprintImages: [], virtualTourUrl, ...over,
});

describe("withoutCommunityTour", () => {
  // Adams Homes at Aviary (2026-10-02): every plan and home was given the
  // tour of a home at Alachua out of the page's scripts.
  const alachua = "https://my.matterport.com/show/?m=RXcRfbd6bpt";

  it("takes a tour on every plan off the plans and their homes, as gone", () => {
    const out = withoutCommunityTour([
      p("Plan 1512", alachua),
      p("Plan 1820", alachua),
      p("Plan 1970", `${alachua}&play=1`),
      p("7009 166TH Place E", alachua, { quickMoveIn: true }),
    ]);
    for (const plan of out) expect(plan).toMatchObject({ virtualTourUrl: null, tourStated: true });
  });

  it("leaves tours that differ, and a plan kept in two collections (Ashton Woods' Oakfield)", () => {
    const plans = [
      p("Duval (Oakfield Trails Signature)", "https://my.matterport.com/show/?m=n5M65YLMtSC"),
      p("Duval (Oakfield Trails Traditional)", "https://my.matterport.com/show/?m=n5M65YLMtSC"),
      p("Plant (Oakfield Trails Signature)", "https://my.matterport.com/show/?m=N1ZYSGXAVVS"),
      p("Siesta (Oakfield Trails Signature)", null),
    ];
    expect(withoutCommunityTour(plans)).toBe(plans);
    // One plan in three collections, one tour: still one plan.
    const one = ["A", "B", "C"].map((c) => p(`Duval (${c})`, "https://my.matterport.com/show/?m=n5M65YLMtSC"));
    expect(withoutCommunityTour(one)).toBe(one);
  });

  it("needs three plans to tell", () => {
    const plans = [p("Plan 1512", alachua), p("Plan 1820", alachua)];
    expect(withoutCommunityTour(plans)).toBe(plans);
  });
});
