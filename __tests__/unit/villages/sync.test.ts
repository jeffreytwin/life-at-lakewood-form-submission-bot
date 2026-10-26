import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/listings/db", () => ({ selectAll: vi.fn(async () => []) }));
vi.mock("@/lib/wix/client", () => ({
  getDataCollection: vi.fn(),
  queryAllItems: vi.fn(),
  updateDataCollection: vi.fn(),
  updateItem: vi.fn(),
}));

import { aggregateVillageRanges, type VillageRow } from "@/lib/villages/ranges";
import { planVillageUpdates, VILLAGE_RANGE_TARGETS } from "@/lib/villages/sync";
import type { WixDataItem } from "@/lib/wix/client";

const target = VILLAGE_RANGE_TARGETS[0];

function item(id: string, data: Record<string, unknown>): WixDataItem {
  return { id, dataCollectionId: target.collectionId, data: { _id: id, _publishStatus: "PUBLISHED", ...data } };
}

const items: WixDataItem[] = [
  item("arbor", {
    title: "Arbor Grande",
    priceRange: "$500s - $1M+",
    priceRangeDropdown: "Show All Price Ranges, $500s, $600s, $700s, $800s, $900s, $1M+",
    priceRangeNew: ["$500s", "$600s", "$700s", "$800s", "$900s", "1M+"],
    description: "Gated, with a clubhouse.",
  }),
  item("aurora", {
    title: "Aurora",
    priceRange: "$200s - $400s",
    priceRangeDropdown: "Show All Price Ranges, $200s, $300s, $400s",
    priceRangeNew: ["$200s", "$300s", "$400s"],
    squareFootageRange: "1,400 - 2,200 square feet",
  }),
  item("amber", { title: "Amber Creek", priceRange: "$300s" }),
  item("summerfield", { title: "Summerfield", villagesTitle: "Summerfield & Riverwalk", priceRange: "$200s - $800s" }),
  item("isles-draft", { title: "The Isles", _publishStatus: "DRAFT", priceRange: "old" }),
  item("isles", { title: "The Isles", priceRange: "$1M+ - $2M+" }),
];

const rows: VillageRow[] = [
  { village: "Arbor Grande", source: "listing", price: 379_900, sqft: 1_571 },
  { village: "Arbor Grande", source: "listing", price: 999_999, sqft: 3_899 },
  { village: "Aurora", source: "listing", price: 274_900, sqft: 1_352 },
  { village: "Aurora", source: "listing", price: 432_300, sqft: 2_214 },
  { village: "Summerfield & Riverwalk", source: "listing", price: 234_999, sqft: 1_680 },
  { village: "The Isles", source: "plan", price: 835_995, sqft: 2_589 },
  { village: "The Isles", source: "listing", price: 2_100_000, sqft: 5_069 },
  { village: "Woodleaf Hammock", source: "listing", price: 799_000, sqft: 2_990 },
];

describe("planVillageUpdates", () => {
  const plan = planVillageUpdates(target, items, aggregateVillageRanges(rows));

  it("writes the items whose range moved, with before and after of the changed fields only", () => {
    const arbor = plan.updates.find((u) => u.itemId === "arbor");
    expect(arbor).toBeDefined();
    expect(arbor!.changed).toEqual(["priceRange", "priceRangeDropdown", "priceRangeNew", "squareFootageRange"]);
    expect(arbor!.after).toEqual({
      priceRange: "$300s - $900s",
      priceRangeDropdown: "Show All Price Ranges, $300s, $400s, $500s, $600s, $700s, $800s, $900s",
      priceRangeNew: ["$300s", "$400s", "$500s", "$600s", "$700s", "$800s", "$900s"],
      squareFootageRange: "1,600 - 3,900 square feet",
    });
    expect(arbor!.before.priceRange).toBe("$500s - $1M+");
    expect(arbor!.before.squareFootageRange).toBeUndefined();
    expect(arbor!.listings).toBe(2);
  });

  it("leaves an item alone when it already says what the range says", () => {
    expect(plan.unchanged).toEqual(["Aurora"]);
    expect(plan.updates.map((u) => u.itemId)).not.toContain("aurora");
  });

  it("matches on a secondary title field and prefers a published item over a draft of the same name", () => {
    expect(plan.updates.find((u) => u.itemId === "summerfield")?.after.priceRange).toBe("$200s");
    expect(plan.updates.find((u) => u.itemId === "isles")?.after.priceRange).toBe("$800s - $2M+");
    expect(plan.updates.map((u) => u.itemId)).not.toContain("isles-draft");
  });

  it("reports villages with no item and items with nothing for sale, writing neither", () => {
    expect(plan.unmatchedVillages).toEqual(["Woodleaf Hammock"]);
    expect(plan.itemsWithoutAvailability).toEqual(["Amber Creek", "The Isles"]);
    expect(plan.updates.map((u) => u.itemId)).not.toContain("amber");
  });

  it("counts what it saw", () => {
    expect(plan).toMatchObject({ domain: "lifeatlakewood.com", collectionId: "AmenitiesbyVillage", items: 6, villages: 5 });
  });
});
