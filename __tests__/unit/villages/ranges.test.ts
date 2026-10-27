import { describe, expect, it } from "vitest";
import {
  aggregateVillageRanges,
  countRangeText,
  homeTypeKind,
  homeTypeWords,
  optionsDropdown,
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
  wholeNumberTags,
  type VillageRow,
} from "@/lib/villages/ranges";
import { LAKEWOOD_PROFILE, WELLEN_PARK_PROFILE } from "@/lib/villages/profiles";

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
    // Both ends in the millions: one plus sign, on the high end.
    expect(priceRangeText(1_475_000, 4_245_000)).toBe("$1M - $4M+");
    expect(priceRangeText(2_000_000, 4_800_000)).toBe("$2M - $4M+");
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
    // A row of any kind means something is for sale: the flag goes true, nothing else is written.
    expect(rangeFields(lot, LAKEWOOD_PROFILE)).toEqual({ hasListingsOrNewConstruction: true, hasNewConstruction: false, buildYourHomeColor: "#A0A09F" });
  });
  it("writes only the fields a village has data for", () => {
    const [, palisades, star] = aggregateVillageRanges(rows);
    // Listings only: the Build Your Home button is grey.
    expect(rangeFields(palisades, LAKEWOOD_PROFILE)).toEqual({
      hasListingsOrNewConstruction: true,
      hasNewConstruction: false,
      buildYourHomeColor: "#A0A09F",
      priceRange: "$400s",
      priceRangeDropdown: "Show All Price Ranges, $400s",
      priceRangeNew: ["$400s"],
    });
    // Plans for sale: green.
    expect(rangeFields(star, LAKEWOOD_PROFILE)).toEqual({
      hasListingsOrNewConstruction: true,
      hasNewConstruction: true,
      buildYourHomeColor: "#2C9E37",
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
    expect(sameFieldValue(true, true)).toBe(true);
    expect(sameFieldValue(false, undefined)).toBe(false);
    expect(sameFieldValue("true", true)).toBe(false);
    expect(sameFieldValue("#2c9e37", "#2C9E37")).toBe(true);
    expect(sameFieldValue("#A0A09F", "#2C9E37")).toBe(false);
  });
});

describe("bedrooms, bathrooms, garages and home types", () => {
  it("maps each source's home type words to a kind", () => {
    expect(homeTypeKind("Single Family Home")).toBe("single-family");
    expect(homeTypeKind("Single Family Residence")).toBe("single-family");
    expect(homeTypeKind("Attached Villa")).toBe("villa");
    expect(homeTypeKind("Villa")).toBe("villa");
    expect(homeTypeKind("Townhouse")).toBe("townhome");
    expect(homeTypeKind("Townhome")).toBe("townhome");
    expect(homeTypeKind("Condominium")).toBe("condominium");
    expect(homeTypeKind("Garage Condo")).toBe("condominium");
    expect(homeTypeKind("Coach Home")).toBe("coach-home");
    expect(homeTypeKind("Mobile Home")).toBeNull();
    expect(homeTypeKind(null)).toBeNull();
  });

  it("puts the kinds in each site's words, folding where a site has no filter", () => {
    const kinds = ["single-family", "coach-home", "villa"] as const;
    // Lakewood: a coach home is a condominium; filter values singular.
    expect(homeTypeWords([...kinds], LAKEWOOD_PROFILE).map((w) => w.tag)).toEqual(["Single Family Home", "Villa", "Condominium"]);
    // Wellen Park: coach homes are their own filter; values plural.
    expect(homeTypeWords([...kinds], WELLEN_PARK_PROFILE).map((w) => w.tag)).toEqual(["Single Family Homes", "Villas", "Coach Homes"]);
    // A kind present twice after folding reads once.
    expect(homeTypeWords(["condominium", "coach-home"], LAKEWOOD_PROFILE).map((w) => w.tag)).toEqual(["Condominium"]);
  });

  it("writes counts the way the site does", () => {
    expect(countRangeText(2, 6)).toBe("2 - 6");
    expect(countRangeText(3, 3)).toBe("3");
    expect(countRangeText(2.5, 4.5)).toBe("2.5 - 4.5");
    expect(countRangeText(2, 3, " Car")).toBe("2 - 3 Car");
    expect(countRangeText(3, 3, " Car")).toBe("3 Car");
    expect(wholeNumberTags(2.5, 4.5)).toEqual(["2", "3", "4"]);
    expect(wholeNumberTags(2, 2.5)).toEqual(["2"]);
    expect(wholeNumberTags(0, 3, 1)).toEqual(["1", "2", "3"]);
    expect(wholeNumberTags(0, 0, 1)).toEqual([]);
    expect(optionsDropdown(["2", "3", "4"])).toBe("2, 3, 4, Show All");
  });

  const rows: VillageRow[] = [
    { village: "Palm Grove", source: "plan", price: 299_990, sqft: 1_533, beds: 2, baths: 2, garages: 1, homeType: "Townhome" },
    { village: "Palm Grove", source: "plan", price: 954_990, sqft: 3_494, beds: 5, baths: 4.5, garages: 3, homeType: "Single Family Home" },
    { village: "Palm Grove", source: "plan", price: 450_000, sqft: 1_700, beds: 3, baths: 2.5, garages: 2, homeType: "Attached Villa" },
    { village: "Palm Grove", source: "listing", price: 380_000, sqft: 1_600, beds: 3, baths: 2, garages: null, homeType: "Villa" },
    { village: "Calusa Country Club", source: "listing", price: 300_000, sqft: 1_154, beds: 2, baths: 2, garages: 0, homeType: "Condominium" },
    { village: "Calusa Country Club", source: "plan", price: 800_000, sqft: 3_025, beds: 4, baths: 3, garages: 3, homeType: "Single Family Home" },
    { village: "Lot Only", source: "listing", price: 45_000, sqft: 0, beds: 0, baths: 0, garages: 0, homeType: "Land" },
    { village: "Carport Condo", source: "listing", price: 250_000, sqft: 1_100, beds: 2, baths: 2, garages: 0, homeType: "Condominium" },
  ];
  const [calusa, carport, lot, palm] = aggregateVillageRanges(rows);

  it("spans both sources and orders the home types the way the dropdown lists them", () => {
    expect(palm).toMatchObject({ minBeds: 2, maxBeds: 5, minBaths: 2, maxBaths: 4.5, minGarages: 1, maxGarages: 3 });
    expect(palm.homeTypes).toEqual(["single-family", "villa", "townhome"]);
    expect(rangeFields(palm, LAKEWOOD_PROFILE)).toMatchObject({
      bedrooms: "2 - 5",
      bedroomsNew: ["2", "3", "4", "5"],
      bedroomsDropdown: "2, 3, 4, 5, Show All",
      bathrooms: "2 - 4.5",
      bathroomsNew: ["2", "3", "4"],
      bathroomsDropdown: "2, 3, 4, Show All",
      garages: "1 - 3 Car",
      garagesNew: ["1", "2", "3"],
      garagesDropdown: "1, 2, 3, Show All",
      homeTypeNew: ["Single Family Home", "Villa", "Townhome"],
      homeTypesDropdown: "Single Family Home, Attached Villas, Townhomes, Show All",
      homeTypes: "Single Family\nVillas\nTownhomes",
    });
  });

  it("keeps a 0-car low end in the text but not in the tags", () => {
    expect(rangeFields(calusa, LAKEWOOD_PROFILE)).toMatchObject({ garages: "0 - 3 Car", garagesNew: ["1", "2", "3"], garagesDropdown: "1, 2, 3, Show All" });
  });

  it("writes the garage text but no tags when nothing has a garage", () => {
    const fields = rangeFields(carport, LAKEWOOD_PROFILE);
    expect(fields.garages).toBe("0 Car");
    expect(fields.garagesNew).toBeUndefined();
    expect(fields.garagesDropdown).toBeUndefined();
  });

  it("takes no counts or types from a row that is not a home", () => {
    expect(lot).toMatchObject({ minBeds: null, minBaths: null, minGarages: null, homeTypes: [] });
    expect(rangeFields(lot, LAKEWOOD_PROFILE)).toEqual({ hasListingsOrNewConstruction: true, hasNewConstruction: false, buildYourHomeColor: "#A0A09F" });
  });
});

