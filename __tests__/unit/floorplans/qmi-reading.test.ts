import { describe, expect, it } from "vitest";
import { homeAddressed, linkOnPage, oneHomeEach, sameHome } from "@/lib/floorplans/extractors/claude-extract";
import { fullAndHalfBaths, namesAnAddress, planInHomeLabel, roomCount, standardizePlan } from "@/lib/floorplans/standardize";
import { looksLikeFactsLine, looksLikeSpecList, withDescriptions } from "@/lib/floorplans/description";
import { comparedFields, fieldChanges, mergeForUpdate } from "@/lib/floorplans/diff";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const home = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "12422-stonegate-trail",
  name: "12422 Stonegate Trail",
  price: 1293990,
  priceDisplay: "$1,293,990",
  beds: "4",
  baths: "4",
  sqft: 3287,
  garages: "3 car",
  homeType: "Single Family Home",
  quickMoveIn: true,
  relatedPlanName: "Belize",
  comingSoon: false,
  sourceUrl: "https://medallionhome.com/communities/river-preserve-estates/homes/12422-stonegate-trail/",
  galleryImages: [],
  blueprintImages: [],
  description: null,
  ...over,
});

describe("a home named by its street address", () => {
  it("is an address", () => {
    for (const name of ["12422 Stonegate Trail", "4931 Carova Way", "18366 Rockport Place", "5060 Simons Court", "12785 JADE EMPRESS LOOP, Unit 202", "7910 Lake Powell PL"]) {
      expect(namesAnAddress(name), name).toBe(true);
    }
  });

  it("is not a floor plan's name", () => {
    for (const name of ["Casey - Move-In Ready", "Plan 1989", "3368F", "Belize", "Aruba 2", "The Kylie", "Isla Grande", "40' Series", "Ana Maria with Bonus", ""]) {
      expect(namesAnAddress(name), name).toBe(false);
    }
  });

  it("finds the plan in a list label that is not an address", () => {
    expect(planInHomeLabel("Casey - Move-In Ready")).toBe("Casey");
    expect(planInHomeLabel("Ana Maria – Move-In Ready")).toBe("Ana Maria");
    expect(planInHomeLabel("18366 Rockport Place")).toBeNull();
    expect(planInHomeLabel("Palm Beach")).toBeNull();
  });
});

describe("a link Claude reports is one the page has (Kolter's Cresswind)", () => {
  const listPage = "https://www.kolterhomes.com/new-homes/sarasota-bradenton-cresswind-lakewood-ranch/move-in-ready/";
  const real = "https://www.kolterhomes.com/new-homes/sarasota-bradenton-cresswind-lakewood-ranch/5804/move-in-ready/qd-556/";
  const html = `<a href="/new-homes/sarasota-bradenton-cresswind-lakewood-ranch/5804/move-in-ready/qd-556/">Casey</a>
    <a href="/new-homes/sarasota-bradenton-cresswind-lakewood-ranch/5823/move-in-ready/qd-550/">Lido</a>`;

  it("takes a mangled link for the page's own", () => {
    expect(linkOnPage("https://www.kolterhomes.com/new-homes/sarasota-bradenton-cresswind-lakewood-ranch//5804/qd-556/", html, listPage)).toBe(real);
  });

  it("keeps a link the page has, and one it cannot place", () => {
    expect(linkOnPage(real, html, listPage)).toBe(real);
    expect(linkOnPage("https://www.kolterhomes.com/somewhere/else/", html, listPage)).toBe("https://www.kolterhomes.com/somewhere/else/");
    expect(linkOnPage(undefined, html, listPage)).toBeNull();
  });

  it("does not choose between two page links that both fit", () => {
    const twice = `${html}<a href="/new-homes/other/5804/move-in-ready/qd-556/">again</a>`;
    const said = "https://www.kolterhomes.com/5804/qd-556/";
    expect(linkOnPage(said, twice, listPage)).toBe(said);
  });
});

describe("a home named by its list label takes the address its own page gives", () => {
  const listed = home({ planKey: "casey-move-in-ready", name: "Casey - Move-In Ready", relatedPlanName: null });

  it("is renamed, and keeps the label's plan", () => {
    expect(homeAddressed(listed, "18366 Rockport Place")).toEqual({
      name: "18366 Rockport Place",
      planKey: "18366-rockport-place",
      relatedPlanName: "Casey",
    });
  });

  it("is left alone where it is already named by its address, is a plan, or the page gives none", () => {
    expect(homeAddressed(home(), "12418 Stonegate Trail")).toEqual({});
    expect(homeAddressed({ ...listed, quickMoveIn: false }, "18366 Rockport Place")).toEqual({});
    expect(homeAddressed(listed, undefined)).toEqual({});
    expect(homeAddressed(listed, "Key Collection")).toEqual({});
  });
});

describe("a run that read no base plan does not take one away (Medallion's River Preserve Estates)", () => {
  it("proposes no base plan change, and an approval keeps the record's", () => {
    const read = home({ relatedPlanName: null, priceDisplay: "$1,299,990", price: 1299990 });
    expect(fieldChanges(home(), read).map((c) => c.label)).toEqual(["price"]);
    expect(comparedFields(home(), read)).not.toContain("base plan");
    expect(mergeForUpdate(home(), read).relatedPlanName).toBe("Belize");
  });

  it("still proposes a base plan read differently", () => {
    expect(fieldChanges(home(), home({ relatedPlanName: "Aruba 2" })).map((c) => c.label)).toEqual(["base plan"]);
  });
});

