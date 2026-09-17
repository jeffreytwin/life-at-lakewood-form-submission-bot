import { describe, expect, it } from "vitest";
import { classifyListing, matchVillage, type ClassifyListing } from "@/lib/listings/classify";
import type { VillageWithTerms } from "@/lib/listings/types";

const village = (name: string, terms: Array<[string, string | null] | [string, string | null, string | null]>): VillageWithTerms => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  site_id: "site",
  name,
  wix_slug: null,
  wix_item_id: null,
  page_url: null,
  display: {},
  active: true,
  active_listing_count: 0,
  zero_since: null,
  terms: terms.map(([term, street_term, exclude_term]) => ({ term, street_term, exclude_term: exclude_term ?? null })),
});

const villages = [
  village("Bay Isles - Harbor Section", [["bay isles", null]]),
  village("The Bayou", [["bay isles", "bayou"]]),
  village("Longboat Key Club", [["longboat key club", null], ["lbk club", null]]),
  village("Club Longboat", [["club longboat", null]]),
];

const active: ClassifyListing = {
  listing_id: "MFRA1",
  standard_status: "Active",
  property_type: "Residential",
  property_sub_type: "Condominium",
  city: "Longboat Key",
  postal_city: null,
  subdivision: "BAY ISLES HARBOR SECTION",
  street_text: "3040 grand bay boulevard",
  mlg_can_view: true,
  new_construction: false,
};

const ctx = { marketCities: ["Longboat Key"], villages, known: true, mode: "incremental" as const };

describe("matchVillage", () => {
  it("matches a subdivision containing the term, case-insensitively", () => {
    expect(matchVillage("BAY ISLES HARBOR SECTION", "3040 grand bay boulevard", villages)?.name).toBe(
      "Bay Isles - Harbor Section"
    );
  });

  it("prefers the street-qualified term when the street matches it", () => {
    expect(matchVillage("BAY ISLES", "500 bayou road", villages)?.name).toBe("The Bayou");
    expect(matchVillage("BAY ISLES", "500 harbor drive", villages)?.name).toBe("Bay Isles - Harbor Section");
  });

  it("lets the longest matching term win", () => {
    expect(matchVillage("LONGBOAT KEY CLUB TOWERS", null, villages)?.name).toBe("Longboat Key Club");
    expect(matchVillage("CLUB LONGBOAT", null, villages)?.name).toBe("Club Longboat");
  });

  it("returns null for no match, a blank subdivision, or an inactive village", () => {
    expect(matchVillage("SOME OTHER PLACE", null, villages)).toBeNull();
    expect(matchVillage("", null, villages)).toBeNull();
    const inactive = [{ ...villages[0], active: false }];
    expect(matchVillage("BAY ISLES", null, inactive)).toBeNull();
  });
});

describe("classifyListing", () => {
  it("accepts an active, allowed, in-market listing with a village", () => {
    const out = classifyListing(active, ctx);
    expect(out.kind).toBe("eligible");
    if (out.kind === "eligible") expect(out.village.name).toBe("Bay Isles - Harbor Section");
  });

  it("revoked display rights win over everything else", () => {
    const out = classifyListing({ ...active, mlg_can_view: false, standard_status: "Sold" }, ctx);
    expect(out).toMatchObject({ kind: "ineligible", reason: "mls_revoked" });
  });

  it("routes a status change, a disallowed property type, and a missing village to removal", () => {
    expect(classifyListing({ ...active, standard_status: "Pending" }, ctx)).toMatchObject({
      kind: "ineligible",
      reason: "status_change",
    });
    expect(classifyListing({ ...active, property_type: "Residential Lease" }, ctx)).toMatchObject({
      kind: "ineligible",
      reason: "property_type",
    });
    expect(classifyListing({ ...active, subdivision: "NOWHERE" }, ctx)).toMatchObject({
      kind: "ineligible",
      reason: "no_village",
    });
  });

  it("treats land as allowed and matches the city case-insensitively", () => {
    const out = classifyListing({ ...active, property_type: "Land", property_sub_type: null, city: "LONGBOAT KEY" }, ctx);
    expect(out.kind).toBe("eligible");
  });

  it("a listing outside the market is a city change", () => {
    expect(classifyListing({ ...active, city: "Sarasota" }, ctx)).toMatchObject({
      kind: "ineligible",
      reason: "city_change",
      detail: 'City is "Sarasota", outside the site\'s market',
    });
    expect(classifyListing({ ...active, city: null, postal_city: "Bradenton" }, ctx)).toMatchObject({
      kind: "ineligible",
      reason: "city_change",
    });
  });

  it("holds a known listing with a blank city on an hourly run, removes it on a full run", () => {
    const blank = { ...active, city: null, postal_city: null };
    expect(classifyListing(blank, ctx)).toMatchObject({ kind: "hold" });
    expect(classifyListing(blank, { ...ctx, mode: "full" })).toMatchObject({ kind: "ineligible", reason: "city_change" });
    expect(classifyListing(blank, { ...ctx, known: false })).toMatchObject({ kind: "ineligible", reason: "city_change" });
  });

  it("shows only the property types the site names: land on Longboat Key, not on a Residential-only site", () => {
    const land = { ...active, property_type: "Land", property_sub_type: null, city: "LONGBOAT KEY" };
    expect(classifyListing(land, { ...ctx, propertyTypes: ["Residential", "Land"] })).toMatchObject({ kind: "eligible" });
    const out = classifyListing(land, { ...ctx, propertyTypes: ["Residential"] });
    expect(out).toMatchObject({ kind: "ineligible", reason: "property_type" });
    expect((out as { detail: string }).detail).toContain("the site shows residential");
    // Case does not matter, and an empty list falls back to the default set.
    expect(classifyListing(land, { ...ctx, propertyTypes: ["residential", "LAND"] })).toMatchObject({ kind: "eligible" });
    expect(classifyListing(land, { ...ctx, propertyTypes: [] })).toMatchObject({ kind: "eligible" });
  });

  it("rules out new construction unless the site shows it (Jeff, 2026-09-16: off everywhere)", () => {
    const builder = { ...active, new_construction: true };
    const out = classifyListing(builder, ctx);
    expect(out).toMatchObject({ kind: "ineligible", reason: "new_construction" });
    expect((out as { detail: string }).detail).toContain("resale listings only");
    expect(classifyListing(builder, { ...ctx, showNewConstruction: true })).toMatchObject({ kind: "eligible" });
    // A record that does not say, or says false, is a resale listing.
    expect(classifyListing({ ...active, new_construction: null }, ctx)).toMatchObject({ kind: "eligible" });
    expect(classifyListing({ ...active, new_construction: undefined }, ctx)).toMatchObject({ kind: "eligible" });
    // Status and property type are decided first, so their reasons still win.
    expect(classifyListing({ ...builder, standard_status: "Pending" }, ctx)).toMatchObject({ reason: "status_change" });
  });
});
