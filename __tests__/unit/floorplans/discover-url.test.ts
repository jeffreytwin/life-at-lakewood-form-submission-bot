import { describe, it, expect } from "vitest";
import { pageIsCommunity, rankCandidates, readsLikeHomes } from "@/lib/floorplans/discover-url";

const CA = "https://www.tollbrothers.com/regency/Monterey-CA";
const FL = "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/Monterey-at-Lakewood-Ranch";
const FL_COLLECTION = "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/Monterey-at-Lakewood-Ranch/Palmera-Collection";
const OTHER = "https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch";
/** What a community page carries besides its name. */
const HOMES = "<h2>Floor Plans</h2> 4 bedrooms, 3 baths, 2,400 sq ft, from $512,000";

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
    expect(pageIsCommunity(CA, "<h1>Regency at Monterey</h1> Monterey, CA" + HOMES, "Monterey", ["Lakewood Ranch"])).toBe(false);
    expect(pageIsCommunity(FL, "<h1>Monterey at Lakewood Ranch</h1>" + HOMES, "Monterey", ["Lakewood Ranch"])).toBe(true);
    expect(pageIsCommunity(FL, "<h1>Monterey</h1> Bradenton, FL" + HOMES, "Monterey", ["Lakewood Ranch"])).toBe(true);
    expect(pageIsCommunity(CA, "<h1>Regency at Monterey</h1>" + HOMES, "Monterey")).toBe(true);
    expect(pageIsCommunity(FL, "<h1>Something else</h1>" + HOMES, "Monterey", ["Lakewood Ranch"])).toBe(false);
  });
});

describe("finding the community's own page, not a page about it (Neal, 2026-09-22)", () => {
  const STORY = "https://nealcommunities.com/veteran-feels-at-home-at-boca-royale/";
  const PAGE = "https://nealcommunities.com/communities/boca-royale/";
  const BLOG = "https://nealcommunities.com/blog/boca-royale-golf-day/";

  it("ranks the community's own address above a story whose address names it", () => {
    expect(rankCandidates([STORY, PAGE], "Boca Royale")).toEqual([PAGE, STORY]);
  });

  it("drops blog and news addresses outright", () => {
    expect(rankCandidates([BLOG], "Boca Royale")).toEqual([]);
    expect(rankCandidates(["https://x.com/news/2025/oakfield-opens"], "Oakfield")).toEqual([]);
  });

  it("a page has to read like homes for sale, not just name the community", () => {
    expect(readsLikeHomes("a veteran and his family feel at home at boca royale")).toBe(false);
    expect(readsLikeHomes(HOMES.toLowerCase())).toBe(true);
    expect(pageIsCommunity(STORY, "<h1>Veteran feels at home at Boca Royale</h1>", "Boca Royale")).toBe(false);
    expect(pageIsCommunity(PAGE, "<h1>Boca Royale</h1>" + HOMES, "Boca Royale")).toBe(true);
  });
});
