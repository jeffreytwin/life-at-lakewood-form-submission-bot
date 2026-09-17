// Seeding a site's neighborhoods from the site's own Wix collections.
//
// `importVillagesFromWix` reads a `Villages` collection, where each row is
// already a (matchPattern -> village page) rule. Longboat Key has one because
// its Velo pipeline needed one. The master-planned-community sites do not:
// Parrish kept its terms in a dashboard page's if-chain (transcribed by hand
// into migration 046), and Life in Wellen Park keeps none at all -- its
// neighborhoods live in `HousesforSale-DynamicPages` ("Neighborhoods") and
// the subdivision each one covers is only visible in the listings the site is
// already showing, every one of which carries both `subdivision` (as the MLS
// wrote it) and `village1` (the neighborhood row it was filed under).
//
// So: read the neighborhoods for their identity (name, slug, page, tag icons,
// and the item id the stats writeback needs), read the live listings for the
// subdivision -> neighborhood pairs the site has been making all along, and
// derive the terms from those pairs. What comes out is a starting point the
// Hub's Neighborhoods page can tune, not a final answer -- a neighborhood
// with no listing today has nothing to learn from and is reported termless.

import { queryAllItems, type WixItemData } from "@/lib/wix/client";
import { supabase } from "@/lib/supabase/client";
import { errorMessage, isUniqueViolation } from "@/lib/shared/errors";
import { slugOf } from "@/lib/listings/villages";
import type { LsSite } from "@/lib/listings/types";

/** Terms shorter than this are noise ("oak", "gran", "the"), never distinctive. */
export const MIN_TERM_LENGTH = 5;

/** Fields a neighborhood row might carry its display name in, best first. */
const NAME_FIELDS = ["villageName", "village", "villageTitle", "neighborhoodName", "title", "name"] as const;
/** Fields a neighborhood row might carry its page URL in, best first. */
const URL_FIELDS = ["villageURL", "villageLink", "pageUrl", "url"] as const;
/** Copied onto every listing the neighborhood owns (see transform.buildListingRecord). */
const DISPLAY_FIELDS = ["villageSortHelp", "blueTag1", "purpleTag1", "greenTag1"] as const;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const first = (row: WixItemData, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return null;
};

/** One listing as the site's live collection holds it: what it says, filed where. */
export interface ObservedListing {
  subdivision: string | null;
  /** The `village1` reference: the neighborhood row's _id. */
  villageItemId: string | null;
  /** The `village` display text, the fallback when village1 is blank. */
  villageName: string | null;
}

export interface DerivedVillage {
  name: string;
  wix_item_id: string;
  wix_slug: string | null;
  page_url: string | null;
  display: Record<string, string>;
  /** Derived terms, shortest first; empty when nothing distinctive was found. */
  terms: string[];
  /** The distinct subdivisions the site's own listings file under it. */
  subdivisions: string[];
  /** Subdivisions no derived term covers: they need a term by hand. */
  uncovered: string[];
}

export interface VillageSeed {
  villages: DerivedVillage[];
  /** Neighborhood rows with no usable name; nothing can be seeded from them. */
  skippedRows: number;
  /** Listings whose village1/village matches no neighborhood row. */
  orphanListings: number;
  /** Neighborhoods with no listing to learn from, so no term. */
  termless: string[];
}

/**
 * The atoms a term can be built from. Subdivisions come as the MLS writes
 * them ("COACH HOMES 2/GRAN PARADISO PH", "ISLANDWALK/WEST VLGS PH 3A, 3"),
 * so the separators inside one are as meaningful as the spaces.
 */
const atomsOf = (segment: string): string[] => segment.split(/[\s,&]+/).filter(Boolean);

/**
 * The terms a subdivision could yield: each "/"-separated part's leading
 * atoms, growing one atom at a time ("wellen", "wellen park", "wellen park
 * golf"). Anchoring at a part's start is what keeps the generic tail of an
 * MLS name out of the running -- a name is built as `<NAME> <phase/unit>`,
 * so its head is the part that identifies it, and "golf", "palm" or
 * "national" never become terms of their own.
 *
 * Every candidate is checked against the subdivision as classify will see
 * it, so a run that spans a separator the join does not reproduce ("wellen
 * park golf country" over "... GOLF & COUNTRY ...") is dropped here rather
 * than matching nothing later.
 */
