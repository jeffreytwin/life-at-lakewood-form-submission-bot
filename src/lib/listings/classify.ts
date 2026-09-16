// Does a site show this listing, and in which village? Pure; ported from the
// classify step of the Longboat Key pipeline (backend/sync/pipeline.jsw).
//
// Outcomes:
//   eligible   - Active, an allowed property type, in the site's market,
//                MLS display rights intact, not new construction (unless the
//                site shows it), and a village term matches.
//   ineligible - one of those failed; `reason` is the removal reason code the
//                site listing carries if the site currently holds it. For a
//                listing the site never held it simply means "do not add".
//   hold       - nothing can be decided (a blank city on an hourly run); a
//                held listing keeps whatever state it has.
//
// City is filtered here because MLSGrid replication queries do not allow a
// city filter server-side: the hourly pull is MLS-wide.

import type { ReasonCode, VillageWithTerms } from "@/lib/listings/types";

/** RESO PropertyType values a site displays when its row names none (lowercased); ls_sites.property_types decides per site. */
export const ALLOWED_PROPERTY_TYPES = new Set(["residential", "land"]);

export interface ClassifyListing {
  listing_id: string;
  standard_status: string | null;
  property_type: string | null;
  property_sub_type: string | null;
  city: string | null;
  postal_city: string | null;
  subdivision: string | null;
  street_text: string | null;
  mlg_can_view: boolean | null;
  /** RESO NewConstructionYN; null when the record does not say. */
  new_construction?: boolean | null;
}

export interface ClassifyContext {
  /** MLS City / PostalCity values that count as this site's market. */
  marketCities: string[];
  /** RESO PropertyType values the site shows; ALLOWED_PROPERTY_TYPES when absent. */
  propertyTypes?: string[];
  /** Builder listings (NewConstructionYN true) are excluded unless this is set; Jeff, 2026-09-16: off on every site. */
  showNewConstruction?: boolean;
  villages: VillageWithTerms[];
  /** Whether the site currently holds the listing (staged or live). */
  known: boolean;
  /** Full runs may treat a blank city on a held listing as a removal. */
  mode: "incremental" | "full";
}

export type ClassifyOutcome =
  | { kind: "eligible"; village: VillageWithTerms }
  | { kind: "ineligible"; reason: ReasonCode; detail: string }
  | { kind: "hold"; detail: string };

/**
 * The village whose term the subdivision contains. The longest matching term
 * wins (plan decision 5); a term with a street qualifier only matches when
 * the street text contains it too.
 */
export function matchVillage(
  subdivision: string | null,
  street: string | null,
  villages: VillageWithTerms[]
): VillageWithTerms | null {
  const needle = (subdivision ?? "").toLowerCase();
  if (!needle) return null;
  const streetLower = (street ?? "").toLowerCase();
  let best: { village: VillageWithTerms; length: number; qualified: boolean } | null = null;
  for (const village of villages) {
    if (village.active === false) continue;
    for (const { term, street_term } of village.terms) {
      if (!term || !needle.includes(term)) continue;
      if (street_term && !streetLower.includes(street_term)) continue;
      const candidate = { village, length: term.length, qualified: !!street_term };
      if (
        !best ||
        candidate.length > best.length ||
        (candidate.length === best.length && candidate.qualified && !best.qualified)
      ) {
        best = candidate;
      }
    }
  }
  return best?.village ?? null;
}

export function classifyListing(listing: ClassifyListing, ctx: ClassifyContext): ClassifyOutcome {
  if (listing.mlg_can_view === false) {
    return {
      kind: "ineligible",
      reason: "mls_revoked",
      detail: "MLS revoked display rights for this listing (MlgCanView is false)",
    };
  }

  const cityRaw = listing.city || listing.postal_city || "";
  const market = ctx.marketCities.map((c) => c.toLowerCase());
  if (!market.includes(cityRaw.toLowerCase())) {
    if (!cityRaw && ctx.known && ctx.mode !== "full") {
      return { kind: "hold", detail: "City is missing from the MLS record; left as is until the nightly full run" };
    }
    return {
      kind: "ineligible",
      reason: "city_change",
      detail: cityRaw
        ? `City is "${cityRaw}", outside the site's market`
        : "City is missing from the MLS record (cannot confirm it is in the site's market)",
    };
  }

  if ((listing.standard_status ?? "").toLowerCase() !== "active") {
    return {
      kind: "ineligible",
      reason: "status_change",
      detail: `Status is ${listing.standard_status || "unknown"}`,
    };
  }

  const propertyType = (listing.property_type ?? "").toLowerCase();
  const allowed = ctx.propertyTypes?.length ? new Set(ctx.propertyTypes.map((t) => t.toLowerCase())) : ALLOWED_PROPERTY_TYPES;
  if (!allowed.has(propertyType)) {
    return {
      kind: "ineligible",
      reason: "property_type",
      detail: `Property type is ${listing.property_type || "unknown"}${listing.property_sub_type ? ` / ${listing.property_sub_type}` : ""} (the site shows ${[...allowed].join(", ")})`,
    };
  }

  if (listing.new_construction === true && !ctx.showNewConstruction) {
    return {
      kind: "ineligible",
      reason: "new_construction",
      detail: "New construction (the MLS flags it NewConstructionYN); the site shows resale listings only",
    };
  }

  const village = matchVillage(listing.subdivision, listing.street_text, ctx.villages);
  if (!village) {
    return {
      kind: "ineligible",
      reason: "no_village",
      detail: `Subdivision "${listing.subdivision ?? ""}" matches no village term`,
    };
  }

  return { kind: "eligible", village };
}
