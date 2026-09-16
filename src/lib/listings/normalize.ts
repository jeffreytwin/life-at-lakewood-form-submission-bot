// MLSGrid record -> ls_listings row + ls_listing_media rows.
//
// A signed MediaURL (media.mlsgrid.com/token=...&expires=...&id=.../images/
// <ListingId>/<uuid>.jpeg) is valid for an hour and one download, and
// MLSGrid asks consumers never to store or serve it. The photo's identity is
// therefore the stable tail after the signature (path_key); the URL rides
// along only until the download happens, and the stored raw record has the
// URLs stripped.

import type { LsListingMediaInput, LsListingRow, MlsGridMedia, MlsGridProperty } from "@/lib/listings/types";

/** The stable part of a MediaURL: `images/<ListingId>/<uuid>.<ext>`. */
export function mediaPathKey(url: string): string | null {
  if (typeof url !== "string" || !url) return null;
  const match = url.match(/\/(images\/[^?#]+)/);
  if (match) return match[1];
  try {
    const path = new URL(url).pathname.replace(/^\/+/, "");
    return path || null;
  } catch {
    return null;
  }
}

/** Parses the Media Manager file id out of a `wix:image://v1/<fileId>/<name>` URI. */
export function wixFileId(uri: string): string | null {
  const match = typeof uri === "string" ? uri.match(/^wix:image:\/\/v1\/([^/]+)\//) : null;
  return match ? match[1] : null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);
const iso = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** "<number> <name> <suffix>", lowercased, for street-qualified village terms. */
export function streetText(raw: MlsGridProperty): string {
  return [raw.StreetNumber, raw.StreetName, raw.StreetSuffix]
    .filter((p) => typeof p === "string" && p)
    .join(" ")
    .toLowerCase()
    .trim();
}

/** Media sorted by Order, positions renumbered from 1. */
export function sortedMedia(media: MlsGridMedia[] | undefined): MlsGridMedia[] {
  if (!Array.isArray(media)) return [];
  return [...media].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
}

export function normalizeMedia(raw: MlsGridProperty, receivedAt: Date): LsListingMediaInput[] {
  const rows: LsListingMediaInput[] = [];
  for (const [index, m] of sortedMedia(raw.Media).entries()) {
    const pathKey = typeof m.MediaURL === "string" ? mediaPathKey(m.MediaURL) : null;
    if (!pathKey) continue;
    rows.push({
      listing_id: raw.ListingId,
      position: index + 1,
      media_key: str(m.MediaKey),
      path_key: pathKey,
      source_url: str(m.MediaURL),
      source_url_received_at: receivedAt.toISOString(),
      title: str(m.LongDescription),
      media_modification_timestamp: iso(m.MediaModificationTimestamp ?? m.ModificationTimestamp),
    });
  }
  return rows;
}

/** The record as stored: everything MLSGrid sent, minus the signed media URLs. */
export function strippedRaw(raw: MlsGridProperty): Record<string, unknown> {
  const media = Array.isArray(raw.Media)
    ? raw.Media.map((m) => {
        const copy: Record<string, unknown> = { ...m };
        delete copy.MediaURL;
        return copy;
      })
    : raw.Media;
  return { ...raw, Media: media };
}

export function normalizeListing(
  raw: MlsGridProperty,
  receivedAt: Date
): { listing: LsListingRow; media: LsListingMediaInput[] } {
  const media = normalizeMedia(raw, receivedAt);
  const now = receivedAt.toISOString();
  const listing: LsListingRow = {
    listing_id: raw.ListingId,
    listing_key: str(raw.ListingKey),
    originating_system: str(raw.OriginatingSystemName) ?? "mfrmls",
    standard_status: str(raw.StandardStatus),
    property_type: str(raw.PropertyType),
    property_sub_type: str(raw.PropertySubType),
    city: str(raw.City),
    postal_city: str(raw.PostalCity),
    postal_code: str(raw.PostalCode),
    subdivision: str(raw.SubdivisionName),
    street_text: streetText(raw) || null,
    list_price: num(raw.ListPrice),
    bedrooms: num(raw.BedroomsTotal),
    bathrooms: num(raw.BathroomsTotalInteger),
    living_area: num(raw.LivingArea),
    latitude: num(raw.Latitude),
    longitude: num(raw.Longitude),
    photo_count: media.length,
    mlg_can_view: typeof raw.MlgCanView === "boolean" ? raw.MlgCanView : null,
    new_construction: typeof raw.NewConstructionYN === "boolean" ? raw.NewConstructionYN : null,
    modification_timestamp: iso(raw.ModificationTimestamp),
    originating_system_modification_timestamp: iso(raw.OriginatingSystemModificationTimestamp),
    raw: strippedRaw(raw),
    in_feed: true,
    last_seen_at: now,
    pulled_at: now,
  };
  return { listing, media };
}