export function termCandidates(subdivision: string): string[] {
  const lower = subdivision.toLowerCase();
  const out = new Set<string>();
  for (const segment of lower.split("/")) {
    const atoms = atomsOf(segment);
    for (let end = 1; end <= atoms.length; end += 1) {
      const run = atoms.slice(0, end).join(" ");
      if (run.length >= MIN_TERM_LENGTH && lower.includes(run)) out.add(run);
    }
  }
  return [...out].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/**
 * The smallest set of terms that covers a neighborhood's subdivisions and
 * matches no other neighborhood's: greedy set cover over the candidates,
 * the shortest term winning a tie, then alphabetical so the result is
 * stable.
 *
 * Exclusivity is what keeps a term honest on a site whose market is several
 * cities: "wellen" covers Wellen Park Golf & Country Club, but it also sits
 * inside LAKESPUR/WELLEN PARK and EVERLY AT WELLEN PARK, so it is rejected
 * and "wellen park golf" is chosen instead; "grand" loses Grand Palm to
 * GRAND PARADISO and becomes "grand palm". A subdivision nothing exclusive
 * covers is left uncovered rather than given a term that would steal
 * another neighborhood's listings.
 *
 * What the site's own listings show is a sample, not the whole MLS, so a
 * derived term can still be wider than the neighborhood it was read from.
 * That is why this errs towards the specific: a term that is too narrow
 * puts a listing in the Hub's unmatched view, where it is one click from a
 * fix, while one that is too wide quietly puts someone else's listing on
 * the site.
 */
export function deriveTerms(
  subdivisions: string[],
  otherSubdivisions: string[]
): { terms: string[]; uncovered: string[] } {
  const subs = [...new Set(subdivisions.map((s) => s.toLowerCase().trim()).filter(Boolean))];
  if (!subs.length) return { terms: [], uncovered: [] };
  const others = [...new Set(otherSubdivisions.map((s) => s.toLowerCase().trim()).filter(Boolean))];

  // term -> every subdivision it matches, which is not only the one it was
  // read from: "gran paradiso" comes off GRAN PARADISO PH 1 and goes on to
  // cover COACH HOMES 1 AT GRAN PARADISO, whose own head is "coach".
  const candidates = new Map<string, Set<string>>();
  for (const sub of subs) {
    for (const candidate of termCandidates(sub)) {
      if (candidates.has(candidate)) continue;
      if (others.some((other) => other.includes(candidate))) continue;
      candidates.set(candidate, new Set(subs.filter((s) => s.includes(candidate))));
    }
  }

  const terms: string[] = [];
  const remaining = new Set(subs);
  while (remaining.size) {
    let best: { term: string; gain: number } | null = null;
    for (const [term, covers] of candidates) {
      let gain = 0;
      for (const sub of covers) if (remaining.has(sub)) gain += 1;
      if (!gain) continue;
      if (
        !best ||
        gain > best.gain ||
        (gain === best.gain && (term.length < best.term.length || (term.length === best.term.length && term < best.term)))
      ) {
        best = { term, gain };
      }
    }
    if (!best) break;
    terms.push(best.term);
    for (const sub of candidates.get(best.term) ?? []) remaining.delete(sub);
    candidates.delete(best.term);
  }
  terms.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return { terms, uncovered: [...remaining] };
}

/**
 * Pure: the neighborhoods a site's own collections describe, with the terms
 * its own listings imply. `neighborhoods` are the rows of the site's
 * villages collection, `listings` the rows of the collection it renders.
 */
export function deriveVillageSeed(neighborhoods: WixItemData[], listings: ObservedListing[]): VillageSeed {
  const villages: DerivedVillage[] = [];
  const byItemId = new Map<string, DerivedVillage>();
  const byName = new Map<string, DerivedVillage>();
  let skippedRows = 0;

  for (const row of neighborhoods) {
    const itemId = text(row._id);
    const name = first(row, NAME_FIELDS);
    if (!itemId || !name) {
      skippedRows += 1;
      continue;
    }
    const pageUrl = first(row, URL_FIELDS);
    const display: Record<string, string> = {};
    for (const key of DISPLAY_FIELDS) {
      const value = text(row[key]);
      if (value) display[key] = value;
    }
    const village: DerivedVillage = {
      name,
      wix_item_id: itemId,
      wix_slug: slugOf(pageUrl),
      page_url: pageUrl,
      display,
      terms: [],
      subdivisions: [],
      uncovered: [],
    };
    villages.push(village);
    byItemId.set(itemId, village);
    // First row wins a duplicated name: ls_villages is keyed on (site, name).
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), village);
  }

  let orphanListings = 0;
  for (const listing of listings) {
    const subdivision = text(listing.subdivision);
    if (!subdivision) continue;
    const village =
      (listing.villageItemId ? byItemId.get(listing.villageItemId) : undefined) ??
      (listing.villageName ? byName.get(listing.villageName.toLowerCase()) : undefined);
    if (!village) {
      orphanListings += 1;
      continue;
    }
    if (!village.subdivisions.includes(subdivision)) village.subdivisions.push(subdivision);
  }

  for (const village of villages) {
    const others = villages.filter((v) => v !== village).flatMap((v) => v.subdivisions);
    const { terms, uncovered } = deriveTerms(village.subdivisions, others);
    village.terms = terms;
    village.uncovered = uncovered;
    village.subdivisions.sort();
  }

  return {
    villages,
    skippedRows,
    orphanListings,
    termless: villages.filter((v) => !v.terms.length).map((v) => v.name).sort(),
  };
}

