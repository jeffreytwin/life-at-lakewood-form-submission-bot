import { describe, expect, it } from "vitest";
import {
  aggregateLiveListings,
  formatBedroomRange,
  formatGarageRange,
  formatPriceRange,
  formatSqftRange,
  parseGarageToken,
  parseIntToken,
  parsePriceToken,
  planVillageStatsUpdates,
  priceToken,
  readWixDate,
  widenGarageRange,
  widenHistoricalRange,
} from "@/lib/listings/village-stats";

const NOW = new Date("2026-09-15T20:00:00.000Z");

describe("range formatting (as the Velo pipeline wrote it)", () => {
  it("bands prices to the nearest $100k below $1M and $1M above, rounding down for a range", () => {
    expect(priceToken(550_000)).toBe("$600s");
    expect(priceToken(550_000, "floor")).toBe("$500s");
    expect(priceToken(950_000)).toBe("$1M");
    expect(priceToken(1_500_000, "floor")).toBe("$1M");
    expect(priceToken(1_500_000)).toBe("$2M");
    expect(priceToken(0)).toBeNull();
    expect(priceToken(null)).toBeNull();
    expect(formatPriceRange(525_000, 2_400_000)).toBe("$500s - $2M");
    expect(formatPriceRange(1_200_000, 1_900_000)).toBe("$1M");
    expect(formatPriceRange(undefined, 900_000)).toBeNull();
  });

  it("floors square feet to the hundred, keeps beds exact and one Car suffix on garages", () => {
    expect(formatSqftRange(1234, 4180)).toBe("1,200 - 4,100");
    expect(formatSqftRange(2050, 2099)).toBe("2,000");
    expect(formatBedroomRange(2, 4)).toBe("2 - 4");
    expect(formatBedroomRange(3, 3)).toBe("3");
    expect(formatGarageRange(1, 3)).toBe("1 - 3 Car");
    expect(formatGarageRange(2, 2)).toBe("2 Car");
    expect(formatGarageRange(undefined, 2)).toBeNull();
  });

  it("parses the hand-written tokens", () => {
    expect(parsePriceToken("$500s")).toBe(500_000);
    expect(parsePriceToken("$1.5M")).toBe(1_500_000);
    expect(parsePriceToken("$1,500,000")).toBe(1_500_000);
    expect(parsePriceToken("750000")).toBe(750_000);
    expect(parsePriceToken("n/a")).toBeNull();
    expect(parseIntToken("1,200")).toBe(1200);
    expect(parseGarageToken("2 Car")).toBe(2);
    expect(parseGarageToken("1.5 Cars")).toBe(1.5);
    expect(parseGarageToken("none")).toBeNull();
  });
});

describe("historical range ratchet", () => {
  const floorPrice = (v: number) => priceToken(v, "floor");

  it("only ever widens, keeping the untouched end verbatim", () => {
    expect(widenHistoricalRange("$500k - $2M", 450_000, 1_800_000, parsePriceToken, floorPrice)).toBe("$400s - $2M");
    expect(widenHistoricalRange("$500k - $2M", 550_000, 2_900_000, parsePriceToken, floorPrice)).toBeNull();
    expect(widenHistoricalRange("$500k - $2M", 550_000, 3_100_000, parsePriceToken, floorPrice)).toBe("$500k - $3M");
    expect(widenHistoricalRange("$500k - $2M", 600_000, 1_500_000, parsePriceToken, floorPrice)).toBeNull();
  });

  it("seeds a blank range from the active one and leaves unparseable text alone", () => {
    expect(widenHistoricalRange("", 425_000, 1_200_000, parsePriceToken, floorPrice)).toBe("$400s - $1M");
    expect(widenHistoricalRange(null, 1_200_000, 1_900_000, parsePriceToken, floorPrice)).toBe("$1M");
    expect(widenHistoricalRange("call for pricing", 425_000, 1_200_000, parsePriceToken, floorPrice)).toBeNull();
    expect(widenHistoricalRange("$500k - $2M", undefined, undefined, parsePriceToken, floorPrice)).toBeNull();
  });

  it("handles the garage suffix", () => {
    expect(widenGarageRange("1 - 3 Car", 1, 4)).toBe("1 - 4 Car");
    expect(widenGarageRange("2 Car", 2, 2)).toBeNull();
    expect(widenGarageRange("", 1, 2)).toBe("1 - 2 Car");
  });
});

