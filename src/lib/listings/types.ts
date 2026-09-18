// Listings engine: shared shapes. Rows mirror supabase/migrations/043 (the
// ls_ tables); MlsGridProperty is the RESO record as MLSGrid returns it.

export type WriteMode = "shadow" | "live" | "paused";
export type PriceSortStyle = "ranges" | "shorthand";
export type RunMode = "incremental" | "full" | "photos" | "manual" | "discover";
export type RunTrigger = "cron" | "hub" | "http" | "manual";
export type SiteListingState = "staged" | "live" | "removed";

export type ReasonCode =
  | "status_change"
  | "property_type"
  | "no_village"
  | "city_change"
  | "mls_revoked"
  | "not_in_feed"
  | "new_construction"
  | "manual_refresh";

export interface LsSite {
  id: string;
  name: string;
  domain: string;
  wix_site_id: string | null;
  target_collection_id: string;
  live_collection_id: string;
  villages_collection_id: string;
  write_mode: WriteMode;
  market_cities: string[];
  /** RESO PropertyType values the site shows (Residential; Longboat Key also Land). */
  property_types: string[];
  /** Whether builder listings are shown. Off wherever the site has its own new-build section; on for Longboat Key, which has none (Jeff, 2026-09-18). */
  show_new_construction: boolean;
  /** The site's own names for engine fields, where its collection differs (engine key -> site key); see transform.applyFieldMap. */
  field_map: Record<string, string> | null;
  /** Which record shape the site's page code reads; see transform.RecordStyle. */
  record_style: "standard" | "lakewood";
  /** How the price filter tag reads: Longboat Key's ranges, or the older Velo shorthand. */
  price_sort_style: PriceSortStyle;
  active: boolean;
  timezone: string;
  /** Media Manager folder the engine imports this site's photos into; null = Wix's default. */
  media_folder_name: string | null;
  /** The folder's id once resolved from its name (cached by the photo job). */
  media_folder_id: string | null;
  /** Where the next Media Manager folder listing resumes; 0 = from the top. */
  media_scan_offset: number;
}

export interface LsVillage {
  id: string;
  site_id: string;
  name: string;
  wix_slug: string | null;
  wix_item_id: string | null;
  page_url: string | null;
  display: Record<string, unknown>;
  active: boolean;
  active_listing_count: number;
  zero_since: string | null;
}

export interface VillageTerm {
  term: string;
  street_term: string | null;
  /** The term does not match when the subdivision also contains this (Wellen Park: "preserve" is The Preserve, unless it is Kensington's). */
  exclude_term: string | null;
}

export interface VillageWithTerms extends LsVillage {
  terms: VillageTerm[];
}

export interface MlsGridMedia {
  MediaKey?: string;
  MediaURL?: string;
  Order?: number;
  /** Wix image URIs need these as originWidth/originHeight or the gallery will not render. */
  ImageWidth?: number;
  ImageHeight?: number;
  LongDescription?: string;
  MediaModificationTimestamp?: string;
  ModificationTimestamp?: string;
  MimeType?: string;
  [key: string]: unknown;
}

/** A RESO Property record from MLSGrid; only the fields the engine reads are typed. */
export interface MlsGridProperty {
  ListingId: string;
  ListingKey?: string;
  OriginatingSystemName?: string;
  StandardStatus?: string;
  PropertyType?: string;
  PropertySubType?: string;
  City?: string;
  PostalCity?: string;
  PostalCode?: string;
  StateOrProvince?: string;
  Country?: string;
  SubdivisionName?: string;
  StreetNumber?: string;
  StreetName?: string;
  StreetSuffix?: string;
  UnitNumber?: string;
  Latitude?: number;
  Longitude?: number;
  ListPrice?: number;
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  GarageSpaces?: number;
  LivingArea?: number;
  LotSizeAcres?: number;
  LotSizeSquareFeet?: number;
  PublicRemarks?: string;
  ListAgentFullName?: string;
  ListAgentMlsId?: string;
  ListAgentDirectPhone?: string;
  ListOfficeName?: string;
  MFR_AttributionContact?: string;
  VirtualTourURLUnbranded?: string;
  ModificationTimestamp?: string;
  OriginatingSystemModificationTimestamp?: string;
  MlgCanView?: boolean;
  NewConstructionYN?: boolean;
  PropertyCondition?: string[];
  Media?: MlsGridMedia[];
  [key: string]: unknown;
}