describe("Wellen Park's words", () => {
  const rows: VillageRow[] = [
    { village: "Palmera", source: "plan", price: 450_000, sqft: 1_900, beds: 2, baths: 2, garages: 2, homeType: "Coach Home" },
    { village: "Palmera", source: "plan", price: 1_200_000, sqft: 4_600, beds: 5, baths: 4, garages: 4, homeType: "Single Family Home" },
    { village: "Palmera", source: "listing", price: 600_000, sqft: 2_500, beds: 3, baths: 2.5, garages: 3, homeType: "Condominium" },
  ];
  const [palmera] = aggregateVillageRanges(rows);
  const fields = rangeFields(palmera, WELLEN_PARK_PROFILE);

  it("writes garage tags with the word Car and keeps coach homes as their own type", () => {
    expect(fields.garages).toBe("2 - 4 Car");
    expect(fields.garagesNew).toEqual(["2 Car", "3 Car", "4 Car"]);
    expect(fields.homeTypeNew).toEqual(["Single Family Homes", "Condominiums", "Coach Homes"]);
    expect(fields.homeTypes).toBe("Single Family, Condos, Coach Homes");
  });

  it("shares the price, size, bedroom and bathroom formats with Lakewood", () => {
    expect(fields.priceRange).toBe("$400s - $1M+");
    expect(fields.priceRangeNew).toEqual(["$400s", "$500s", "$600s", "$700s", "$800s", "$900s", "1M+"]);
    expect(fields.squareFootageRange).toBe("1,900 - 4,600 square feet");
    expect(fields.bedrooms).toBe("2 - 5");
    expect(fields.bedroomsNew).toEqual(["2", "3", "4", "5"]);
    expect(fields.bathrooms).toBe("2 - 4");
    expect(fields.bathroomsNew).toEqual(["2", "3", "4"]);
    expect(fields.buildYourHomeColor).toBe("#2C9E37");
    expect(fields.hasNewConstruction).toBe(true);
  });

  it("names no dropdown fields, so the sync never writes them there", () => {
    expect(WELLEN_PARK_PROFILE.fields.priceRangeDropdown).toBeNull();
    expect(WELLEN_PARK_PROFILE.fields.bedroomsDropdown).toBeNull();
    expect(WELLEN_PARK_PROFILE.fields.homeTypesDropdown).toBeNull();
    expect(WELLEN_PARK_PROFILE.fields.priceRangeNew).toBe("priceRangeTags");
    expect(WELLEN_PARK_PROFILE.fields.squareFootageRange).toBe("squareFeet");
  });
});
