// ls_listings row + village + gallery -> the HousesforSale-shaped record a
// site's collection expects. A faithful port of transformListing in the
// Longboat Key Velo backend (backend/sync/pipeline.jsw), so a row the engine
// writes is indistinguishable from one the old pipeline wrote, except that
// gallery items carry the photo's stable path key instead of an MLS URL.

import { createHash } from "node:crypto";
import type { WixItemData } from "@/lib/wix/client";
import type { GalleryItem, LsListingRow, MlsGridProperty, VillageWithTerms } from "@/lib/listings/types";

export function titleCase(s: unknown): string {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatPrice(n: unknown): unknown {
  if (typeof n !== "number") return n;
  return `$${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function priceBucket(n: unknown): string {
  if (typeof n !== "number") return String(n);
  if (n < 500000) return "Under $500k";
  if (n < 1000000) return "$500k - $1M";
  if (n < 2000000) return "$1M - $2M";
  if (n < 5000000) return "$2M - $5M";
  if (n < 10000000) return "$5M - $10M";
  if (n < 15000000) return "$10M - $15M";
  return "$15M+";
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
}

/** The record for the site's collection, keyed by the MLS ListingId. */
export function buildListingRecord({ listing, village, gallery, pulledAt }: BuildRecordInput): WixItemData {
  const raw = listing.raw as unknown as MlsGridProperty;
  const { propertyAddress, addressObject } = buildAddress(raw);
  const display = (village.display ?? {}) as Record<string, unknown>;
  const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
  // Vacant land carries no bed/bath/living area; explicit zeros keep the
  // display uniform and lotSize replaces the bd/ba/sqft strip.
  const isLand = (raw.PropertyType ?? "").toLowerCase() === "land";
  const bedrooms = raw.BedroomsTotal != null ? raw.BedroomsTotal : isLand ? 0 : raw.BedroomsTotal;
  const bathrooms = raw.BathroomsTotalInteger != null ? raw.BathroomsTotalInteger : isLand ? 0 : raw.BathroomsTotalInteger;

  return {
    _id: listing.listing_id,
    propertyAddress,
    propertyAddressGoogleMaps: addressObject,
    listingPrimaryImage: gallery[0]?.src ?? null,
    listingPrice: formatPrice(raw.ListPrice),
    listingPricePure: raw.ListPrice ?? null,
    listingPriceSort: [priceBucket(raw.ListPrice)],
    // PropertySubType is blank for vacant land in the mfrmls feed; fall
    // back to the PropertyType so the Home Type filter stays usable.
    homeType: raw.PropertySubType || titleCase(raw.PropertyType),
    village: village.name,
    village1: village.wix_item_id,
    villageLink: village.page_url,
    villageSortHelp: text(display.villageSortHelp, village.name),
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
    garages: `${raw.GarageSpaces == null ? 0 : raw.GarageSpaces} Car`,
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
  };
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
