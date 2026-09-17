import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/listings/mlsgrid-property.json";
import { normalizeListing } from "@/lib/listings/normalize";
import {
  buildAddress,
  buildListingRecord,
  formatLotSize,
  formatPrice,
  priceBucket,
  recordFingerprint,
} from "@/lib/listings/transform";
import type { GalleryItem, MlsGridProperty, VillageWithTerms } from "@/lib/listings/types";

const raw = fixture as unknown as MlsGridProperty;
const pulledAt = new Date("2026-09-14T15:10:00.000Z");
const { listing } = normalizeListing(raw, pulledAt);

const village: VillageWithTerms = {
  id: "v1",
  site_id: "site",
  name: "Bay Isles - Harbor Section",
  wix_slug: "bay-isles-harbor-section",
  wix_item_id: "bc8b3074-9ef5-4cf7-88bd-1886c7df5c8e",
  page_url: "https://www.lifeinlongboatkey.com/neighborhood/bay-isles-harbor-section",
  display: { blueTag1: "https://static.wixstatic.com/media/blue.png" },
  active: true,
  active_listing_count: 0,
  zero_since: null,
  terms: [{ term: "bay isles", street_term: null, exclude_term: null }],
};

const gallery: GalleryItem[] = [
  { type: "Image", title: "Front", src: "wix:image://v1/d0be81_a~mv2.jpg/1.jpg#originWidth=1600&originHeight=898", order: 1, mlsPathKey: "images/MFR783588094/1.jpeg" },
  { type: "Image", title: "Kitchen", src: "wix:image://v1/d0be81_b~mv2.jpg/2.jpg#originWidth=1600&originHeight=898", order: 2, mlsPathKey: "images/MFR783588094/2.jpeg" },
];

describe("formatting helpers", () => {
  it("formats prices, buckets, and lot sizes like the Velo pipeline", () => {
    expect(formatPrice(1395000)).toBe("$1,395,000");
    expect(formatPrice(null)).toBeNull();
    expect(priceBucket(450000)).toBe("Under $500k");
    expect(priceBucket(1395000)).toBe("$1M - $2M");
    expect(priceBucket(20000000)).toBe("$15M+");
    expect(formatLotSize({ ListingId: "x", LotSizeAcres: 0.75 })).toBe("0.75-acre lot");
    expect(formatLotSize({ ListingId: "x", LotSizeSquareFeet: 12000 })).toBe("12,000 sqft lot");
    expect(formatLotSize({ ListingId: "x", LotSizeAcres: 0.2 })).toBe("0.2-acre lot");
    expect(formatLotSize({ ListingId: "x" })).toBe("");
  });

  it("builds the address with the unit number so two units never share a page URL", () => {
    expect(buildAddress(raw).propertyAddress).toBe("3040 Grand Bay Boulevard Unit 215, Longboat Key, FL 34228");
    expect(buildAddress(raw).addressObject).toMatchObject({
      city: "Longboat Key",
      streetAddress: { number: "3040", name: "Grand Bay", apt: "215" },
      subdivision: "BAY ISLES HARBOR SECTION",
    });
  });
});

