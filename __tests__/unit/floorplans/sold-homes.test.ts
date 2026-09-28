import { describe, expect, it } from "vitest";
import { isSoldHome, saysSold, withoutSoldHomes } from "@/lib/floorplans/sold-homes";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const home = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "18340-rockport-place",
  name: "18340 Rockport Place",
  price: 474990,
  priceDisplay: "$474,990",
  beds: "2",
  baths: "2",
  sqft: 1675,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: true,
  relatedPlanName: "Lido",
  comingSoon: false,
  sourceUrl: "https://www.kolterhomes.com/new-homes/sarasota-bradenton-cresswind-lakewood-ranch/5572/move-in-ready/qd-562/",
  galleryImages: [],
  blueprintImages: [],
  description: null,
  ...over,
});

describe("a home the builder marks sold (Kolter's Cresswind, Jeff 2026-09-28)", () => {
  it("knows a card that opens by saying the home is sold or spoken for", () => {
    expect(saysSold("SOLD, Lido | Key Collection Homesite 562, 2,383 Total Sq. Ft. 1,675 Living Area Sq. Ft.")).toBe(true);
    expect(saysSold("Under Contract - Summerland")).toBe(true);
    expect(saysSold("Sale Pending")).toBe(true);
    expect(saysSold("Decorated Model, Palm Beach | Coastal Collection Homesite 004")).toBe(false);
    expect(saysSold("Sold out of its first phase, the Lido offers two bedrooms and a den.")).toBe(false);
    expect(saysSold(null)).toBe(false);
  });

  it("takes out a home its page or its card marks sold, and nothing else", () => {
    const byPage = home({ raw: { sold: true } });
    const byCard = home({ planKey: "18324-rockport-place", name: "18324 Rockport Place", raw: { featuresLine: "SOLD, Summerland | Key Collection Homesite 566" } });
    const onOffer = home({ planKey: "5056-simons-court", name: "5056 Simons Court", description: "Decorated Model, Palm Beach | Coastal Collection Homesite 004" });
    const plan = home({ planKey: "lido", name: "Lido", quickMoveIn: false, raw: { sold: true } });
    expect(isSoldHome(byPage)).toBe(true);
    expect(withoutSoldHomes([byPage, byCard, onOffer, plan])).toEqual([onOffer, plan]);
  });
});
