import { describe, it, expect } from "vitest";
import { pageIsCommunity, rankCandidates } from "@/lib/floorplans/discover-url";

const CA = "https://www.tollbrothers.com/regency/Monterey-CA";
const FL = "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/Monterey-at-Lakewood-Ranch";
const FL_COLLECTION = "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/Monterey-at-Lakewood-Ranch/Palmera-Collection";
const OTHER = "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch";

describe("rankCandidates", () => {
  it("puts the page in the site's market first, whatever its length", () => {
    expect(rankCandidates([OTHER, CA, FL_COLLECTION, FL], "Monterey", ["Lakewood Ranch"])).toEqual([FL, FL_COLLECTION, CA]);
  });

  it("without a market, the shortest page of the name wins (how Monterey-CA was picked on 2026-09-20)", () => {
    expect(rankCandidates([FL, CA], "Monterey")[0]).toBe(CA);
  });

  it("drops pages that are not named for the community, and matches the name after a site-area prefix", () => {
    expect(rankCandidates([OTHER], "Monterey", ["Lakewood Ranch"])).toEqual([]);
    expect(rankCandidates([FL, "https://x.com/waterside/wild-blue"], "Waterside - Wild Blue")).toEqual(["https://x.com/waterside/wild-blue"]);
  });
});

describe("pageIsCommunity", () => {
  it("wants the community's name, and its market when one is known, in the page or the URL", () => {
    expect(pageIsCommunity(CA, "<h1>Regency at Monterey</h1> Monterey, CA", "Monterey", ["Lakewood Ranch"])).toBe(false);
    expect(pageIsCommunity(FL, "<h1>Monterey at Lakewood Ranch</h1>", "Monterey", ["Lakewood Ranch"])).toBe(true);
    expect(pageIsCommunity(FL, "<h1>Monterey</h1> Bradenton, FL", "Monterey", ["Lakewood Ranch"])).toBe(true);
    expect(pageIsCommunity(CA, "<h1>Regency at Monterey</h1>", "Monterey")).toBe(true);
    expect(pageIsCommunity(FL, "<h1>Something else</h1>", "Monterey", ["Lakewood Ranch"])).toBe(false);
  });
});
