import { describe, expect, it } from "vitest";
import { seriesOf, withSeriesLabels } from "@/lib/floorplans/series-labels";
import { linkQuickMoveIns } from "@/lib/floorplans/quick-move-ins";
import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";

// Ashton Woods' Oakfield Trails, as the queue had it (Jeff, 2026-09-28).
const community = "https://www.ashtonwoods.com/tampa/oakfield-trails?comm=TAM|MCOTR";
const traditional = (slug: string) => `https://www.ashtonwoods.com/tampa/oakfield-trails-traditional/${slug}`;
const signature = (slug: string) => `https://www.ashtonwoods.com/tampa/oakfield-trails-signature/${slug}`;

const plan = (name: string, sourceUrl: string, over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: normKey(name),
  name,
  price: 500000,
  priceDisplay: "$500,000",
  beds: "4",
  baths: "3",
  sqft: 2500,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl,
  galleryImages: [],
  blueprintImages: [],
  ...over,
});
const home = (street: string, sourceUrl: string, relatedPlanName: string) =>
  plan(street, sourceUrl, { quickMoveIn: true, relatedPlanName });

describe("the series a page sits in", () => {
  it("is read from the folder beneath the community's own", () => {
    expect(seriesOf(traditional("duval"), community)).toBe("Traditional");
    expect(seriesOf(signature("signature-duval"), community)).toBe("Signature");
    expect(seriesOf(signature("signature-duval/9927-hidden-hammock-loop"), community)).toBe("Signature");
  });

  it("is none for a page not in a series, or another community's", () => {
    expect(seriesOf(community, community)).toBeNull();
    expect(seriesOf("https://www.ashtonwoods.com/tampa/somewhere-else/duval", community)).toBeNull();
    expect(seriesOf(null, community)).toBeNull();
  });
});

describe("a plan sold in two series", () => {
  it("is named for its series in each, and a plan in one keeps its name", () => {
    const out = withSeriesLabels(
      [
        plan("Duval", traditional("duval"), { price: 522510 }),
        plan("Duval", signature("signature-duval"), { planKey: "duval-signature", price: 547145 }),
        plan("Amelia", signature("signature-amelia")),
        plan("Tuttle", traditional("tuttle")),
      ],
      community
    );
    expect(out.map((p) => [p.name, p.planKey, p.price])).toEqual([
      ["Duval (Traditional)", "duval-traditional", 522510],
      ["Duval (Signature)", "duval-signature", 547145],
      ["Amelia", "amelia", 500000],
      ["Tuttle", "tuttle", 500000],
    ]);
  });

  it("comes out the same whether or not the page's reading labelled it", () => {
    const out = withSeriesLabels(
      [plan("Duval (Traditional)", traditional("duval")), plan("Signature Duval", signature("signature-duval"))],
      community
    );
    expect(out.map((p) => p.name)).toEqual(["Duval (Traditional)", "Duval (Signature)"]);
  });

  it("keeps its label on a night only one series is read, where the label is on file", () => {
    const out = withSeriesLabels([plan("Duval", traditional("duval")), plan("Amelia", signature("signature-amelia"))], community, [
      "duval-traditional",
      "duval-signature",
      "duval",
    ]);
    expect(out.map((p) => [p.name, p.planKey])).toEqual([
      ["Duval (Traditional)", "duval-traditional"],
      ["Amelia", "amelia"],
    ]);
  });

  it("leaves a builder's plans alone where none is in a series", () => {
    const plans = [plan("Bahia", "https://kolterhomes.com/cresswind/bahia")];
    expect(withSeriesLabels(plans, "https://kolterhomes.com/cresswind")).toBe(plans);
  });
});

describe("a home built from a plan sold in two series", () => {
  const plans = [
    plan("Duval", traditional("duval")),
    plan("Duval", signature("signature-duval"), { planKey: "duval-signature" }),
    plan("Amelia", signature("signature-amelia")),
    home("9927 Hidden Hammock Loop", signature("signature-duval/9927-hidden-hammock-loop"), "Duval"),
    home("10046 Hidden Hammock Loop", signature("signature-amelia/10046-hidden-hammock-loop"), "Amelia"),
  ];

  it("names the plan in its own series, and is filed under it", () => {
    const linked = linkQuickMoveIns(withSeriesLabels(plans, community));
    const duvalHome = linked.find((p) => p.name === "9927 Hidden Hammock Loop");
    expect(duvalHome?.relatedPlanName).toBe("Duval (Signature)");
    expect(duvalHome?.relatedPlanKey).toBe("duval-signature");
    const ameliaHome = linked.find((p) => p.name === "10046 Hidden Hammock Loop");
    expect(ameliaHome?.relatedPlanName).toBe("Amelia");
    expect(ameliaHome?.relatedPlanKey).toBe("amelia");
  });

  it("names the labelled plan on file on a night its plans went unread", () => {
    const out = withSeriesLabels([plans[3]], community, ["duval-signature"]);
    expect(out[0].relatedPlanName).toBe("Duval (Signature)");
  });
});
