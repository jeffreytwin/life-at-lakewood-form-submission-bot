import { describe, expect, it } from "vitest";
import { deriveTerms, deriveVillageSeed, termCandidates, MIN_TERM_LENGTH, type ObservedListing } from "@/lib/listings/seed-villages";
import { matchVillage } from "@/lib/listings/classify";
import type { VillageWithTerms } from "@/lib/listings/types";

// Life in Wellen Park's own HousesforSale rows, as its site carried them
// (pipeline/audit/snapshots/lifeinwellenpark.com/homes-for-sale.html). A
// subdivision the MLS wrote, filed under the neighborhood the site chose:
// the pairing the seed has to reproduce.
const WELLEN: Array<[village: string, subdivision: string]> = [
  ["Gran Paradiso", "GRAN PARADISO"],
  ["Gran Paradiso", "GRAN PARADISO PH 1"],
  ["Gran Paradiso", "GRAN PARADISO TWNHMS 1B"],
  ["Gran Paradiso", "GRAN PARADISO, TWNHMS 1A"],
  ["Gran Paradiso", "COACH HOMES 1 AT GRAN PARADISO"],
  ["Gran Paradiso", "COACH HOMES 2/GRAN PARADISO PH"],
  ["Gran Paradiso", "GRAND PARADISO"],
  ["Wellen Park Country Club", "WELLEN PARK GOLF & COUNTRY CLUB"],
  ["Wellen Park Country Club", "WELLEN PARK GOLF & COUNTRY CLB"],
  ["Wellen Park Country Club", "WELLEN PARK GOLF AND COUNTRY CLUB"],
  ["IslandWalk", "ISLANDWALK AT WEST VILLAGES PH 02"],
  ["IslandWalk", "ISLANDWALK AT THE WEST VILLAGE"],
  ["IslandWalk", "ISLANDWALK/WEST VLGS PH 3A, 3"],
  ["Grand Palm", "GRAND PALM PH 1A"],
  ["Grand Palm", "GRAND PALM PH 1AA"],
  ["Sarasota National", "SARASOTA NATIONAL"],
  ["Sarasota National", "SARASOTA NATIONAL PH 13-B"],
  ["Sarasota National", "SARASOTA NATIONAL PH 9-A"],
  ["Lakespur", "LAKESPUR/WELLEN PARK"],
  ["Solstice", "SOLSTICE PH ONE"],
  ["Solstice", "SOLSTICE PH TWO"],
  ["Everly", "EVERLY AT WELLEN PARK"],
  ["Boca Royale", "BOCA ROYALE UN 16"],
  ["Sunstone", "SUNSTONE VILLAGE"],
  ["Sunstone", "SUNSTONE VILLAGE F5 PH 1A & 1B"],
  ["Oasis", "OASIS/WEST VLGS PH 1"],
  ["Renaissance", "RENAISSANCE"],
  ["Wysteria", "WYSTERIA WELLEN PARK VILLAGE F-4"],
  ["Tortuga", "TORTUGA"],
];

const itemId = (name: string) => `id-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
const wellenNeighborhoods = [...new Set(WELLEN.map(([v]) => v))].map((name) => ({
  _id: itemId(name),
  villageName: name,
  villageURL: `https://www.lifeinwellenpark.com/neighborhood/${name.toLowerCase().replace(/ /g, "-")}`,
}));
const wellenListings: ObservedListing[] = WELLEN.map(([village, subdivision]) => ({
  subdivision,
  villageItemId: itemId(village),
  villageName: village,
}));

const seedOf = (listings = wellenListings) => deriveVillageSeed(wellenNeighborhoods, listings);
const bySite = (seed = seedOf()) => new Map(seed.villages.map((v) => [v.name, v]));

describe("termCandidates", () => {
  it("takes the leading atoms of each slash-separated part, never a generic tail", () => {
    expect(termCandidates("WELLEN PARK GOLF & COUNTRY CLUB")).toEqual([
      "wellen",
      "wellen park",
      "wellen park golf",
    ]);
    // "golf", "country club" and "wellen park golf country" are all absent:
    // the first two are not leading, the third is not in the string at all.
  });

  it("anchors on each part of a compound name", () => {
    expect(termCandidates("COACH HOMES 2/GRAN PARADISO PH")).toContain("gran paradiso");
    expect(termCandidates("LAKESPUR/WELLEN PARK")).toEqual(["wellen", "lakespur", "wellen park"]);
  });

  it("drops anything shorter than a term", () => {
    for (const candidate of termCandidates("OASIS/WEST VLGS PH 1")) {
      expect(candidate.length).toBeGreaterThanOrEqual(MIN_TERM_LENGTH);
    }
    expect(termCandidates("TORTUGA")).toEqual(["tortuga"]);
  });
});

