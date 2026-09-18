// ls_listings row + village + gallery -> the HousesforSale-shaped record a
// site's collection expects. A faithful port of transformListing in the
// Longboat Key Velo backend (backend/sync/pipeline.jsw), so a row the engine
// writes is indistinguishable from one the old pipeline wrote, except that
// gallery items carry the photo's stable path key instead of an MLS URL.

import { createHash } from "node:crypto";
import type { WixItemData } from "@/lib/wix/client";
import type { GalleryItem, LsListingRow, MlsGridProperty, PriceSortStyle, VillageWithTerms } from "@/lib/listings/types";

export function titleCase(s: unknown): string {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatPrice(n: unknown): unknown {
  if (typeof n !== "number") return n;
  return `$${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * The price filter tag, in the scheme the site's own pages expect. The two
 * schemes are not interchangeable: a site filtering on "$600s" matches
 * nothing when the row says "$500k - $1M".
 *
 * - ranges: Longboat Key's, ported from its pipeline.
 * - shorthand: the older Velo `getNumber`, which produced what is in the
 *   Parrish collection today. Reproduced exactly, digit slicing and all:
 *   624,900 -> "$600s", 3,295,000 -> "3M+", 12,000,000 -> "12M+".
 */
export function priceBucket(n: unknown, style: PriceSortStyle = "ranges"): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return String(n);
  return style === "shorthand" ? shorthandBucket(n) : rangeBucket(n);
}

function rangeBucket(n: number): string {
  if (n < 500000) return "Under $500k";
  if (n < 1000000) return "$500k - $1M";
  if (n < 2000000) return "$1M - $2M";
  if (n < 5000000) return "$2M - $5M";
  if (n < 10000000) return "$5M - $10M";
  if (n < 15000000) return "$10M - $15M";
  return "$15M+";
}

function shorthandBucket(n: number): string {
  const digits = Math.trunc(Math.abs(n)).toString();
  if (digits.length === 6) return `$${digits.slice(0, 1)}00s`;
  if (digits.length >= 7 && digits.length <= 9) return `${digits.slice(0, digits.length - 6)}M+`;
  return `$${digits}`;
}

export function formatSquareFeet(v: unknown): string {
  if (v === undefined || v === null) return "0";
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Lot size for the listing page's headline stat on vacant land. */
export function formatLotSize(raw: MlsGridProperty): string {
  const acres = typeof raw.LotSizeAcres === "number" ? raw.LotSizeAcres : null;
  const sqft = typeof raw.LotSizeSquareFeet === "number" ? raw.LotSizeSquareFeet : null;
  if (acres != null && acres >= 0.5) return `${Math.round(acres * 100) / 100}-acre lot`;
  if (sqft != null && sqft > 0) return `${formatSquareFeet(Math.round(sqft))} sqft lot`;
  if (acres != null && acres > 0) return `${acres}-acre lot`;
  return "";
}

export function buildAddress(raw: MlsGridProperty): {
  propertyAddress: string;
  addressObject: Record<string, unknown>;
} {
  const street = [raw.StreetNumber, titleCase(raw.StreetName), titleCase(raw.StreetSuffix)].filter(Boolean).join(" ");
  // The unit number keeps two units in one building from sharing the
  // dynamic page URL, which propertyAddress drives.
  const unit = raw.UnitNumber ? ` Unit ${raw.UnitNumber}` : "";
  const propertyAddress = `${street}${unit}, ${titleCase(raw.City)}, ${raw.StateOrProvince ?? ""} ${raw.PostalCode ?? ""}`;
  const addressObject = {
    city: raw.City,
    location: { latitude: raw.Latitude, longitude: raw.Longitude },
    streetAddress: { number: raw.StreetNumber, name: titleCase(raw.StreetName), apt: raw.UnitNumber || "" },
    country: raw.Country,
    postalCode: raw.PostalCode,
    formatted: `${propertyAddress}, ${raw.Country ?? ""}`,
    subdivision: raw.SubdivisionName,
  };
  return { propertyAddress, addressObject };
}

const wixDate = (d: Date | string | null | undefined): { $date: string } | null => {
  if (!d) return null;
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  return Number.isNaN(t) ? null : { $date: new Date(t).toISOString() };
};

export interface BuildRecordInput {
  listing: Pick<LsListingRow, "listing_id" | "raw" | "modification_timestamp">;
  village: VillageWithTerms;
  gallery: GalleryItem[];
  pulledAt: Date;
  /** The site's price filter scheme; Longboat Key's ranges when not given. */
  priceSortStyle?: PriceSortStyle;
  /** The site's own field names, where they differ from the engine's; see applyFieldMap. */
  fieldMap?: Record<string, string> | null;
  /** Which record shape the site's page code reads; see RecordStyle. */
  recordStyle?: RecordStyle;
}

/**
 * Which shape of record a site's page code reads.
 *
 * "standard" is what Longboat Key, Parrish and Wellen Park were built
 * against. "lakewood" is the original site's, and it differs in ways only its
 * own page code could reveal (Jeff sent it on 2026-09-18):
 *
 *  - **Filters are multi-value, with a "Show All" sentinel.** Every row
 *    carries the literal string "Show All" in villageSort, homeTypeSort and
 *    bedroomsSort, which is what makes each filter's "Show All" option match
 *    everything. Writing a plain string into those fields breaks the filter
 *    quietly, so the first field_map -- which renamed villageSortHelp to
 *    villageSort and nothing more -- was wrong, and is corrected here.
 *
 *  - **Three sort fields the standard record has no equivalent for**:
 *    homeTypeSort, bedroomsSort, garagesSort. Without them those filters go
 *    blank on every engine-written row, and nothing would have said so.
 *
 *  - The sentinel is NOT on listingPriceSort, bathroomsSort or garagesSort.
 *    That asymmetry is the site's, not a mistake here -- it is exactly what
 *    its dashboard writes.
 *
 *  - **galleryImage** is a constant camera badge on every row.
 *
 * Named after the site rather than abstracted, because one site is all the
 * evidence there is. The fifth site gets looked at before this grows a third
 * value.
 */
export type RecordStyle = "standard" | "lakewood";

/** Life At Lakewood's filters match everything on this sentinel; see RecordStyle. */
const SHOW_ALL = "Show All";

/** The camera badge Life At Lakewood puts on every row, from its own dashboard code. */
const LAKEWOOD_GALLERY_BADGE =
  "wix:image://v1/d0be81_521cf9f5f881464ab7c3e22109389117~mv2.png/camera%20gallery.png#originWidth=4800&originHeight=1369";

/**
 * Renames the engine's field keys to a site's own, for collections that named
 * the same thing differently before the engine existed.
 *
 * Life At Lakewood is the original site and its collection predates all of
 * this: it calls villageSortHelp `villageSort` and
 * listingBrokerageContactInformation `listingBrokerContactInfo`. Its page
 * code reads those names, so writing the engine's names would land the data
 * in fields nothing renders -- an empty neighborhood sort and, worse, no
 * brokerage attribution, which the MLS requires be displayed.
 *
 * The alternative was adding the engine's names alongside the site's, which
 * is what Wellen Park did: its collection carries both
 * `Listing Broker Contact Information` and
 * `listingBrokerageContactInformation`. That works but leaves two fields
 * meaning one thing, and the next site drifts its own way again.
 *
 * `_id` is never remapped: it is the listing id, and deleteStaleRows and
 * loadOwnedIds both match on it.
 */
export function applyFieldMap(record: WixItemData, fieldMap?: Record<string, string> | null): WixItemData {
  if (!fieldMap) return record;
  const entries = Object.entries(fieldMap).filter(([from, to]) => from && to && from !== to && from !== "_id");
  if (!entries.length) return record;
  const renames = new Map(entries);
  const out: WixItemData = {};
  for (const [key, value] of Object.entries(record)) out[renames.get(key) ?? key] = value;
  return out;
}

/** The record for the site's collection, keyed by the MLS ListingId. */
export function buildListingRecord({ listing, village, gallery, pulledAt, priceSortStyle, fieldMap, recordStyle }: BuildRecordInput): WixItemData {
  const raw = listing.raw as unknown as MlsGridProperty;
  const { propertyAddress, addressObject } = buildAddress(raw);
  const display = (village.display ?? {}) as Record<string, unknown>;
  const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
  // Vacant land carries no bed/bath/living area; explicit zeros keep the
  // display uniform and lotSize replaces the bd/ba/sqft strip.
  const isLand = (raw.PropertyType ?? "").toLowerCase() === "land";
  const bedrooms = raw.BedroomsTotal != null ? raw.BedroomsTotal : isLand ? 0 : raw.BedroomsTotal;
  const bathrooms = raw.BathroomsTotalInteger != null ? raw.BathroomsTotalInteger : isLand ? 0 : raw.BathroomsTotalInteger;

  // The neighborhood sort label, and the filter fields whose shape is the
  // site's rather than the engine's.
  const sortLabel = text(display.villageSortHelp, village.name);
  const homeType = raw.PropertySubType || titleCase(raw.PropertyType);
  const garageSpaces = raw.GarageSpaces == null ? 0 : raw.GarageSpaces;
  const sortFields: WixItemData =
    recordStyle === "lakewood"
      ? {
          villageSort: [sortLabel, SHOW_ALL],
          homeTypeSort: [homeType, SHOW_ALL],
          bedroomsSort: [String(bedrooms ?? 0), SHOW_ALL],
          garagesSort: [String(garageSpaces)],
          galleryImage: LAKEWOOD_GALLERY_BADGE,
        }
      : { villageSortHelp: sortLabel };

  return applyFieldMap({
    _id: listing.listing_id,
    propertyAddress,
    propertyAddressGoogleMaps: addressObject,
    listingPrimaryImage: gallery[0]?.src ?? null,
    listingPrice: formatPrice(raw.ListPrice),
    listingPricePure: raw.ListPrice ?? null,
    listingPriceSort: [priceBucket(raw.ListPrice, priceSortStyle)],
    // PropertySubType is blank for vacant land in the mfrmls feed; fall
    // back to the PropertyType so the Home Type filter stays usable.
    homeType,
    village: village.name,
    village1: village.wix_item_id,
    villageLink: village.page_url,
    ...sortFields,
    blueTag1: text(display.blueTag1),
    purpleTag1: text(display.purpleTag1),
    greenTag1: text(display.greenTag1),
    bedrooms: bedrooms ?? null,
    listingAgentName: raw.ListAgentFullName ?? null,
    listingAgentMls: raw.ListAgentMlsId ?? null,
    listingAgentPhone: raw.ListAgentDirectPhone ?? null,
    listingAgentCompany: raw.ListOfficeName ?? null,
    listingBrokerageContactInformation: raw.MFR_AttributionContact ?? null,
    bathrooms: bathrooms ?? null,
    bathroomsSort: [Math.ceil(raw.BathroomsTotalInteger || 0).toString()],
    garages: `${garageSpaces} Car`,
    squareFeet: formatSquareFeet(raw.LivingArea),
    lotSize: formatLotSize(raw),
    propertyDescription: raw.PublicRemarks ?? null,
    listingImageGallery: gallery,
    standardStatus: raw.StandardStatus ?? null,
    mlgCanView: raw.MlgCanView != null ? String(raw.MlgCanView) : null,
    virtualTourUrl: raw.VirtualTourURLUnbranded ?? null,
    modificationTimestamp: wixDate(listing.modification_timestamp ?? raw.ModificationTimestamp ?? null),
    subdivision: raw.SubdivisionName ? raw.SubdivisionName.replace("SAVANNAH", "SAVANNA") : null,
    dateOfMlsPull: wixDate(pulledAt),
    isPublished: true,
  }, fieldMap);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}

/**
 * Stable hash of what a record displays, so an unchanged listing is not
 * rewritten every run. The pull date is excluded: it is refreshed on a
 * schedule of its own (MLSGrid compliance), not on content changes.
 */
export function recordFingerprint(record: WixItemData): string {
  const copy: Record<string, unknown> = { ...record };
  delete copy.dateOfMlsPull;
  return createHash("sha256").update(JSON.stringify(stable(copy))).digest("hex");
}