describe("buildListingRecord", () => {
  it("produces the HousesforSale shape keyed by the ListingId", () => {
    const record = buildListingRecord({ listing, village, gallery, pulledAt });
    expect(record).toMatchObject({
      _id: "MFRA4670555",
      propertyAddress: "3040 Grand Bay Boulevard Unit 215, Longboat Key, FL 34228",
      listingPrimaryImage: "wix:image://v1/d0be81_a~mv2.jpg/1.jpg#originWidth=1600&originHeight=898",
      listingPrice: "$1,395,000",
      listingPricePure: 1395000,
      listingPriceSort: ["$1M - $2M"],
      homeType: "Condominium",
      village: "Bay Isles - Harbor Section",
      village1: "bc8b3074-9ef5-4cf7-88bd-1886c7df5c8e",
      villageLink: "https://www.lifeinlongboatkey.com/neighborhood/bay-isles-harbor-section",
      villageSortHelp: "Bay Isles - Harbor Section",
      blueTag1: "https://static.wixstatic.com/media/blue.png",
      purpleTag1: "",
      bedrooms: 3,
      bathrooms: 3,
      bathroomsSort: ["3"],
      garages: "1 Car",
      squareFeet: "2,143",
      lotSize: "",
      standardStatus: "Active",
      mlgCanView: "true",
      subdivision: "BAY ISLES HARBOR SECTION",
      modificationTimestamp: { $date: "2026-09-14T15:02:11.000Z" },
      dateOfMlsPull: { $date: "2026-09-14T15:10:00.000Z" },
      isPublished: true,
    });
    expect(record.listingImageGallery).toEqual(gallery);
    expect(JSON.stringify(record)).not.toContain("media.mlsgrid.com");
  });

  it("gives vacant land explicit zero beds and baths and a lot size", () => {
    const landRaw: MlsGridProperty = { ...raw, PropertyType: "Land", PropertySubType: "", BedroomsTotal: undefined, BathroomsTotalInteger: undefined, LivingArea: undefined, LotSizeAcres: 1.2 };
    const land = normalizeListing(landRaw, pulledAt).listing;
    const record = buildListingRecord({ listing: land, village, gallery, pulledAt });
    expect(record).toMatchObject({ homeType: "Land", bedrooms: 0, bathrooms: 0, squareFeet: "0", lotSize: "1.2-acre lot" });
  });
});

describe("recordFingerprint", () => {
  it("ignores the pull date and key order but not content", () => {
    const a = buildListingRecord({ listing, village, gallery, pulledAt });
    const b = buildListingRecord({ listing, village, gallery, pulledAt: new Date("2026-09-15T15:10:00.000Z") });
    expect(recordFingerprint(a)).toBe(recordFingerprint(b));
    const c = buildListingRecord({ listing: { ...listing, raw: { ...listing.raw, ListPrice: 1295000 } }, village, gallery, pulledAt });
    expect(recordFingerprint(c)).not.toBe(recordFingerprint(a));
  });
});

/**
 * Jeff, 2026-09-16: Parrish's live collection tags prices the way the older
 * Velo getNumber did, not the way Longboat Key's pipeline does. A site
 * filtering on "$600s" matches nothing when the row says "$500k - $1M", so
 * the scheme travels with the site.
 */
describe("priceBucket shorthand (the Velo getNumber scheme)", () => {
  it("reads a six-figure price as its hundreds bracket", () => {
    expect(priceBucket(624900, "shorthand")).toBe("$600s");
    expect(priceBucket(334900, "shorthand")).toBe("$300s");
    expect(priceBucket(999999, "shorthand")).toBe("$900s");
    expect(priceBucket(100000, "shorthand")).toBe("$100s");
  });

  it("reads a seven-to-nine figure price in millions", () => {
    expect(priceBucket(1200000, "shorthand")).toBe("1M+");
    expect(priceBucket(3295000, "shorthand")).toBe("3M+");
    expect(priceBucket(9999999, "shorthand")).toBe("9M+");
    expect(priceBucket(12000000, "shorthand")).toBe("12M+");
    expect(priceBucket(123000000, "shorthand")).toBe("123M+");
  });

  it("falls back to the plain number below six figures, as the original did", () => {
    expect(priceBucket(99000, "shorthand")).toBe("$99000");
  });

  it("leaves Longboat Key on the ranges it already uses", () => {
    expect(priceBucket(624900)).toBe("$500k - $1M");
    expect(priceBucket(624900, "ranges")).toBe("$500k - $1M");
  });

  it("puts the site's scheme on the record it writes", () => {
    const shorthand = buildListingRecord({ listing, village, gallery, pulledAt, priceSortStyle: "shorthand" });
    expect(shorthand.listingPriceSort).toEqual(["1M+"]);
    const ranges = buildListingRecord({ listing, village, gallery, pulledAt });
    expect(ranges.listingPriceSort).toEqual(["$1M - $2M"]);
  });
});
