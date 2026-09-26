import { describe, expect, it } from "vitest";
import { priceOf, sortChanges, type ChangeSortFacts } from "@/lib/floorplans/sort-changes";

const plan = (over: Partial<ChangeSortFacts>): ChangeSortFacts => ({
  kind: "update",
  quickMoveIn: false,
  name: "Plan",
  price: null,
  site: "lifeatlakewood.com",
  community: "Cresswind",
  builder: "Kolter Homes",
  detected: "2026-09-26T06:00:00Z",
  ...over,
});

const names = (list: ChangeSortFacts[]) => list.map((p) => p.name);

describe("sorting the queue by a column (Jeff, 2026-09-26)", () => {
  const queue = [
    plan({ name: "Plan 10", kind: "remove", price: 500000, site: "lifeatparrish.com", detected: "2026-09-24T00:00:00Z" }),
    plan({ name: "12422 Stonegate Trail", kind: "update", quickMoveIn: true, price: 1293990, community: "Cross Creek", builder: "Medallion Home" }),
    plan({ name: "Plan 9", kind: "add", price: null, detected: "2026-09-26T09:00:00Z" }),
    plan({ name: "Azure", kind: "update", price: 459990, community: "Canoe Creek", builder: "Neal Communities" }),
  ];

  it("keeps the queue's own order with no column chosen", () => {
    expect(sortChanges(queue, null, (p) => p)).toBe(queue);
  });

  it("sorts by name the way people read numbers", () => {
    expect(names(sortChanges(queue, { key: "plan", dir: "asc" }, (p) => p))).toEqual(["12422 Stonegate Trail", "Azure", "Plan 9", "Plan 10"]);
    expect(names(sortChanges(queue, { key: "plan", dir: "desc" }, (p) => p))).toEqual(["Plan 10", "Plan 9", "Azure", "12422 Stonegate Trail"]);
  });

  it("sorts by price, a plan without one last either way", () => {
    expect(names(sortChanges(queue, { key: "details", dir: "asc" }, (p) => p))).toEqual(["Azure", "Plan 10", "12422 Stonegate Trail", "Plan 9"]);
    expect(names(sortChanges(queue, { key: "details", dir: "desc" }, (p) => p))).toEqual(["12422 Stonegate Trail", "Plan 10", "Azure", "Plan 9"]);
  });

  it("sorts new plans, then updates (plans before homes), then removals", () => {
    expect(names(sortChanges(queue, { key: "type", dir: "asc" }, (p) => p))).toEqual(["Plan 9", "Azure", "12422 Stonegate Trail", "Plan 10"]);
  });

  it("sorts by site, then community, then builder, ties in the queue's order", () => {
    expect(names(sortChanges(queue, { key: "where", dir: "asc" }, (p) => p))).toEqual(["Azure", "Plan 9", "12422 Stonegate Trail", "Plan 10"]);
  });

  it("sorts by when it was found", () => {
    expect(names(sortChanges(queue, { key: "detected", dir: "desc" }, (p) => p))[0]).toBe("Plan 9");
    expect(names(sortChanges(queue, { key: "detected", dir: "asc" }, (p) => p))[0]).toBe("Plan 10");
  });

  it("reads a price from the number or the price shown", () => {
    expect(priceOf(459990, null)).toBe(459990);
    expect(priceOf(null, "$1,293,990")).toBe(1293990);
    expect(priceOf(null, "Call for price")).toBeNull();
  });
});
