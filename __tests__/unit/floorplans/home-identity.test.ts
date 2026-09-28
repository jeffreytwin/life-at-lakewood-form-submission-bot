import { describe, expect, it } from "vitest";
import { alreadyFiled, filedAsBefore, nameKept, type FiledHome } from "@/lib/floorplans/home-identity";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const palmGrove = "https://nealcommunities.com/new-homes/palm-grove/ocean-front-2/17602-meandering-palms-crossing-oceanfront-083/";

const home = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "17602-meandering-palms-crossing",
  name: "17602 Meandering Palms Crossing",
  price: 967990,
  priceDisplay: "$967,990",
  beds: "3",
  baths: "2",
  sqft: 2100,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: true,
  relatedPlanName: "Ocean Front",
  comingSoon: false,
  sourceUrl: palmGrove,
  galleryImages: [],
  blueprintImages: [],
  description: null,
  ...over,
});

const row = (plan: NormalizedPlan, created: string): FiledHome => ({ plan_key: plan.planKey, record: plan, created_at: created });

describe("the name a home keeps when read again (Neal's Palm Grove, Jeff 2026-09-27)", () => {
  it("keeps its street address over a move-in date", () => {
    expect(nameKept("17602 Meandering Palms Crossing", "Ready February 2027")).toBe("17602 Meandering Palms Crossing");
    expect(nameKept("17602 Meandering Palms Crossing", "17602 Meandering Palms Crossing - Ready Feb 2027")).toBe("17602 Meandering Palms Crossing");
  });

  it("takes an address where it had none, and a different address as read", () => {
    expect(nameKept("Lot 656", "792 Blue Shell Loop - Lot 656")).toBe("792 Blue Shell Loop - Lot 656");
    expect(nameKept("17602 Meandering Palms Crossing", "17606 Meandering Palms Crossing")).toBe("17606 Meandering Palms Crossing");
  });
});

describe("a home read under another name is the home already filed", () => {
  const filed = home();

  it("is filed under its row, by its own page, and keeps its address", () => {
    const read = home({ planKey: "ready-february-2027", name: "Ready February 2027" });
    const [plan] = filedAsBefore([read], [row(filed, "2026-09-24T15:54:00Z")]);
    expect(plan.planKey).toBe("17602-meandering-palms-crossing");
    expect(plan.name).toBe("17602 Meandering Palms Crossing");
  });

  it("leaves a home whose key already names its row alone", () => {
    const read = home({ price: 959990 });
    expect(filedAsBefore([read], [row(filed, "2026-09-24T15:54:00Z")])[0]).toBe(read);
  });

  it("goes to the row named by its address where the site already has it twice", () => {
    const again = home({ planKey: "17602-meandering-palms-crossing-ready-feb-2027", name: "17602 Meandering Palms Crossing - Ready Feb 2027" });
    const dated = home({ planKey: "ready-february-2027", name: "Ready February 2027" });
    const rows = [row(again, "2026-09-25T15:29:00Z"), row(dated, "2026-09-26T06:00:00Z"), row(filed, "2026-09-24T15:54:00Z")];
    const [plan] = filedAsBefore([home({ planKey: "ready-february-2027", name: "Ready February 2027" })], rows);
    expect(plan.planKey).toBe("17602-meandering-palms-crossing");
    // Read under the address with its date, it is still the bare address's row.
    const [dateOn] = filedAsBefore([again], rows);
    expect(dateOn.planKey).toBe("17602-meandering-palms-crossing");
    expect(dateOn.name).toBe("17602 Meandering Palms Crossing");
  });

  it("stays on the row its key names where neither row is named by an address (Homes by Towne)", () => {
    const page = "https://homesbytowne.com/florida/shellstone-at-waterside/lot-166";
    const older = home({ planKey: "lot-166-available-april-2027", name: "Lot 166 - Available April 2027", sourceUrl: page });
    const newer = home({ planKey: "outrigger-available-april-2027-lot-166", name: "Outrigger - Available April 2027 - Lot 166", sourceUrl: page });
    const read = home({ planKey: "outrigger-available-april-2027-lot-166", name: "Outrigger - Available April 2027 - Lot 166", sourceUrl: page });
    expect(filedAsBefore([read], [row(older, "2026-09-25T00:00:00Z"), row(newer, "2026-09-26T00:00:00Z")])[0]).toBe(read);
  });

  it("is not another home, nor a floor plan", () => {
    const next = home({ planKey: "17618-meandering-palms-crossing", name: "17618 Meandering Palms Crossing", sourceUrl: palmGrove.replace("17602", "17618").replace("083", "079") });
    expect(filedAsBefore([next], [row(filed, "2026-09-24T15:54:00Z")])[0]).toBe(next);
    const plan = home({ quickMoveIn: false, planKey: "ocean-front", name: "Ocean Front" });
    expect(filedAsBefore([plan], [row(filed, "2026-09-24T15:54:00Z")])[0]).toBe(plan);
  });

  it("does not choose between two homes of this run that could both be one row", () => {
    const a = home({ planKey: "ready-february-2027", name: "Ready February 2027" });
    const b = home({ planKey: "lot-83", name: "Lot 83" });
    expect(filedAsBefore([a, b], [row(filed, "2026-09-24T15:54:00Z")])).toEqual([a, b]);
  });

  it("does not take homes that share a series page for one (Meritage)", () => {
    const series = "https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series";
    const one = home({ planKey: "7709-satterfield-ter", name: "7709 Satterfield Ter", sourceUrl: series });
    const two = home({ planKey: "7721-satterfield-ter", name: "7721 Satterfield Ter", sourceUrl: series });
    expect(filedAsBefore([two], [row(one, "2026-09-24T00:00:00Z")])[0]).toBe(two);
  });
});

