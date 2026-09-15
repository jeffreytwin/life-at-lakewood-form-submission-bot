// Listings engine: shared shapes. Rows mirror supabase/migrations/043 (the
// ls_ tables); MlsGridProperty is the RESO record as MLSGrid returns it.

export type WriteMode = "shadow" | "live" | "paused";
export type RunMode = "incremental" | "full" | "photos" | "manual";
export type RunTrigger = "cron" | "hub" | "http" | "manual";
export type SiteListingState = "staged" | "live" | "removed";

export type ReasonCode =
  | "status_change"
  | "property_type"
  | "no_village"
  | "city_change"
  | "mls_revoked"
  | "not_in_feed"
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
  active: boolean;
  timezone: string;
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
}

export interface VillageWithTerms extends LsVillage {
  terms: VillageTerm[];
}

export interface MlsGridMedia {
  MediaKey?: string;
  MediaURL?: string;
  Order?: number;
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