/** An ls_listings row as the engine writes it (timestamps as ISO strings). */
export interface LsListingRow {
  listing_id: string;
  listing_key: string | null;
  originating_system: string;
  standard_status: string | null;
  property_type: string | null;
  property_sub_type: string | null;
  city: string | null;
  postal_city: string | null;
  postal_code: string | null;
  subdivision: string | null;
  street_text: string | null;
  list_price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  living_area: number | null;
  latitude: number | null;
  longitude: number | null;
  photo_count: number;
  mlg_can_view: boolean | null;
  /**
   * Whether this is builder inventory: RESO NewConstructionYN, or a
   * PropertyCondition of "Under Construction" when the flag disagrees with
   * it. See isNewConstruction in normalize.ts. `raw` keeps the feed's own
   * NewConstructionYN either way.
   */
  new_construction: boolean | null;
  modification_timestamp: string | null;
  originating_system_modification_timestamp: string | null;
  raw: Record<string, unknown>;
  in_feed: boolean;
  last_seen_at: string;
  pulled_at: string;
}

/** An ls_listing_media row as produced from a pull (identity + the transient signed URL). */
export interface LsListingMediaInput {
  listing_id: string;
  position: number;
  media_key: string | null;
  path_key: string;
  source_url: string | null;
  source_url_received_at: string | null;
  title: string | null;
  media_modification_timestamp: string | null;
  image_width: number | null;
  image_height: number | null;
}

/**
 * A Wix image URI the CMS and the site can actually render. The origin
 * dimensions are not decoration: without them Wix refuses the gallery, the
 * CMS shows a warning and a broken primary image, and the site's gallery
 * falls back to its editor placeholder.
 */
export const WIX_IMAGE_URI = /^wix:image:\/\/v1\/[^/]+\/[^#]*#originWidth=[1-9][0-9]*&originHeight=[1-9][0-9]*$/;

export const isRenderableWixImage = (src: unknown): src is string =>
  typeof src === "string" && WIX_IMAGE_URI.test(src);

/**
 * The URI for a photo the engine imported, or null when the dimensions are
 * unknown — a URI without them is worse than none, because it writes a
 * gallery nothing can show.
 */
export function wixImageUri(fileId: string, displayName: string, width: number | null, height: number | null): string | null {
  if (!fileId || !width || !height || width < 1 || height < 1) return null;
  return `wix:image://v1/${fileId}/${encodeURIComponent(displayName)}#originWidth=${Math.round(width)}&originHeight=${Math.round(height)}`;
}

/** One gallery entry as written to a HousesforSale-shaped collection. */
export interface GalleryItem {
  type: "Image";
  title: string;
  src: string;
  order: number;
  /** The photo's identity across MLSGrid URL rotations; never an MLS URL. */
  mlsPathKey: string;
}

export interface LsSiteListing {
  id: string;
  site_id: string;
  listing_id: string;
  state: SiteListingState;
  village_id: string | null;
  wix_item_id: string | null;
  reason_code: ReasonCode | null;
  reason_detail: string | null;
  gallery_ready: boolean;
  needs_write: boolean;
  written_at: string | null;
  written_fingerprint: string | null;
  live_at: string | null;
  removed_at: string | null;
}

/**
 * Where a full run's verification stopped, so the next one carries on.
 *
 * A full run verifies every id the engine holds, 50 per MLSGrid request with
 * Media expanded, inside the fetch budget. That was comfortable at a
 * thousand listings and is not at six thousand: the set now needs about 124
 * requests and the budget buys roughly thirty. Without a cursor the shortfall
 * compounds twice over. `loadKnownListingIds` orders by listing_id and always
 * started at the beginning, so every attempt re-verified the same opening
 * slice and never reached the tail; and `tick.ts` only advanced
 * `lastFullDate` for a run that was not truncated, so the tick chose `full`
 * again five minutes later and kept choosing it until midnight UTC -- with no
 * incremental and no photo pass in between, on sites that are live. That is
 * the 2026-09-17 incident, which the plan doc left open as "worth a bounded
 * retry before the next nightly".
 *
 * The cursor is that bound, and the same shape discovery already uses: each
 * run resumes after the last id it verified and leaves its own mark, so every
 * pass moves forward and a cycle finishes in a handful of runs instead of
 * looping. Reaching the end clears it.
 */
export interface FullCursor {
  /** Verification resumes at the first id after this one. */
  afterListingId: string;
  /** When this cycle began, so a cursor that has stalled is visible. */
  startedAt: string;
  /** Ids verified so far in this cycle, across every run that carried it. */
  verified: number;
}
