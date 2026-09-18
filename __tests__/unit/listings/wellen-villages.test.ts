import { describe, expect, it } from "vitest";
// The seed generator is plain ESM so it can be run from the shell; the test
// checks the transcription of the Wellen Park dashboard code it stands in for.
import { wellenVillages, wellenVillagesSql } from "../../../scripts/listings-wellen-villages.mjs";
import { matchVillage } from "@/lib/listings/classify";
import type { VillageWithTerms } from "@/lib/listings/types";

const ICON = (path: string) => `https://static.wixstatic.com/media/${path}~mv2.png`;
const villageSpa = ICON("d0be81_c5146d6c05f045748f3f247b303b6328");
const maintenance = ICON("d0be81_876ff79d020e487784e082a441bd4d84");
const clubhouse = ICON("d0be81_aae6b9125c784fffbe6b679d403c01d6");
const gated = ICON("d0be81_a4a2f0774819424d9870dda0d94b7f93");
const dogPark = ICON("d0be81_9e082d4621b1411dad4efef57b55a033");
const scenicWalks = ICON("d0be81_8443577a57464e3bb5d27fe1a80f3c0f");
const kidsTotlot = ICON("d0be81_1228248c285845f1a9a0e2073fd93fde");
const tennis = ICON("d0be81_69220d35fef64735ab053df338ee0792");
const greenGolf2 = ICON("d0be81_a475422c6d434323bc793f973c6614ae");
const greenPickleball = ICON("d0be81_c5e0c6d37430473b890404a15eaab04a");
const fiftyFivePlus = ICON("d0be81_eb20d7968b4f44d1a6a2b12829e363d6");
const scenicView = ICON("d0be81_1e052bbc84164a3ebb11411e9b93d840");
const greenPlayground = ICON("d0be81_34c3ed762ada4f1da7b1b15908132e9f");

interface Term { term: string; exclude_term: string | null }
interface Village { name: string; slug: string; itemId: string; pageUrl: string; display: Record<string, string>; terms: Term[] }
const villages = wellenVillages() as unknown as Village[];
const byName = (name: string) => villages.find((v) => v.name === name)!;
const termsOf = (name: string) => byName(name).terms.map((t) => t.term).sort();

/** The neighborhoods as classify would hold them. */
const asVillages: VillageWithTerms[] = villages.map((v) => ({
  id: v.itemId,
  site_id: "wellen",
  name: v.name,
  wix_slug: v.slug,
  wix_item_id: v.itemId,
  page_url: v.pageUrl,
  display: v.display,
  active: true,
  active_listing_count: 0,
  zero_since: null,
  terms: v.terms.map((t) => ({ term: t.term, street_term: null, exclude_term: t.exclude_term })),
}));

describe("Wellen Park neighborhoods seed", () => {
  it("covers every neighborhood the dashboard code maps, each with a page and a Wix item", () => {
    expect(villages).toHaveLength(21);
    for (const v of villages) {
      expect(v.itemId).toMatch(/^[0-9a-f-]{36}$/);
      expect(v.pageUrl).toBe(`https://www.lifeinwellenpark.com/neighborhood/${v.slug}`);
      expect(v.terms.length).toBeGreaterThan(0);
      // Every row carries its own name for the neighborhood sort.
      expect(v.display.villageSortHelp).toBe(v.name);
    }
    // The dashboard percent-encodes the ampersand in this one's page URL.
    expect(byName("Wellen Park Country Club").pageUrl).toBe(
      "https://www.lifeinwellenpark.com/neighborhood/wellen-park-golf-%26-country-club"
    );
  });

  it("keeps terms lowercase and unique across the site (one term, one neighborhood)", () => {
    const all = villages.flatMap((v) => v.terms.map((t) => t.term));
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) expect(t).toBe(t.trim().toLowerCase());
  });

  it("folds the spellings the MLS uses for one neighborhood", () => {
    expect(termsOf("Gran Paradiso")).toEqual(["gran paradiso", "grand paradiso"]);
    expect(termsOf("Sarasota National")).toEqual(["sarasota n", "sarasota national"]);
    expect(termsOf("Wellen Park Country Club")).toEqual([
      "coach homes", "veranda", "wellen golf", "wellen park g", "wellen park golf", "wellen pk golf",
    ]);
    expect(termsOf("Boca Royale")).toEqual(["boca royale", "englewood golf course"]);
  });

  it("carries two exclusions, the Kensington guard and Gran Paradiso's coach homes", () => {
    const withExclusions = villages.flatMap((v) => v.terms.filter((t) => t.exclude_term).map((t) => [v.name, t.term, t.exclude_term]));
    expect(withExclusions).toEqual([
      ["The Preserve", "preserve/west", "kensington"],
      ["Wellen Park Country Club", "coach homes", "gran paradiso"],
    ]);
  });

  it("anchors The Preserve on the two forms the site carries, never on 'preserve' alone", () => {
    // The dashboard's bare "preserve" was safe only because it sorted an
    // already curated id list. As a filter across three cities it swept in
    // Englewood's Hammocks, Grande and Eagle Preserves; see migration 056.
    expect(termsOf("The Preserve")).toEqual(["preserve/west", "the preserve"]);
  });

  it("evaluates the tag ternaries in order, first match wins", () => {
    // Gran Paradiso is in the clubhouse list (third) and the villageSpa
    // list (fifth); the site shows it the clubhouse.
    expect(byName("Gran Paradiso").display.blueTag1).toBe(clubhouse);
    expect(byName("Wellen Park Country Club").display.blueTag1).toBe(villageSpa);
    expect(byName("Lakespur").display.blueTag1).toBe(kidsTotlot);
    expect(byName("Oasis").display.blueTag1).toBe(scenicWalks);
    expect(byName("Wysteria").display.blueTag1).toBe(maintenance);
  });

  it("gives each neighborhood the three tags the site shows it", () => {
    expect(byName("Boca Royale").display).toEqual({ villageSortHelp: "Boca Royale", blueTag1: clubhouse, purpleTag1: tennis, greenTag1: greenGolf2 });
    expect(byName("Brightmore").display).toEqual({ villageSortHelp: "Brightmore", blueTag1: clubhouse, purpleTag1: fiftyFivePlus, greenTag1: greenPickleball });
    expect(byName("Solstice").display).toEqual({ villageSortHelp: "Solstice", blueTag1: clubhouse, purpleTag1: tennis, greenTag1: dogPark });
    expect(byName("Antigua").display).toEqual({ villageSortHelp: "Antigua", blueTag1: maintenance, purpleTag1: gated, greenTag1: scenicView });
    expect(byName("Tortuga").display).toEqual({ villageSortHelp: "Tortuga", blueTag1: maintenance, purpleTag1: gated, greenTag1: greenPlayground });
    // Ashcombe is in no purple or green list, so it carries neither.
    expect(byName("Ashcombe").display).toEqual({ villageSortHelp: "Ashcombe", blueTag1: clubhouse });
  });
});

