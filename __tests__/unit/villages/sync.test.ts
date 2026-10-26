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
import { garageCount, listingBaths, listingGarages, planVillageUpdates, VILLAGE_RANGE_TARGETS } from "@/lib/villages/sync";
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
    bedrooms: "2 - 6",
    bedroomsNew: ["2", "3", "4", "5", "6"],
    bedroomsDropdown: "2, 3, 4, 5, 6, Show All",
    homeTypeNew: ["Single Family Home", "Villa"],
    homeTypesDropdown: "Single Family Home, Attached Villas, Show All",
    homeTypes: "Single Family\nVillas",
    hasListingsOrNewConstruction: true,
    buildYourHomeColor: "#A0A09F",
    description: "Gated, with a clubhouse.",
  }),
  item("aurora", {
    title: "Aurora",
    hasListingsOrNewConstruction: true,
    buildYourHomeColor: "#A0A09F",
    priceRange: "$200s - $400s",
    priceRangeDropdown: "Show All Price Ranges, $200s, $300s, $400s",
    priceRangeNew: ["$200s", "$300s", "$400s"],
    squareFootageRange: "1,400 - 2,200 square feet",
  }),
  item("amber", { title: "Amber Creek", priceRange: "$300s", hasListingsOrNewConstruction: true, buildYourHomeColor: "#2C9E37" }),
  item("hidden", { title: "Sold Out Village", priceRange: "$500s", hasListingsOrNewConstruction: false, buildYourHomeColor: "#a0a09f" }),
  item("summerfield", { title: "Summerfield", villagesTitle: "Summerfield & Riverwalk", priceRange: "$200s - $800s" }),
  item("isles-draft", { title: "The Isles", _publishStatus: "DRAFT", priceRange: "old" }),
  item("isles", { title: "The Isles", priceRange: "$1M+ - $2M+" }),
];

const rows: VillageRow[] = [
  { village: "Arbor Grande", source: "listing", price: 379_900, sqft: 1_571, beds: 2, baths: 2, garages: 2, homeType: "Villa" },
  { village: "Arbor Grande", source: "listing", price: 999_999, sqft: 3_899, beds: 6, baths: 4.5, garages: 3, homeType: "Single Family Residence" },
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
    // Bedrooms and home types already say what the range says: not among the changed fields.
    expect(arbor!.changed).toEqual([
      "priceRange",
      "priceRangeDropdown",
      "priceRangeNew",
      "squareFootageRange",
      "bathrooms",
      "bathroomsNew",
      "bathroomsDropdown",
      "garages",
      "garagesNew",
      "garagesDropdown",
    ]);
    expect(arbor!.after).toEqual({
      priceRange: "$300s - $900s",
      priceRangeDropdown: "Show All Price Ranges, $300s, $400s, $500s, $600s, $700s, $800s, $900s",
      priceRangeNew: ["$300s", "$400s", "$500s", "$600s", "$700s", "$800s", "$900s"],
      squareFootageRange: "1,600 - 3,900 square feet",
      bathrooms: "2 - 4.5",
      bathroomsNew: ["2", "3", "4"],
      bathroomsDropdown: "2, 3, 4, Show All",
      garages: "2 - 3 Car",
      garagesNew: ["2", "3"],
      garagesDropdown: "2, 3, Show All",
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

  it("reports villages with no item, writing nothing for them", () => {
    expect(plan.unmatchedVillages).toEqual(["Woodleaf Hammock"]);
  });

  it("flags an item with nothing for sale false, greys its button, and touches nothing else on it", () => {
    expect(plan.itemsWithoutAvailability).toEqual(["Amber Creek", "Sold Out Village"]);
    const amber = plan.updates.find((u) => u.itemId === "amber");
    expect(amber).toBeDefined();
    expect(amber!.changed).toEqual(["hasListingsOrNewConstruction", "buildYourHomeColor"]);
    expect(amber!.after).toEqual({ hasListingsOrNewConstruction: false, buildYourHomeColor: "#A0A09F" });
    expect(amber!.before).toEqual({ hasListingsOrNewConstruction: true, buildYourHomeColor: "#2C9E37" });
    // Already false and grey (whatever the hex case): no write.
    expect(plan.updates.map((u) => u.itemId)).not.toContain("hidden");
    // A draft copy of a village that has a range is neither flagged nor written.
    expect(plan.updates.map((u) => u.itemId)).not.toContain("isles-draft");
  });

  it("flags a village with homes true along with its ranges", () => {
    expect(plan.updates.find((u) => u.itemId === "summerfield")?.after.hasListingsOrNewConstruction).toBe(true);
    expect(plan.updates.find((u) => u.itemId === "arbor")?.changed).not.toContain("hasListingsOrNewConstruction");
  });

  it("colours the Build Your Home button green with a plan for sale and grey without", () => {
    // The Isles has a plan; Arbor Grande (listings only) already reads grey.
    expect(plan.updates.find((u) => u.itemId === "isles")?.after.buildYourHomeColor).toBe("#2C9E37");
    expect(plan.updates.find((u) => u.itemId === "arbor")?.changed).not.toContain("buildYourHomeColor");
    expect(plan.updates.find((u) => u.itemId === "summerfield")?.after.buildYourHomeColor).toBe("#A0A09F");
  });

  it("counts what it saw", () => {
    expect(plan).toMatchObject({ domain: "lifeatlakewood.com", collectionId: "AmenitiesbyVillage", items: 7, villages: 5 });
  });
});

describe("listing and plan field readers", () => {
  it("reads garage bays off the builders' text", () => {
    expect(garageCount("3 car")).toBe(3);
    expect(garageCount("2-Car Garage")).toBe(2);
    expect(garageCount("0 car")).toBe(0);
    expect(garageCount(null)).toBeNull();
    expect(garageCount("none")).toBeNull();
  });
  it("counts a half bath as a half, falling back to the MLS total", () => {
    expect(listingBaths({ bathrooms: "3", baths_full: "2", baths_half: "1" })).toBe(2.5);
    expect(listingBaths({ bathrooms: "2", baths_full: "2", baths_half: null })).toBe(2);
    expect(listingBaths({ bathrooms: "3", baths_full: null, baths_half: null })).toBe(3);
  });
  it("takes GarageSpaces, else a stated no-garage, else nothing", () => {
    expect(listingGarages({ garage_spaces: "2", garage_yn: "true" })).toBe(2);
    expect(listingGarages({ garage_spaces: null, garage_yn: "false" })).toBe(0);
    expect(listingGarages({ garage_spaces: "0", garage_yn: "false" })).toBe(0);
    expect(listingGarages({ garage_spaces: "0", garage_yn: null })).toBe(0);
    expect(listingGarages({ garage_spaces: null, garage_yn: "true" })).toBeNull();
    expect(listingGarages({ garage_spaces: null, garage_yn: null })).toBeNull();
  });
  it("treats a garage with 0 spaces as unknown, not as no garage", () => {
    expect(listingGarages({ garage_spaces: "0", garage_yn: "true" })).toBeNull();
  });
});
