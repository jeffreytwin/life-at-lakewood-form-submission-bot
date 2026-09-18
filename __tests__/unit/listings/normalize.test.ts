import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/listings/mlsgrid-property.json";
import { isNewConstruction, mediaPathKey, normalizeListing, streetText, wixFileId } from "@/lib/listings/normalize";
import type { MlsGridProperty } from "@/lib/listings/types";

const raw = fixture as unknown as MlsGridProperty;
const receivedAt = new Date("2026-09-14T15:10:00.000Z");

describe("mediaPathKey", () => {
  it("keeps the stable tail of a signed media.mlsgrid.com URL", () => {
    expect(
      mediaPathKey("https://media.mlsgrid.com/token=OlQCGcw0eHIb&expires=1785214585&id=6a5fd94b/images/MFR781897278/763177d0-e06c.jpeg")
    ).toBe("images/MFR781897278/763177d0-e06c.jpeg");
  });

  it("is the same key whatever the token or expiry", () => {
    const a = mediaPathKey("https://media.mlsgrid.com/token=AAA&expires=1&id=x/images/MFR1/p.jpeg");
    const b = mediaPathKey("https://media.mlsgrid.com/token=BBB&expires=2&id=y/images/MFR1/p.jpeg");
    expect(a).toBe(b);
  });

  it("falls back to the URL path for a URL without an /images/ segment", () => {
    expect(mediaPathKey("https://cdn.example.com/photos/MFR1/p.jpeg?sig=1")).toBe("photos/MFR1/p.jpeg");
    expect(mediaPathKey("not a url")).toBeNull();
    expect(mediaPathKey("")).toBeNull();
  });
});

describe("wixFileId", () => {
  it("parses the file id out of a gallery URI", () => {
    expect(wixFileId("wix:image://v1/d0be81_abc~mv2.jpg/photo.jpg")).toBe("d0be81_abc~mv2.jpg");
    expect(wixFileId("https://static.wixstatic.com/media/x.jpg")).toBeNull();
  });
});

describe("isNewConstruction", () => {
  const of = (props: Partial<MlsGridProperty>) =>
    isNewConstruction({ ListingId: "MFRX1", ...props } as MlsGridProperty);

  it("takes the MLS flag when it is set", () => {
    expect(of({ NewConstructionYN: true })).toBe(true);
    expect(of({ NewConstructionYN: false })).toBe(false);
  });

  it("says nothing when the record says nothing", () => {
    expect(of({})).toBeNull();
    expect(of({ PropertyCondition: [] })).toBeNull();
  });

  it("overrides a false flag when the house is still being built", () => {
    // The two Boca Royale East homes that started this: Under Construction,
    // YearBuilt 2026, BuilderName "Neal Communities of SWFL", listed by Neal
    // Communities' own brokerage -- and NewConstructionYN false.
    expect(of({ NewConstructionYN: false, PropertyCondition: ["Under Construction"] })).toBe(true);
    expect(of({ PropertyCondition: ["Under Construction"] })).toBe(true);
    expect(of({ PropertyCondition: ["under construction"] })).toBe(true);
    expect(of({ PropertyCondition: [" Under Construction "] })).toBe(true);
  });

  it("leaves Pre-Construction alone, because it also means a teardown lot", () => {
    // MFRTB8540951 on Longboat Key: Pre-Construction, YearBuilt 1974, no
    // builder -- a $4M lot sold for a proposed rebuild, and a real listing.
    expect(of({ NewConstructionYN: false, PropertyCondition: ["Pre-Construction"] })).toBe(false);
    expect(of({ PropertyCondition: ["Pre-Construction"] })).toBeNull();
  });

  it("leaves Completed alone, because most of them are ordinary resales", () => {
    // 612 of the 1,015 Completed listings held on 2026-09-18 are not builder
    // inventory. The word describes the house, not who is selling it.
    expect(of({ NewConstructionYN: false, PropertyCondition: ["Completed"] })).toBe(false);
    expect(of({ NewConstructionYN: true, PropertyCondition: ["Completed"] })).toBe(true);
  });

  it("survives a PropertyCondition that is not an array", () => {
    expect(of({ PropertyCondition: "Under Construction" as unknown as string[] })).toBeNull();
    expect(of({ NewConstructionYN: false, PropertyCondition: null as unknown as string[] })).toBe(false);
  });
});

describe("normalizeListing", () => {
  it("maps the RESO fields, counts photos, and lowercases the street text", () => {
    const { listing } = normalizeListing(raw, receivedAt);
    expect(listing).toMatchObject({
      listing_id: "MFRA4670555",
      listing_key: "MFR783588094",
      standard_status: "Active",
      property_type: "Residential",
      property_sub_type: "Condominium",
      city: "Longboat Key",
      postal_city: null,
      subdivision: "BAY ISLES HARBOR SECTION",
      street_text: "3040 grand bay boulevard",
      list_price: 1395000,
      bedrooms: 3,
      bathrooms: 3,
      living_area: 2143,
      photo_count: 3,
      mlg_can_view: true,
      new_construction: null,
      modification_timestamp: "2026-09-14T15:02:11.000Z",
      originating_system_modification_timestamp: "2026-09-14T14:58:40.000Z",
      in_feed: true,
      pulled_at: "2026-09-14T15:10:00.000Z",
    });
    expect(streetText(raw)).toBe("3040 grand bay boulevard");
  });

  it("orders media by Order, renumbers positions, and keys each photo by its stable path", () => {
    const { media } = normalizeListing(raw, receivedAt);
    expect(media.map((m) => [m.position, m.path_key, m.title])).toEqual([
      [1, "images/MFR783588094/11111111-1111-4111-8111-111111111111.jpeg", "Front"],
      [2, "images/MFR783588094/22222222-2222-4222-8222-222222222222.jpeg", "Kitchen"],
      [3, "images/MFR783588094/33333333-3333-4333-8333-333333333333.jpeg", null],
    ]);
    expect(media[0].source_url).toContain("token=abc");
    expect(media[0].source_url_received_at).toBe("2026-09-14T15:10:00.000Z");
    expect(media[2].media_modification_timestamp).toBe("2026-09-12T09:30:00.000Z");
  });

  it("strips the signed URLs out of the stored raw record", () => {
    const { listing } = normalizeListing(raw, receivedAt);
    const storedMedia = listing.raw.Media as Record<string, unknown>[];
    expect(storedMedia).toHaveLength(3);
    expect(storedMedia.every((m) => !("MediaURL" in m))).toBe(true);
    expect(storedMedia[0].MediaKey).toBe("MFR783588094-2");
    expect(JSON.stringify(listing.raw)).not.toContain("token=");
  });

  it("tolerates a record without media or numbers", () => {
    const { listing, media } = normalizeListing({ ListingId: "MFRX1", StandardStatus: "Active" }, receivedAt);
    expect(media).toEqual([]);
    expect(listing.photo_count).toBe(0);
    expect(listing.list_price).toBeNull();
    expect(listing.street_text).toBeNull();
    expect(listing.mlg_can_view).toBeNull();
    expect(listing.new_construction).toBeNull();
  });
});