describe("the only home read from a page is the home filed from it (Ryan's Amber Creek, Jeff 2026-09-28)", () => {
  const spec = "https://www.ryanhomes.com/new-homes/communities/10222120152673/specs/31336/florida/lakewood-ranch/amber-creek";
  const dated = home({ planKey: "mayport-available-in-october-2026", name: "Mayport - Available in October 2026", sourceUrl: spec, relatedPlanName: "Mayport" });

  it("is filed under the row it was, and takes its street address", () => {
    const read = home({ planKey: "12571-amber-creek-circle", name: "12571 Amber Creek Circle", sourceUrl: spec, relatedPlanName: "Mayport" });
    const [plan] = filedAsBefore([read], [row(dated, "2026-09-22T20:48:00Z")]);
    expect(plan.planKey).toBe("mayport-available-in-october-2026");
    expect(plan.name).toBe("12571 Amber Creek Circle");
  });

  it("stays on its own row where the site already has it twice", () => {
    const read = home({ planKey: "12571-amber-creek-circle", name: "12571 Amber Creek Circle", sourceUrl: spec });
    const rows = [row(dated, "2026-09-22T20:48:00Z"), row(read, "2026-09-28T14:07:00Z")];
    expect(filedAsBefore([read], rows)[0]).toBe(read);
  });

  it("is not another home the page was read for too", () => {
    const one = home({ planKey: "12571-amber-creek-circle", name: "12571 Amber Creek Circle", sourceUrl: spec });
    const two = home({ planKey: "12575-amber-creek-circle", name: "12575 Amber Creek Circle", sourceUrl: spec });
    expect(filedAsBefore([one, two], [row(dated, "2026-09-22T20:48:00Z")])).toEqual([one, two]);
  });

  it("is never a home at another street address", () => {
    const sold = home({ planKey: "12567-amber-creek-circle", name: "12567 Amber Creek Circle", sourceUrl: spec });
    const read = home({ planKey: "12571-amber-creek-circle", name: "12571 Amber Creek Circle", sourceUrl: spec });
    expect(filedAsBefore([read], [row(sold, "2026-09-20T00:00:00Z")])[0]).toBe(read);
  });
});

describe("a home whose own page went unread keeps its name (Homes by Towne's Shellstone, Jeff 2026-09-28)", () => {
  const page = "https://homesbytowne.com/florida/shellstone-at-waterside/lot-656";
  const filed = home({ planKey: "792-blue-shell-loop-lot-656", name: "9516 Lunar Dove Drive", sourceUrl: page });

  it("under another address the list gave it", () => {
    const read = home({ planKey: "792-blue-shell-loop-lot-656", name: "792 Blue Shell Loop, Lot 656", sourceUrl: page, pageUnread: true });
    expect(filedAsBefore([read], [row(filed, "2026-09-26T00:00:00Z")])[0].name).toBe("9516 Lunar Dove Drive");
    const other = home({ planKey: "lot-656", name: "Lot 656", sourceUrl: page, pageUnread: true });
    expect(filedAsBefore([other], [row(filed, "2026-09-26T00:00:00Z")])[0]).toMatchObject({ planKey: "792-blue-shell-loop-lot-656", name: "9516 Lunar Dove Drive" });
  });

  it("and takes the address its page gives once it is read", () => {
    const read = home({ planKey: "9516-lunar-dove-drive", name: "9516 Lunar Dove Drive", sourceUrl: page });
    const listedFirst = home({ planKey: "792-blue-shell-loop-lot-656", name: "792 Blue Shell Loop, Lot 656", sourceUrl: page });
    expect(filedAsBefore([read], [row(listedFirst, "2026-09-26T00:00:00Z")])[0]).toMatchObject({ planKey: "792-blue-shell-loop-lot-656", name: "9516 Lunar Dove Drive" });
  });
});

describe("an addition left from a run that read the home under another name", () => {
  const rows = [row(home(), "2026-09-24T15:54:00Z")];

  it("is a home the site already has", () => {
    expect(alreadyFiled(home({ planKey: "17602-meandering-palms-crossing-ready-feb-2027", name: "17602 Meandering Palms Crossing - Ready Feb 2027" }), rows)).toBe(true);
  });

  it("is not where the home is new, or is the row itself", () => {
    expect(alreadyFiled(home({ planKey: "17618-meandering-palms-crossing", name: "17618 Meandering Palms Crossing", sourceUrl: palmGrove.replace("17602", "17618") }), rows)).toBe(false);
    expect(alreadyFiled(home(), rows)).toBe(false);
    expect(alreadyFiled(null, rows)).toBe(false);
  });
});
