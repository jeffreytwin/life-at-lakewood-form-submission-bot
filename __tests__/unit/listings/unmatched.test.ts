import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { groupUnmatched, type UnmatchedCandidate } from "@/lib/listings/unmatched";
import type { VillageWithTerms } from "@/lib/listings/types";

const village = (name: string, terms: string[]): VillageWithTerms =>
  ({ id: name, site_id: "s", name, wix_slug: null, wix_item_id: null, page_url: null, display: {}, active: true, active_listing_count: 0, zero_since: null, terms: terms.map((term) => ({ term, street_term: null })) }) as unknown as VillageWithTerms;

const listing = (id: string, subdivision: string | null, price: number | null, patch: Partial<UnmatchedCandidate> = {}): UnmatchedCandidate => ({
  listing_id: id,
  standard_status: "Active",
  property_type: "Residential",
  property_sub_type: "Single Family Residence",
  city: "LONGBOAT KEY",
  postal_city: null,
  subdivision,
  street_text: `${id.slice(-2)} main st`,
  mlg_can_view: true,
  list_price: price,
  ...patch,
});

const ctx = { marketCities: ["Longboat Key"], propertyTypes: ["Residential", "Land"], villages: [village("Sleepy Lagoon", ["sleepy lagoon"])] };

describe("groupUnmatched", () => {
  it("keeps only the no_village listings, grouped by subdivision with count, price range and a sample", () => {
    const { unmatched, groups } = groupUnmatched(
      [
        listing("MFR1", "SLEEPY LAGOON", 900_000),
        listing("MFR2", "LONGBOAT KEY MOORINGS", 200_000),
        listing("MFR3", "LONGBOAT KEY MOORINGS", 400_000),
        listing("MFR4", "LONGBOAT KEY MOORINGS", 300_000),
        listing("MFR5", "LONGBOAT KEY MOORINGS", null),
        listing("MFR6", null, 995_000, { property_type: "Land", property_sub_type: null }),
        listing("MFR7", "BAILEY-DOBSON", 650_000, { standard_status: "Pending" }),
        listing("MFR8", "BAILEY-DOBSON", 650_000, { city: "SARASOTA" }),
        // Builder inventory is ruled out before the term match, so it is not a missing-term candidate.
        listing("MFR9", "NORTH RIVER RANCH PH IV", 450_000, { new_construction: true }),
      ],
      ctx
    );
    expect(unmatched).toBe(5);
    expect(groups.map((g) => [g.subdivision, g.count])).toEqual([["LONGBOAT KEY MOORINGS", 4], ["", 1]]);
    const moorings = groups[0];
    expect(moorings.minPrice).toBe(200_000);
    expect(moorings.maxPrice).toBe(400_000);
    expect(moorings.sample.map((s) => s.listing_id)).toEqual(["MFR3", "MFR4", "MFR2"]);
    expect(groups[1].sample[0]).toMatchObject({ listing_id: "MFR6", property_type: "Land" });
  });

  it("is empty when every candidate matches a term", () => {
    expect(groupUnmatched([listing("MFR1", "SLEEPY LAGOON PH 2", 1)], ctx)).toEqual({ unmatched: 0, groups: [] });
  });
});
