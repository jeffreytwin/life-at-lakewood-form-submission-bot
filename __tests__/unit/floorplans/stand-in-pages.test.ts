import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Claude's reading of a plan's page, by address: what the page says, or a failure.
const pages = new Map<string, string | null | Error>();
const asked: string[] = [];

vi.mock("@/lib/floorplans/extractors/claude-extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/floorplans/extractors/claude-extract")>();
  return {
    ...actual,
    readPlanPageWithClaude: vi.fn(async (plan: NormalizedPlan, read: import("@/lib/floorplans/extractors/claude-extract").PageReader) => {
      asked.push(plan.sourceUrl!);
      await read(plan.sourceUrl!);
      const page = pages.get(plan.sourceUrl!);
      if (page instanceof Error) throw page;
      if (page === undefined) return plan;
      return { ...plan, description: plan.description ?? page };
    }),
  };
});

import { onlyThatPage, planPageCandidates, withPlanPageDescription } from "@/lib/floorplans/stand-in-pages";

const plan = (over: Partial<NormalizedPlan>): NormalizedPlan => ({
  planKey: "2200",
  name: "2200",
  price: 400000,
  priceDisplay: "$400,000",
  beds: "4",
  baths: "3",
  sqft: 2200,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages: [],
  blueprintImages: [],
  ...over,
});

const adams = "https://www.adamshomes.com";
const homeText = "Don't miss this rare opportunity to own the current Adams Homes model home, with a builder leaseback program.";
const planText = "The 2200 plan features 4 bedrooms, 3 baths and a great room that opens to the covered lanai.";

describe("planPageCandidates: where a stand-in plan's own page may be", () => {
  it("files the plan where the builder files the plans it lists (Adams)", () => {
    const standIn = plan({ sourceUrl: `${adams}/homes/florida/tampa/aviary-at-rutland-ranch/16215-59th-court-e` });
    const listed = [
      plan({ planKey: "plan-1512", name: "Plan 1512", sourceUrl: `${adams}/plan/aviary-at-rutland-ranch/1512` }),
      plan({ planKey: "plan-1820", name: "Plan 1820", sourceUrl: `${adams}/plan/aviary-at-rutland-ranch/1820` }),
      // Another stand-in shows nothing of the builder's filing.
      plan({ planKey: "1970", name: "1970", sourceUrl: `${adams}/homes/florida/tampa/aviary-at-rutland-ranch/7009-166th-place-e`, standInFor: ["7009 166th Place E"] }),
    ];
    const homes = [plan({ quickMoveIn: true, name: "16215 59TH Court E", sourceUrl: standIn.sourceUrl })];
    expect(planPageCandidates(standIn, listed, homes)).toEqual([`${adams}/plan/aviary-at-rutland-ranch/2200`]);
  });

  it("takes the folder a home sits in when it is named for the plan", () => {
    const df = "https://dreamfindershomes.com/new-homes/fl/parrish/seaire-60";
    const arlington = (over: Partial<NormalizedPlan>) => plan({ planKey: "arlington-w-bonus", name: "Arlington w/Bonus", ...over });
    expect(planPageCandidates(arlington({}), [], [arlington({ quickMoveIn: true, sourceUrl: `${df}/arlington-wbonus/7425-sea-manatee-street/` })])).toEqual([
      `${df}/arlington-wbonus/`,
    ]);
    // Boca II's folder is not Boca II w/Bonus's page.
    expect(planPageCandidates(plan({ name: "Boca II w/Bonus" }), [], [plan({ quickMoveIn: true, sourceUrl: `${df}/boca-ii/7414-sea-manatee-street/` })])).toEqual([]);
    const highland = "https://www.highlandhomes.org/new-homes/florida/bradenton-sarasota/parrish/aviary-at-rutland-ranch";
    expect(planPageCandidates(plan({ name: "Aubrey" }), [], [plan({ quickMoveIn: true, sourceUrl: `${highland}/aubrey/AV3-00-454` })])).toEqual([`${highland}/aubrey`]);
    // Neal numbers its plans' folders.
    const neal = "https://nealcommunities.com/new-homes/grand-palm";
    expect(planPageCandidates(plan({ name: "Captiva" }), [], [plan({ quickMoveIn: true, sourceUrl: `${neal}/captiva-9/12630-harney-street-captiva-600/` })])).toEqual([`${neal}/captiva-9/`]);
  });

  it("puts the address nearest the plan's homes first", () => {
    const tm = "https://www.taylormorrison.com/fl/sarasota/englewood/esplanade-at-wellen-park/floor-plans";
    const got = planPageCandidates(
      plan({ name: "Pallazio II" }),
      [plan({ name: "Alta", sourceUrl: `${tm}/alta` })],
      [plan({ quickMoveIn: true, sourceUrl: `${tm}/pallazio-ii/home-available-now-at-26112-asparano-avenue` })]
    );
    expect(got).toEqual([`${tm}/pallazio-ii`]);
  });

  it("finds nothing where neither way applies (Ryan's specs, Meritage's series pages)", () => {
    expect(
      planPageCandidates(plan({ name: "Mayport" }), [], [plan({ quickMoveIn: true, sourceUrl: "https://www.ryanhomes.com/new-homes/communities/10222120152673/specs/31336/florida/lakewood-ranch/amber-creek" })])
    ).toEqual([]);
  });
});