export interface VillageSeedResult extends Omit<VillageSeed, "villages"> {
  villages: number;
  terms: number;
  /** Terms another neighborhood on the site already owns; left where they were. */
  conflicts: Array<{ village: string; term: string }>;
  /** Neighborhoods, newest derivation first, for the Hub and the run log. */
  detail: DerivedVillage[];
}

/**
 * Reads the site's neighborhoods collection and the collection it renders,
 * derives the seed and writes it. Idempotent, and additive on terms: a term
 * edited or added in the Hub is never removed by a re-seed (unlike the
 * `Villages` import, which replaces a village's term set because there the
 * Wix rows are the source of truth).
 */
export async function seedVillagesFromSiteCollections(site: LsSite): Promise<VillageSeedResult> {
  if (!site.wix_site_id) throw new Error(`site ${site.domain} has no wix_site_id`);
  const [neighborhoodItems, listingItems] = await Promise.all([
    queryAllItems(site.wix_site_id, site.villages_collection_id),
    queryAllItems(site.wix_site_id, site.live_collection_id),
  ]);
  const neighborhoods = neighborhoodItems.map((item) => ({
    ...item.data,
    _id: typeof item.data._id === "string" ? item.data._id : item.id,
  }));
  const listings: ObservedListing[] = listingItems.map((item) => ({
    subdivision: text(item.data.subdivision),
    villageItemId: text(item.data.village1),
    villageName: text(item.data.village),
  }));

  const seed = deriveVillageSeed(neighborhoods, listings);
  const result: VillageSeedResult = {
    villages: 0,
    terms: 0,
    conflicts: [],
    skippedRows: seed.skippedRows,
    orphanListings: seed.orphanListings,
    termless: seed.termless,
    detail: seed.villages,
  };

  for (const village of seed.villages) {
    const { data: row, error } = await supabase
      .from("ls_villages")
      .upsert(
        {
          site_id: site.id,
          name: village.name,
          wix_slug: village.wix_slug,
          wix_item_id: village.wix_item_id,
          page_url: village.page_url,
          display: village.display,
        },
        { onConflict: "site_id,name" }
      )
      .select("id")
      .single();
    if (error || !row) throw new Error(`upsert neighborhood ${village.name}: ${errorMessage(error)}`);
    result.villages += 1;

    for (const term of village.terms) {
      const { error: insError } = await supabase
        .from("ls_village_terms")
        .insert({ site_id: site.id, village_id: row.id, term });
      if (insError) {
        // Already there (a re-seed, or the Hub added it) or owned elsewhere.
        if (isUniqueViolation(insError)) {
          result.conflicts.push({ village: village.name, term });
          continue;
        }
        throw new Error(`insert term "${term}" for ${village.name}: ${errorMessage(insError)}`);
      }
      result.terms += 1;
    }
  }
  return result;
}
