import { describe, expect, it } from "vitest";
import {
  aggregateVillageRanges,
  priceBucket,
  priceBuckets,
  priceRangeDropdown,
  priceRangeTags,
  priceRangeText,
  rangeFields,
  roundSqft,
  sameFieldValue,
  sqftRangeText,
  villageKey,
  type VillageRow,
} from "@/lib/villages/ranges";

describe("villageKey", () => {
  it("ignores case, spacing, dash style and ampersands", () => {
    expect(villageKey("Azario – Esplanade")).toBe(villageKey("azario - esplanade"));
    expect(villageKey("Azario-Esplanade")).toBe(villageKey("Azario - Esplanade"));
    expect(villageKey("Esplanade Golf & Country Club")).toBe(villageKey("Esplanade Golf and Country Club"));
    expect(villageKey("  The Isles ")).toBe("the isles");
  });
  it("keeps distinct villages distinct", () => {
    expect(villageKey("Del Webb")).not.toBe(villageKey("Del Webb Catalina"));
  });
});

describe("price buckets", () => {
  it("files hundreds and millions the way the site does", () => {
    expect(priceBucket(379_900)).toBe("$300s");
    expect(priceBucket(999_999)).toBe("$900s");
    expect(priceBucket(1_000_000)).toBe("$1M+");
    expect(priceBucket(1_995_000)).toBe("$1M+");
    expect(priceBucket(2_349_000)).toBe("$2M+");
    expect(priceBucket(6_995_000)).toBe("$6M+");
  });
  it("lists every bucket from the low end to the high", () => {
    expect(priceBuckets(399_999, 1_995_000)).toEqual(["$300s", "$400s", "$500s", "$600s", "$700s", "$800s", "$900s", "$1M+"]);
    expect(priceBuckets(2_000_000, 4_800_000)).toEqual(["$2M+", "$3M+", "$4M+"]);
    expect(priceBuckets(419_990, 465_000)).toEqual(["$400s"]);
  });
  it("formats the text, dropdown and tags", () => {
    expect(priceRangeText(399_999, 1_995_000)).toBe("$300s - $1M+");
    expect(priceRangeText(419_990, 465_000)).toBe("$400s");
    expect(priceRangeText(1_399_990, 1_632_990)).toBe("$1M+");
    const buckets = priceBuckets(594_500, 1_050_000);
    expect(priceRangeDropdown(buckets)).toBe("Show All Price Ranges, $500s, $600s, $700s, $800s, $900s, $1M+");
    expect(priceRangeTags(buckets)).toEqual(["$500s", "$600s", "$700s", "$800s", "$900s", "1M+"]);
  });
});

describe("square footage", () => {
  it("rounds to the nearest hundred and reads as a range", () => {
    expect(roundSqft(1_571)).toBe(1_600);
    expect(roundSqft(3_849)).toBe(3_800);
    expect(roundSqft(3_850)).toBe(3_900);
    expect(sqftRangeText(2_380, 5_983)).toBe("2,400 - 6,000 square feet");
    expect(sqftRangeText(1_746, 1_772)).toBe("1,700 - 1,800 square feet");
    expect(sqftRangeText(1_820, 1_840)).toBe("1,800 square feet");
  });
});

describe("aggregateVillageRanges", () => {
  const rows: VillageRow[] = [
    { village: "Star Farms", source: "plan", price: 294_990, sqft: 1_463 },
    { village: "Star Farms", source: "plan", price: 3_200_000, sqft: 5_751 },
    { village: "star farms", source: "listing", price: 339_000, sqft: 1_504 },
    { village: "Star Farms", source: "listing", price: 2_000_000, sqft: 4_522 },
    { village: "Palisades", source: "listing", price: 419_990, sqft: null },
    { village: "Palisades", source: "listing", price: 465_000, sqft: null },
    { village: "Lot Only", source: "listing", price: 45_000, sqft: 0 },
    { village: "", source: "plan", price: 500_000, sqft: 2_000 },
  ];
  it("takes the low and high across both sources, counting each", () => {
    const [, , star] = aggregateVillageRanges(rows);
    expect(star).toMatchObject({ village: "Star Farms", plans: 2, listings: 2, minPrice: 294_990, maxPrice: 3_200_000, minSqft: 1_463, maxSqft: 5_751 });
  });
  it("leaves out implausible prices and sizes, and nameless rows", () => {
    const ranges = aggregateVillageRanges(rows);
    expect(ranges.map((r) => r.village)).toEqual(["Lot Only", "Palisades", "Star Farms"]);
    const lot = ranges[0];
    expect(lot).toMatchObject({ listings: 1, minPrice: null, maxPrice: null, minSqft: null, maxSqft: null });
    expect(rangeFields(lot)).toEqual({});
  });
  it("writes only the fields a village has data for", () => {
    const [, palisades, star] = aggregateVillageRanges(rows);
    expect(rangeFields(palisades)).toEqual({
      priceRange: "$400s",
      priceRangeDropdown: "Show All Price Ranges, $400s",
      priceRangeNew: ["$400s"],
    });
    expect(rangeFields(star)).toEqual({
      priceRange: "$200s - $3M+",
      priceRangeDropdown: "Show All Price Ranges, $200s, $300s, $400s, $500s, $600s, $700s, $800s, $900s, $1M+, $2M+, $3M+",
      priceRangeNew: ["$200s", "$300s", "$400s", "$500s", "$600s", "$700s", "$800s", "$900s", "1M+", "2M+", "3M+"],
      squareFootageRange: "1,500 - 5,800 square feet",
    });
  });
});

describe("sameFieldValue", () => {
  it("compares text ignoring edge spaces and tags in order", () => {
    expect(sameFieldValue("$400s - $1M+ ", "$400s - $1M+")).toBe(true);
    expect(sameFieldValue(["$400s", "1M+"], ["$400s", "1M+"])).toBe(true);
    expect(sameFieldValue(["1M+", "$400s"], ["$400s", "1M+"])).toBe(false);
    expect(sameFieldValue(undefined, "$400s")).toBe(false);
    expect(sameFieldValue("$400s", ["$400s"])).toBe(false);
  });
});