describe("planVillageStatsUpdates", () => {
  const stats = aggregateLiveListings([
    { wix_item_id: "A", list_price: 525_000, living_area: 1234, bedrooms: 2, garage_spaces: 1 },
    { wix_item_id: "A", list_price: 2_400_000, living_area: 4180.4, bedrooms: 4, garage_spaces: 3 },
    { wix_item_id: "A", list_price: 0, living_area: 0, bedrooms: 0, garage_spaces: 0 }, // vacant land: counted, no ranges
    { wix_item_id: null, list_price: 900_000, living_area: 1500, bedrooms: 3, garage_spaces: 2 }, // no Wix item: ignored
  ]);

  it("writes the active ranges, the count and the historical widening for a neighborhood with listings", () => {
    const { updates, zeroInventory } = planVillageStatsUpdates(
      [{ _id: "A", _owner: "x", _createdDate: { $date: "2026-01-01T00:00:00.000Z" }, villageName: "Bay Isles", priceRange: "$600k - $2M", squareFeet: "", activeListingCount: 2, zeroSince: null }],
      stats,
      NOW
    );
    expect(zeroInventory).toBe(0);
    expect(updates).toEqual([
      {
        _id: "A",
        villageName: "Bay Isles",
        priceRange: "$500s - $2M",
        squareFeet: "1,200 - 4,100",
        bedroomRange: "2 - 4",
        garageSizeRange: "1 - 3 Car",
        priceRangeActive: "$500s - $2M",
        squareFeetActive: "1,200 - 4,100",
        bedroomRangeActive: "2 - 4",
        garageSizeRangeActive: "1 - 3 Car",
        activeListingCount: 3,
        zeroSince: null,
      },
    ]);
  });

  it("stamps zeroSince once when a neighborhood empties, keeps it while empty, and clears it on recovery", () => {
    const emptied = planVillageStatsUpdates([{ _id: "B", activeListingCount: 3, priceRangeActive: "$1M", zeroSince: null }], stats, NOW);
    expect(emptied.updates).toEqual([{ _id: "B", priceRangeActive: null, squareFeetActive: null, bedroomRangeActive: null, garageSizeRangeActive: null, activeListingCount: 0, zeroSince: { $date: NOW.toISOString() } }]);
    expect(emptied.zeroInventory).toBe(1);

    const stillEmpty = planVillageStatsUpdates([{ _id: "B", activeListingCount: 0, zeroSince: { $date: "2026-09-14T00:00:00.000Z" } }], stats, NOW);
    expect(stillEmpty.updates).toEqual([]);

    const recovered = planVillageStatsUpdates([{ _id: "A", activeListingCount: 0, zeroSince: { $date: "2026-09-14T00:00:00.000Z" }, priceRangeActive: "$500s - $2M", squareFeetActive: "1,200 - 4,100", bedroomRangeActive: "2 - 4", garageSizeRangeActive: "1 - 3 Car", priceRange: "$500s - $2M", squareFeet: "1,200 - 4,100", bedroomRange: "2 - 4", garageSizeRange: "1 - 3 Car" }], stats, NOW);
    expect(recovered.updates).toEqual([expect.objectContaining({ _id: "A", activeListingCount: 3, zeroSince: null })]);
  });

  it("leaves an unchanged row alone and skips rows without an id", () => {
    const { updates } = planVillageStatsUpdates(
      [
        { _id: "A", activeListingCount: 3, zeroSince: null, priceRangeActive: "$500s - $2M", squareFeetActive: "1,200 - 4,100", bedroomRangeActive: "2 - 4", garageSizeRangeActive: "1 - 3 Car", priceRange: "$400s - $3M", squareFeet: "1,000 - 5,000", bedroomRange: "1 - 5", garageSizeRange: "1 - 4 Car" },
        { villageName: "no id" },
      ],
      stats,
      NOW
    );
    expect(updates).toEqual([]);
  });

  it("reads Wix dates in either form", () => {
    expect(readWixDate({ $date: "2026-09-14T00:00:00.000Z" })?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(readWixDate("2026-09-14T00:00:00.000Z")?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(readWixDate("soon")).toBeNull();
    expect(readWixDate(null)).toBeNull();
  });
});
