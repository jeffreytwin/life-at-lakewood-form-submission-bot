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

/**
 * Is this builder inventory?
 *
 * NewConstructionYN is the field for it and is usually right, but it is
 * typed by the listing agent and sometimes is not. Found on 2026-09-18 when
 * Jeff looked at Life in Wellen Park's shadow collection: two Boca Royale
 * East homes, PropertyCondition "Under Construction", YearBuilt 2026,
 * BuilderName "Neal Communities of SWFL", listed by Neal Communities' own
 * brokerage -- and NewConstructionYN false. Redfin drops both, so it is not
 * reading that flag either.
 *
 * PropertyCondition is the corroborating RESO field and the two agree almost
 * perfectly across the 6,215 listings held on 2026-09-18:
 *
 *     ["Under Construction"]   472 Active   466 flagged    6 not
 *     ["Pre-Construction"]      49 Active    47 flagged    2 not
 *     ["Completed"]          1,015 Active   403 flagged  612 not
 *
 * So "Under Construction" is taken as decisive: a home still being built is
 * new construction whatever the flag says, and the six disagreements are
 * data entry rather than a second meaning.
 *
 * "Pre-Construction" is deliberately NOT included. It also covers a lot sold
 * for a proposed rebuild -- MFRTB8540951 on Longboat Key is Pre-Construction
 * with YearBuilt 1974 and no builder, a $4M teardown and a real listing.
 * "Completed" is not included either: 612 of its 1,015 are ordinary resales,
 * and the word means the house is finished, not who built it.
 */
export function isNewConstruction(raw: MlsGridProperty): boolean | null {
  const condition = Array.isArray(raw.PropertyCondition) ? raw.PropertyCondition : [];
  if (condition.some((c) => typeof c === "string" && c.trim().toLowerCase() === "under construction")) return true;
  return typeof raw.NewConstructionYN === "boolean" ? raw.NewConstructionYN : null;
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

/**
 * One row per photo, deduplicated on path_key.
 *
 * The dedupe is not cosmetic. ls_listing_media is upserted with
 * `onConflict: "listing_id,path_key"`, and Postgres refuses an INSERT ...
 * ON CONFLICT DO UPDATE whose own rows collide on the conflict key:
 *
 *     upsert listing media: ON CONFLICT DO UPDATE command cannot affect
 *     row a second time (21000)
 *
 * That killed Life At Lakewood's first discovery run at `upsert` on
 * 2026-09-18, 144 s and 33,000 records in, and it does not self-heal: the
 * same listing yields the same duplicate on every pull, so every run that
 * reaches it dies the same way. Three markets and 6,804 listings were enough
 * to turn up an MLS record listing one photo twice; the first three sites
 * never did.
 *
 * The first occurrence wins, which is the lowest Order because sortedMedia
 * has already sorted by it.
 *
 * Positions are numbered over the rows actually kept rather than over the
 * input index, so they stay contiguous from 1 — which is what this function
 * always claimed to do, and was not doing for any listing with a photo whose
 * URL carried no usable path_key.
 */
export function normalizeMedia(raw: MlsGridProperty, receivedAt: Date): LsListingMediaInput[] {
  const rows: LsListingMediaInput[] = [];
  const seen = new Set<string>();
  for (const m of sortedMedia(raw.Media)) {
    const pathKey = typeof m.MediaURL === "string" ? mediaPathKey(m.MediaURL) : null;
    if (!pathKey || seen.has(pathKey)) continue;
    seen.add(pathKey);
    rows.push({
      listing_id: raw.ListingId,
      position: rows.length + 1,
      media_key: str(m.MediaKey),
      path_key: pathKey,
      source_url: str(m.MediaURL),
      source_url_received_at: receivedAt.toISOString(),
      title: str(m.LongDescription),
      media_modification_timestamp: iso(m.MediaModificationTimestamp ?? m.ModificationTimestamp),
      image_width: num(m.ImageWidth),
      image_height: num(m.ImageHeight),
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
    new_construction: isNewConstruction(raw),
    modification_timestamp: iso(raw.ModificationTimestamp),
    originating_system_modification_timestamp: iso(raw.OriginatingSystemModificationTimestamp),
    raw: strippedRaw(raw),
    in_feed: true,
    last_seen_at: now,
    pulled_at: now,
  };
  return { listing, media };
}