describe("deriveTerms", () => {
  it("keeps a term the rest of the site would also match out of the running", () => {
    // "wellen" and "wellen park" sit inside four other neighborhoods' names.
    const others = ["LAKESPUR/WELLEN PARK", "EVERLY AT WELLEN PARK", "WYSTERIA WELLEN PARK VILLAGE F-4"];
    expect(deriveTerms(["WELLEN PARK GOLF & COUNTRY CLUB"], others).terms).toEqual(["wellen park golf"]);
  });

  it("covers every subdivision, with a second term only when one will not do", () => {
    // The MLS spells Gran Paradiso two ways, so two terms; "grand" alone
    // would have covered the second, but Grand Palm is down the road.
    const { terms, uncovered } = deriveTerms(
      ["GRAN PARADISO PH 1", "COACH HOMES 1 AT GRAN PARADISO", "GRAND PARADISO"],
      ["GRAND PALM PH 1A"]
    );
    expect(terms).toEqual(["gran paradiso", "grand paradiso"]);
    expect(uncovered).toEqual([]);
  });

  it("leaves a subdivision uncovered rather than stealing another neighborhood's listings", () => {
    const { terms, uncovered } = deriveTerms(["RENAISSANCE"], ["RENAISSANCE AT WEST VILLAGES"]);
    expect(terms).toEqual([]);
    expect(uncovered).toEqual(["renaissance"]);
  });

  it("is stable whatever order the subdivisions arrive in", () => {
    const subs = ["SOLSTICE PH TWO", "SOLSTICE PH ONE"];
    expect(deriveTerms(subs, []).terms).toEqual(deriveTerms([...subs].reverse(), []).terms);
  });
});

describe("deriveVillageSeed on Life in Wellen Park's own rows", () => {
  it("names a term for every neighborhood its listings cover", () => {
    const seed = seedOf();
    expect(seed.villages).toHaveLength(14);
    expect(seed.termless).toEqual([]);
    expect(seed.orphanListings).toBe(0);
    expect(seed.skippedRows).toBe(0);
    for (const village of seed.villages) expect(village.uncovered).toEqual([]);
  });

  it("names the community, not a word the community happens to contain", () => {
    const villages = bySite();
    expect(villages.get("Wellen Park Country Club")!.terms).toEqual(["wellen park golf"]);
    expect(villages.get("Grand Palm")!.terms).toEqual(["grand palm"]);
    expect(villages.get("Boca Royale")!.terms).toEqual(["boca royale"]);
    expect(villages.get("Gran Paradiso")!.terms).toEqual(["gran paradiso", "grand paradiso"]);
    expect(villages.get("IslandWalk")!.terms).toEqual(["islandwalk"]);
  });

  it("keeps every term to one neighborhood, as the site's unique index requires", () => {
    const all = seedOf().villages.flatMap((v) => v.terms);
    expect(new Set(all).size).toBe(all.length);
    for (const term of all) expect(term).toBe(term.trim().toLowerCase());
  });

  it("files each listing back where the site had it", () => {
    const villages: VillageWithTerms[] = seedOf().villages.map((v) => ({
      id: v.wix_item_id,
      site_id: "site",
      name: v.name,
      wix_slug: v.wix_slug,
      wix_item_id: v.wix_item_id,
      page_url: v.page_url,
      display: v.display,
      active: true,
      active_listing_count: 0,
      zero_since: null,
      terms: v.terms.map((term) => ({ term, street_term: null, exclude_term: null })),
    }));
    for (const [expected, subdivision] of WELLEN) {
      expect(matchVillage(subdivision, null, villages)?.name, subdivision).toBe(expected);
    }
  });

  it("takes the page, the slug and the item id the stats writeback needs", () => {
    const granParadiso = bySite().get("Gran Paradiso")!;
    expect(granParadiso.wix_item_id).toBe(itemId("Gran Paradiso"));
    expect(granParadiso.wix_slug).toBe("gran-paradiso");
    expect(granParadiso.page_url).toBe("https://www.lifeinwellenpark.com/neighborhood/gran-paradiso");
  });

  it("reports a neighborhood with nothing for sale instead of guessing a term for it", () => {
    const seed = deriveVillageSeed([...wellenNeighborhoods, { _id: "id-ashcombe", villageName: "Ashcombe" }], wellenListings);
    expect(seed.termless).toEqual(["Ashcombe"]);
    expect(seed.villages.find((v) => v.name === "Ashcombe")!.terms).toEqual([]);
  });

  it("counts a listing filed under no neighborhood rather than dropping it silently", () => {
    const seed = seedOf([...wellenListings, { subdivision: "SOMETHING ELSE", villageItemId: "id-gone", villageName: "Gone" }]);
    expect(seed.orphanListings).toBe(1);
  });

  it("falls back to the display name when the reference is blank", () => {
    const seed = seedOf([{ subdivision: "TORTUGA", villageItemId: null, villageName: "Tortuga" }]);
    expect(seed.villages.find((v) => v.name === "Tortuga")!.terms).toEqual(["tortuga"]);
  });

  it("copies the tag icons a listing row carries from its neighborhood", () => {
    const seed = deriveVillageSeed(
      [{ _id: "id-oasis", villageName: "Oasis", blueTag1: "https://static.wixstatic.com/media/blue.png", villageSortHelp: "Oasis" }],
      [{ subdivision: "OASIS/WEST VLGS PH 1", villageItemId: "id-oasis", villageName: "Oasis" }]
    );
    expect(seed.villages[0].display).toEqual({
      blueTag1: "https://static.wixstatic.com/media/blue.png",
      villageSortHelp: "Oasis",
    });
  });

  it("skips a neighborhood row with no name it could be keyed on", () => {
    const seed = deriveVillageSeed([{ _id: "id-blank" }, { _id: "id-tortuga", villageName: "Tortuga" }], []);
    expect(seed.skippedRows).toBe(1);
    expect(seed.villages).toHaveLength(1);
  });
});