describe("one home listed on two pages is one home (Kolter's Cresswind)", () => {
  const cresswind = "https://www.kolterhomes.com/new-homes/sarasota-bradenton-cresswind-lakewood-ranch";
  const onPlansPage = home({ planKey: "casey-move-in-ready", name: "Casey Move-in Ready", sourceUrl: `${cresswind}//5804/qd-556/` });
  const onHomesPage = home({ planKey: "18366-rockport-place", name: "18366 Rockport Place", sourceUrl: `${cresswind}/5804/move-in-ready/qd-556/` });

  it("knows the two links for one home's page", () => {
    expect(sameHome(onPlansPage, onHomesPage)).toBe(true);
    expect(sameHome(onPlansPage, home({ name: "Lido Move-in Ready", sourceUrl: `${cresswind}/5823/move-in-ready/qd-550/` }))).toBe(false);
  });

  it("knows one address", () => {
    expect(sameHome(home({ sourceUrl: "https://a.example/x/1/" }), home({ sourceUrl: "https://b.example/y/2/" }))).toBe(true);
  });

  it("does not take two plans' pages for one home", () => {
    const plan = (slug: string) => home({ name: slug, quickMoveIn: false, sourceUrl: `${cresswind}/4020/floorplan/${slug}/` });
    expect(sameHome(plan("casey"), plan("lido"))).toBe(false);
  });

  it("keeps the home read more fully where two take one key", () => {
    const unread = home({ planKey: "18373-rockport-place", pageUnread: true, galleryImages: ["https://x/1.jpg"] });
    const read = home({ planKey: "18373-rockport-place", galleryImages: ["https://x/1.jpg", "https://x/2.jpg"] });
    const other = home({ planKey: "4924-edisto-court", name: "4924 Edisto Court" });
    expect(oneHomeEach([unread, other, read])).toEqual([other, read]);
  });
});

describe("bedrooms and bathrooms as numbers", () => {
  it("counts the bedrooms, not the rooms beside them (Homes by Towne)", () => {
    expect(roomCount("4 + Den + Bonus Room")).toBe("4");
    expect(roomCount("3 + Den")).toBe("3");
    expect(roomCount("2 + Study")).toBe("2");
    expect(roomCount("4 Bedrooms")).toBe("4");
    expect(roomCount("3 - 4")).toBe("4");
    expect(roomCount("5+")).toBe("5+");
    expect(roomCount("")).toBe("");
  });

  it("reads full and half baths from the words (Kolter)", () => {
    expect(fullAndHalfBaths("3 Bedroom, Den, 3 Full and 1 Half Bath, Great Room")).toBe("3.5");
    expect(roomCount("2 Full & 1 Half Baths")).toBe("2.5");
    expect(fullAndHalfBaths("Bedrooms 3 Full Baths 2 Half Bath 1")).toBeNull();
    expect(fullAndHalfBaths("3 Bath")).toBeNull();
  });

  it("keeps what the builder said beside the count", () => {
    const plan = standardizePlan(home({ quickMoveIn: false, beds: "4 + Den + Bonus Room", baths: "3" }));
    expect(plan.beds).toBe("4");
    expect(plan.raw?.bedsRaw).toBe("4 + Den + Bonus Room");
  });

  it("takes the baths a spec line gives in words over Claude's count", () => {
    const line = "3 Bedroom, Den, 3 Full and 1 Half Bath, Great Room, 2-Car Garage (up to 3 Car-Garage)";
    const [plan] = withDescriptions([home({ quickMoveIn: false, name: "Palm Beach", baths: "3", description: line })], "Cresswind");
    expect(plan.baths).toBe("3.5");
    expect(plan.raw?.featuresLine).toBe(line);
  });
});

describe("a card's line of facts is not a description (Kolter's Cresswind)", () => {
  it("knows a line of facts", () => {
    expect(looksLikeFactsLine("Key Collection 2,383 Total Sq. Ft. 1,675 Living Area Sq. Ft.")).toBe(true);
    expect(looksLikeSpecList("NEW PLAN Island Collection 2,871 Total Sq. Ft. 2,129 Living Area Sq. Ft.")).toBe(true);
  });

  it("knows a spec line that leads with the plan's series", () => {
    expect(looksLikeSpecList("Island Collection 2 Bedroom (up to 3 Bedroom), Den, 2 Bath, Great Room, 2-Car Garage")).toBe(true);
  });

  it("does not take a written description for one", () => {
    const written = "The Lido offers 1,675 square feet of open living, with a great room that opens to the lanai and a kitchen made for gathering.";
    expect(looksLikeFactsLine(written)).toBe(false);
    expect(looksLikeSpecList(written)).toBe(false);
  });

  it("writes the plan's own description in its place", () => {
    const [plan] = withDescriptions([home({ quickMoveIn: false, name: "Lido", description: "Key Collection 2,383 Total Sq. Ft. 1,675 Living Area Sq. Ft." })], "Cresswind");
    expect(plan.description).toMatch(/^The Lido is available to be built in Cresswind\./);
    expect(plan.raw?.descriptionGenerated).toBe(true);
  });
});
