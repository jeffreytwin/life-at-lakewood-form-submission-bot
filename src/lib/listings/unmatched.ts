// What a site is ruling out for want of a neighborhood term: the Active,
// for-sale listings in its market whose subdivision matches nothing in
// ls_village_terms. Grouped by subdivision so a missing term is one glance
// (and one click on the Neighborhoods page) away. Jeff's rule stands: no
// term, not on the site; this is the view that shows what that costs.

import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/shared/errors";
import { classifyListing, type ClassifyListing } from "@/lib/listings/classify";
import { loadVillagesWithTerms, selectAll } from "@/lib/listings/db";
import { HubError } from "@/lib/listings/hub";
import type { LsSite, VillageWithTerms } from "@/lib/listings/types";

export interface UnmatchedListing {
  listing_id: string;
  /** "<number> <name> <suffix>" as the MLS gives it, lowercased. */
  street: string | null;
  price: number | null;
  property_type: string | null;
  property_sub_type: string | null;
}

export interface UnmatchedGroup {
  /** The MLS subdivision as received; "" when the record has none. */
  subdivision: string;
  count: number;
  minPrice: number | null;
  maxPrice: number | null;
  /** Up to a few listings, highest price first. */
  sample: UnmatchedListing[];
}

export interface UnmatchedView {
  generatedAt: string;
  site: { id: string; name: string; domain: string };
  /** Active listings of the site's property types in its market that the engine holds. */
  candidates: number;
  /** Of those, how many match no neighborhood term. */
  unmatched: number;
  groups: UnmatchedGroup[];
}

export type UnmatchedCandidate = ClassifyListing & { list_price: number | null };

const SAMPLE = 3;

/** Pure: the candidates that classify as no_village, grouped by subdivision, biggest groups first. */
export function groupUnmatched(
  candidates: UnmatchedCandidate[],
  ctx: { marketCities: string[]; propertyTypes: string[]; villages: VillageWithTerms[] }
): { unmatched: number; groups: UnmatchedGroup[] } {
  const groups = new Map<string, UnmatchedGroup>();
  let unmatched = 0;
  for (const listing of candidates) {
    const outcome = classifyListing(listing, { ...ctx, known: false, mode: "full" });
    if (outcome.kind !== "ineligible" || outcome.reason !== "no_village") continue;
    unmatched += 1;
    const key = (listing.subdivision ?? "").trim();
    const group = groups.get(key) ?? { subdivision: key, count: 0, minPrice: null, maxPrice: null, sample: [] };
    group.count += 1;
    if (listing.list_price != null) {
      group.minPrice = group.minPrice == null ? listing.list_price : Math.min(group.minPrice, listing.list_price);
      group.maxPrice = group.maxPrice == null ? listing.list_price : Math.max(group.maxPrice, listing.list_price);
    }
    group.sample.push({
      listing_id: listing.listing_id,
      street: listing.street_text,
      price: listing.list_price,
      property_type: listing.property_type,
      property_sub_type: listing.property_sub_type,
    });
    groups.set(key, group);
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.sample.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    g.sample = g.sample.slice(0, SAMPLE);
  }
  out.sort((a, b) => b.count - a.count || a.subdivision.localeCompare(b.subdivision));
  return { unmatched, groups: out };
}

export async function listUnmatchedListings(siteId: string): Promise<UnmatchedView> {
  const { data: siteRow, error: siteError } = await supabase.from("ls_sites").select("*").eq("id", siteId).maybeSingle();
  if (siteError) throw new HubError(`load site: ${errorMessage(siteError)}`, 500);
  if (!siteRow) throw new HubError("Site not found", 404);
  const site = siteRow as LsSite;
  const cities = (site.market_cities ?? []).filter(Boolean);
  if (!cities.length) {
    return { generatedAt: new Date().toISOString(), site: { id: site.id, name: site.name, domain: site.domain }, candidates: 0, unmatched: 0, groups: [] };
  }
  // ilike without wildcards is a case-insensitive equality; the MLS writes cities in capitals.
  const cityFilter = cities.flatMap((c) => [`city.ilike.${c}`, `postal_city.ilike.${c}`]).join(",");
  const [villages, candidates] = await Promise.all([
    loadVillagesWithTerms(site.id),
    selectAll<UnmatchedCandidate>("load unmatched candidates", (from, to) =>
      supabase
        .from("ls_listings")
        .select("listing_id, standard_status, property_type, property_sub_type, city, postal_city, subdivision, street_text, mlg_can_view, list_price")
        .eq("in_feed", true)
        .eq("standard_status", "Active")
        .in("property_type", site.property_types ?? [])
        .or(cityFilter)
        .order("listing_id")
        .range(from, to)
    ),
  ]);
  const { unmatched, groups } = groupUnmatched(candidates, { marketCities: cities, propertyTypes: site.property_types ?? [], villages });
  return {
    generatedAt: new Date().toISOString(),
    site: { id: site.id, name: site.name, domain: site.domain },
    candidates: candidates.length,
    unmatched,
    groups,
  };
}
