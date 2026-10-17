import { describe, it, expect } from "vitest";
import {
  homesForSaleCandidates,
  isSoldOut,
  matchVillage,
  nameKey,
  shouldRaise,
  type VillageRow,
} from "@/lib/community-alerts/sold-out";

const ok = (count: number | null) => ({ running: true, lastPlanCount: count, lastRunStatus: `ok: ${count} plans, 0 changes queued` });

describe("isSoldOut", () => {
  it("is sold out when every running connection read no plans on a good run", () => {
    expect(isSoldOut(4, [ok(0), ok(0)])).toBe(true);
  });

  it("is not sold out while any running connection still reads plans", () => {
    expect(isSoldOut(0, [ok(0), ok(3)])).toBe(false);
  });

  it("does not take a single empty scrape for a sell-out: the first is failed as partial", () => {
    // A run that finds nothing where there were plans records the count
    // but fails; only the next night's run passes with zero.
    const partial = { running: true, lastPlanCount: 0, lastRunStatus: "partial: 0 of the 29 plans found last time (removals held; check the builder's page)" };
    expect(isSoldOut(29, [partial])).toBe(false);
    expect(isSoldOut(29, [ok(0)])).toBe(true);
  });

  it("does not read a reset connection, which has no count yet, as sold out", () => {
    expect(isSoldOut(0, [{ running: true, lastPlanCount: null, lastRunStatus: null }])).toBe(false);
  });

  it("is sold out when no connection is left running and the site holds no plans", () => {
    expect(isSoldOut(0, [])).toBe(true);
    expect(isSoldOut(0, [{ ...ok(12), running: false }])).toBe(true);
  });

  it("is not sold out when the connections are paused but the site still shows plans", () => {
    expect(isSoldOut(12, [{ ...ok(12), running: false }])).toBe(false);
  });
});

describe("shouldRaise", () => {
  it("raises only when a community goes from inventory to none", () => {
    expect(shouldRaise(false, true)).toBe(true);
    expect(shouldRaise(true, true)).toBe(false);
    expect(shouldRaise(false, false)).toBe(false);
    expect(shouldRaise(true, false)).toBe(false);
  });

  it("raises nothing for a community seen for the first time", () => {
    expect(shouldRaise(null, true)).toBe(false);
  });
});

describe("nameKey and matchVillage", () => {
  const village = (name: string, wix_slug: string | null = null): VillageRow => ({
    id: name,
    name,
    wix_slug,
    page_url: null,
    active: true,
    terms: 1,
  });
  const villages = [
    village("Bungalow Walk at Waterside", "waterside-bungalow-walk"),
    village("Crosswind", "crosswind-point"),
    village("Wellen Park Country Club", "wellen-park-golf-%26-country-club"),
    village("Star Farms", "star-farms"),
  ];

  it("reads the two engines' names for one neighborhood as the same", () => {
    expect(nameKey("Waterside - Bungalow Walk")).toBe(nameKey("Bungalow Walk at Waterside"));
    expect(matchVillage("Waterside - Bungalow Walk", villages)?.name).toBe("Bungalow Walk at Waterside");
  });

  it("matches by the page's slug where the names differ", () => {
    expect(matchVillage("Crosswind Point", villages)?.name).toBe("Crosswind");
  });

  it("reads an escaped ampersand in a slug, and a stray percent sign, without throwing", () => {
    expect(nameKey("wellen-park-golf-%26-country-club")).toBe(nameKey("Wellen Park Golf & Country Club"));
    expect(() => nameKey("100% Club")).not.toThrow();
  });

  it("matches nothing rather than the nearest name", () => {
    expect(matchVillage("Star Farms East", villages)).toBeNull();
    expect(matchVillage("", villages)).toBeNull();
  });
});

describe("homesForSaleCandidates", () => {
  it("follows the dynamic page on the newer sites", () => {
    expect(homesForSaleCandidates("https://www.lifeatparrish.com/neighborhood/river-plantation", "river-plantation")).toEqual([
      "https://www.lifeatparrish.com/neighborhood-homes-for-sale/river-plantation",
    ]);
  });

  it("tries both of Life At Lakewood's patterns", () => {
    expect(homesForSaleCandidates("https://www.lifeatlakewood.com/edgewater", "edgewater")).toEqual([
      "https://www.lifeatlakewood.com/homes-for-sale-in-edgewater",
      "https://www.lifeatlakewood.com/homes-for-sale-edgewater",
    ]);
  });

  it("has nothing to offer without a page", () => {
    expect(homesForSaleCandidates(null, "edgewater")).toEqual([]);
  });
});