describe("withPlanPageDescription", () => {
  const standIn = plan({ description: homeText, raw: { standInFor: ["16215 59TH Court E"], descriptionOriginal: homeText } });
  const url = `${adams}/plan/aviary-at-rutland-ranch/2200`;
  const served = new Map<string, string>();
  const read = vi.fn(async (u: string) => {
    if (!served.has(u)) throw new Error(`fetch ${u}: 404`);
    return { url: served.get(u)!, html: "<html></html>" };
  });

  beforeEach(() => {
    pages.clear();
    served.clear();
    asked.length = 0;
  });

  it("takes the plan's own description from its page (Adams' 2200)", async () => {
    served.set(url, url);
    pages.set(url, planText);
    const got = await withPlanPageDescription(standIn, [url], read);
    expect(got.description).toBe(planText);
    expect(got.raw).toMatchObject({ planPageUrl: url, descriptionFrom: "plan-page", standInFor: ["16215 59TH Court E"] });
    expect(got.raw?.descriptionOriginal).toBeUndefined();
    expect(got.pageUnread).toBeUndefined();
  });

  it("keeps the home's where the page has none, or only a spec line", async () => {
    served.set(url, url);
    pages.set(url, null);
    expect((await withPlanPageDescription(standIn, [url], read)).description).toBe(homeText);
    pages.set(url, "4 Bedroom, 3 Bath, Great Room, Covered Lanai, 2-Car Garage");
    expect((await withPlanPageDescription(standIn, [url], read)).description).toBe(homeText);
  });

  it("keeps the home's where no address is the plan's page: not there, or sent to another page", async () => {
    const other = `${adams}/plan/aviary-at-rutland-ranch/2200-b`;
    served.set(other, `${adams}/plans`);
    const got = await withPlanPageDescription(standIn, [url, other], read);
    expect(got.description).toBe(homeText);
    expect(got.pageUnread).toBeUndefined();
    expect(asked).toEqual([url, other]);
  });

  it("marks the plan unread where its page could not be read, so no run proposes the home's text back", async () => {
    served.set(url, url);
    pages.set(url, new Error("Claude timed out"));
    const got = await withPlanPageDescription(standIn, [url], read);
    expect(got.description).toBe(homeText);
    expect(got.pageUnread).toBe(true);
  });

  it("takes the page only where it answered for the address asked", async () => {
    const reader = onlyThatPage(async (u) => ({ url: u.endsWith("/2200") ? `${adams}/plans` : `${u}/`, html: "" }));
    await expect(reader(url)).rejects.toThrow(/answered as/);
    await expect(reader(`${adams}/plan/aviary-at-rutland-ranch/1512`)).resolves.toBeTruthy();
  });
});