describe("Wellen Park terms through classify", () => {
  const cases: Array<[subdivision: string, village: string | null]> = [
    // The site's own rows, as its crawled homes-for-sale page carried them.
    ["GRAN PARADISO PH 1", "Gran Paradiso"],
    ["COACH HOMES 2/GRAN PARADISO PH", "Gran Paradiso"],
    ["GRAND PARADISO", "Gran Paradiso"],
    ["WELLEN PARK GOLF & COUNTRY CLB", "Wellen Park Country Club"],
    ["WELLEN PARK GOLF AND COUNTRY CLUB", "Wellen Park Country Club"],
    ["ISLANDWALK/WEST VLGS PH 3A, 3", "IslandWalk"],
    ["GRAND PALM PH 1AA", "Grand Palm"],
    ["SARASOTA NATIONAL PH 13-B", "Sarasota National"],
    ["LAKESPUR/WELLEN PARK", "Lakespur"],
    ["SOLSTICE PH TWO", "Solstice"],
    ["EVERLY AT WELLEN PARK", "Everly"],
    ["BOCA ROYALE UN 16", "Boca Royale"],
    ["SUNSTONE VILLAGE F5 PH 1A & 1B", "Sunstone"],
    ["OASIS/WEST VLGS PH 1", "Oasis"],
    ["WYSTERIA WELLEN PARK VILLAGE F-4", "Wysteria"],
    ["TORTUGA", "Tortuga"],
    // The dashboard's abbreviation, which no listing used on the day.
    ["WELLEN PK GOLF & CC", "Wellen Park Country Club"],
    // Nothing in Wellen Park.
    ["PELICAN POINTE GOLF & COUNTRY CLUB", null],
  ];

  it.each(cases)("files %s under %s", (subdivision, expected) => {
    expect(matchVillage(subdivision, null, asVillages)?.name ?? null).toBe(expected);
  });

  it("takes Kensington's preserve back off The Preserve, and leaves the rest", () => {
    expect(matchVillage("PRESERVE/WEST VILLAGES PH 1", null, asVillages)?.name).toBe("The Preserve");
    expect(matchVillage("PRESERVE/WEST VLGS PH 2", null, asVillages)?.name).toBe("The Preserve");
    expect(matchVillage("THE PRESERVE", null, asVillages)?.name).toBe("The Preserve");
    expect(matchVillage("KENSINGTON PRESERVE", null, asVillages)).toBeNull();
    expect(matchVillage("PRESERVE AT KENSINGTON PH 2", null, asVillages)).toBeNull();
  });

  it("leaves Englewood's preserves alone, which bare 'preserve' did not", () => {
    // The four that reached HousesforSale2 on the first discovery run, plus
    // the one queued behind them. None are Wellen Park.
    for (const subdivision of [
      "HAMMOCKS PRESERVE PH 01",
      "HAMMOCKS PRESERVE PH 14",
      "HAMMOCKS-PRESERVE PHASE 14 BUILD",
      "GRANDE PRESERVE ON LEMON BAY P",
      "EAGLE PRESERVE ESTATES",
    ]) {
      expect(matchVillage(subdivision, null, asVillages), subdivision).toBeNull();
    }
  });

  it("reaches the country club's condos without a bare 'wellen park' term", () => {
    // Migration 060. Both of these say WELLEN PARK and both sit inside the
    // club -- 0.12 and 0.06 miles from listings the site already shows
    // there -- and the two golf terms reached only its single-family
    // spellings.
    expect(matchVillage("COACH HOMES II AT WELLEN PARK, PH 2", null, asVillages)?.name).toBe("Wellen Park Country Club");
    expect(matchVillage("VERANDA III/WELLEN PARK PH I", null, asVillages)?.name).toBe("Wellen Park Country Club");
    expect(matchVillage("WELLEN PARK G & CC", null, asVillages)?.name).toBe("Wellen Park Country Club");
    expect(matchVillage("WELLEN GOLF & COUNTRY CLUB", null, asVillages)?.name).toBe("Wellen Park Country Club");
  });

  it("leaves Gran Paradiso's coach homes where they are", () => {
    // Three of the five "coach homes" subdivisions in the database are Gran
    // Paradiso's. Longest-wins would settle it -- "gran paradiso" is 13 to
    // "coach homes" 11 -- but the exclusion is what says so.
    for (const sub of ["COACH HOMES 1 AT GRAN PARADISO", "COACH HOMES 3/GRAN PARADISO PH", "COACH HOMES 4/GRAN PARADISO PH"]) {
      expect(matchVillage(sub, null, asVillages)?.name).toBe("Gran Paradiso");
    }
  });

  it("never lets a term take a neighborhood's own listings onto the country club page", () => {
    // The repair not made: a bare "wellen park" is 11 characters and would
    // outrank every one of these, which is why the terms name the products.
    expect(matchVillage("BRIGHTMORE AT WELLEN PARK", null, asVillages)?.name).toBe("Brightmore");
    expect(matchVillage("SUNSTONE AT WELLEN PARK", null, asVillages)?.name).toBe("Sunstone");
    expect(matchVillage("SUNSTONE LAKESIDE AT WELLEN PARK", null, asVillages)?.name).toBe("Sunstone");
    expect(matchVillage("LAKESPUR AT WELLEN PARK", null, asVillages)?.name).toBe("Lakespur");
    expect(matchVillage("PALMERA AT WELLEN PARK", null, asVillages)?.name).toBe("Palmera");
    expect(matchVillage("ANTIGUA/WELLEN PARK", null, asVillages)?.name).toBe("Antigua");
    expect(matchVillage("SOLSTICE AT WELLEN PARK", null, asVillages)?.name).toBe("Solstice");
    expect(matchVillage("EVERLY/WELLEN PARK", null, asVillages)?.name).toBe("Everly");
    expect(matchVillage("AVELINA WELLEN PARK VILLAGE F-2", null, asVillages)?.name).toBe("Avelina");
  });

  it("answers to Boca Royale's old name, and stops there", () => {
    expect(matchVillage("ENGLEWOOD GOLF COURSE", null, asVillages)?.name).toBe("Boca Royale");
    // Its sibling on Barbados Road is deliberately not covered: the name
    // fits Boca Royale, its neighbours do not, and nobody here can settle it.
    expect(matchVillage("ENGLEWOOD GOLF VILLAS 11", null, asVillages)).toBeNull();
  });

  it("keeps THE RESERVE off The Preserve's page", () => {
    // One letter apart, and the two Tremingham Way homes it names are
    // seven-figure listings in their own enclave next to Gran Paradiso.
    expect(matchVillage("THE RESERVE", null, asVillages)).toBeNull();
  });

  it("lets the longer spelling win where two terms of one neighborhood overlap", () => {
    // "sarasota n" is inside "sarasota national"; both are Sarasota National,
    // so the overlap is harmless, but the longer one is the one that matches.
    expect(matchVillage("SARASOTA NATIONAL", null, asVillages)?.name).toBe("Sarasota National");
  });
});

describe("Wellen Park seed SQL", () => {
  const sql = wellenVillagesSql() as unknown as string;

  it("says what it carries and targets the site by domain", () => {
    expect(sql).toContain("-- 21 neighborhoods, 30 subdivision terms");
    expect(sql).toContain("WHERE domain = 'lifeinwellenpark.com'");
  });

  it("writes the exclusion as a column, not as part of the term", () => {
    expect(sql).toContain("('The Preserve', 'preserve/west', 'kensington')");
    expect(sql).toContain("INSERT INTO ls_village_terms (site_id, village_id, term, exclude_term)");
  });

  it("re-runs without duplicating anything", () => {
    expect(sql).toContain("ON CONFLICT (site_id, name) DO UPDATE SET");
    expect(sql).toContain("ON CONFLICT DO NOTHING;");
  });
});
