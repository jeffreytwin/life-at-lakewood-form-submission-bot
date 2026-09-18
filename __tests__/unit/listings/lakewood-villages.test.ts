import { describe, expect, it } from "vitest";
// The seed generator is plain ESM so it can be run from the shell; this
// checks it against the two things it stands in for -- the site's dashboard
// page code, and the live collection that code has been filling.
import { lakewoodVillages, lakewoodVillagesSql, BARE_TERMS } from "../../../scripts/listings-lakewood-villages.mjs";
import { matchVillage } from "@/lib/listings/classify";
import type { VillageWithTerms } from "@/lib/listings/types";
import exportFixture from "../../fixtures/listings/lakewood-housesforsale.json";

interface Term { term: string; exclude_term: string | null }
interface Village { name: string; slug: string; itemId: string; pageUrl: string; display: Record<string, string>; terms: Term[]; unconfirmed: boolean }
const villages = lakewoodVillages() as unknown as Village[];
const byName = (name: string) => villages.find((v) => v.name === name)!;
const termsOf = (name: string) => byName(name).terms.map((t) => t.term).sort();
const allTerms = villages.flatMap((v) => v.terms.map((t) => t.term));

/** The neighborhoods as classify would hold them. */
const asVillages: VillageWithTerms[] = villages.map((v) => ({
  id: v.itemId,
  site_id: "lakewood",
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

const fileUnder = (subdivision: string) => matchVillage(subdivision, null, asVillages)?.name ?? null;

/** The one row the anchored Esplanade terms deliberately cannot reach. */
const UNREACHABLE = "ESPLANADE";
/** The site's label -> this seed's label, where the two differ on purpose. */
const RELABELLED: Record<string, string> = { Riverwalk: "Summerfield" };

describe("Life At Lakewood neighborhoods seed", () => {
  it("covers every neighborhood the dashboard code maps, each with a page, a Wix item and a term", () => {
    expect(villages).toHaveLength(39);
    for (const v of villages) {
      expect(v.name).toBeTruthy();
      expect(v.itemId).toMatch(/^[0-9a-f-]{36}$/);
      expect(v.pageUrl).toBe(`https://www.lifeatlakewood.com/${v.slug}`);
      expect(v.terms.length).toBeGreaterThan(0);
      expect(v.display.villageSortHelp).toBeTruthy();
    }
    // One Wix row, one neighborhood. ls_villages has a unique index on
    // (site_id, wix_item_id) because village-stats writes each
    // neighborhood's counts back to its row, and two neighborhoods sharing
    // one row would overwrite each other.
    const ids = villages.map((v) => v.itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("folds Riverwalk into Summerfield, because the dashboard gives them one Wix row", () => {
    // The dashboard has two blocks and two labels for them but writes the
    // same village1 and the same page, "summerfield-and-riverwalk". The two
    // RIVERWALK listings therefore file under Summerfield here; that is a
    // visible change to those two rows and the only one on the site.
    expect(villages.find((v) => v.name === "Riverwalk")).toBeUndefined();
    expect(termsOf("Summerfield")).toEqual(["riverwalk ridge", "riverwalk village", "summerfield hollow", "summerfield village"]);
    expect(fileUnder("RIVERWALK RIDGE")).toBe("Summerfield");
    expect(fileUnder("RIVERWALK VILLAGE CYPRESS BANKS SP H 1&2")).toBe("Summerfield");
    expect(byName("Summerfield").slug).toBe("summerfield-and-riverwalk");
  });

  it("files all 404 of the site's own listings exactly where the site files them", () => {
    const misfiled: string[] = [];
    const unmatched: string[] = [];
    let placed = 0;
    for (const pair of exportFixture.pairs) {
      const got = fileUnder(pair.subdivision);
      const want = RELABELLED[pair.village] ?? pair.village;
      if (got === null) unmatched.push(pair.subdivision);
      else if (got !== want) misfiled.push(`${pair.subdivision}: site says ${pair.village}, terms say ${got}`);
      else placed += pair.listings;
    }
    // Nothing may ever be filed under the wrong neighborhood. That is the
    // failure that put four Englewood listings on Wellen Park.
    expect(misfiled).toEqual([]);
    expect(unmatched).toEqual([UNREACHABLE]);
    expect(placed).toBe(exportFixture._listings - 1);
  });

  it("drops the nine dashboard terms that already collide in other markets", () => {
    // Each of these matches subdivisions the engine holds in Venice, North
    // Port, Englewood, Parrish or Longboat Key -- five cities this site does
    // not even cover. The replacement is on the right.
    expect(allTerms).not.toContain("isles");
    expect(termsOf("The Isles")).toEqual(["isles at lakewood ranch"]);
    expect(allTerms).not.toContain("emerald");
    expect(termsOf("Waterside - Emerald Landing")).toEqual(["emerald landing", "emerald lndg"]);
    expect(allTerms).not.toContain("edgewater");
    expect(termsOf("Edgewater")).toEqual(["edgewater village", "moorings at edgewater"]);
    expect(allTerms).not.toContain("esplanade");
    expect(allTerms).not.toContain("riverwalk");
    expect(allTerms).not.toContain("sweetwater");
    expect(allTerms).not.toContain("windward");
    expect(allTerms).not.toContain("harmony");
    expect(allTerms).not.toContain("savanna");
    expect(allTerms).not.toContain("summerfield");
    expect(allTerms).not.toContain("central park");
  });

  it("drops 'country club village', which covered nothing of its own", () => {
    // The dashboard's third Country Club term. Every row it would have
    // caught is already caught by one of the other two, and it would match
    // any "... COUNTRY CLUB VILLAGE" in Bradenton or Sarasota.
    expect(allTerms).not.toContain("country club village");
    expect(termsOf("The Country Club")).toEqual(["lakewood ranch cc", "lakewood ranch country club"]);
  });

  it("lets the longer term settle Country Club East against The Country Club", () => {
    // The site files this one under The Country Club although it says EAST.
    expect(fileUnder("LAKEWOOD RANCH COUNTRY CLUB EAST BELLEISLE")).toBe("The Country Club");
    expect(fileUnder("COUNTRY CLUB EAST AT LAKEWOOD RANCH")).toBe("Country Club East");
    expect(fileUnder("CLUBSIDE AT COUNTRY CLUB EAST PH II")).toBe("Country Club East");
  });

  it("keeps Azario's Esplanade apart from the original one", () => {
    expect(fileUnder("AZARIO ESPLANADE PH II SUBPH C-O")).toBe("Azario - Esplanade");
    expect(fileUnder("AZARIO LAKEWOOD RANCH")).toBe("Azario - Esplanade");
    expect(fileUnder("ESPLANADE PH III A,B,C,D,J&PART OF F")).toBe("Esplanade Golf & Country Club");
    expect(fileUnder("BACCIANO IV AT ESPLANADE LWR PH 30")).toBe("Esplanade Golf & Country Club");
    // The anchored Esplanade terms all carry the dashboard's azario guard.
    for (const t of byName("Esplanade Golf & Country Club").terms) {
      if (t.term !== "bacciano") expect(t.exclude_term).toBe("azario");
    }
  });

  it("leaves an Esplanade in another market alone", () => {
    // The shapes this MLS uses elsewhere: a place name always sits between
    // the brand and the phase marker, which is what "esplanade ph" relies on.
    expect(fileUnder("ESPLANADE AT WELLEN PARK")).toBeNull();
    expect(fileUnder("ESPLANADE ON PALMER RANCH PH 1")).toBeNull();
    expect(fileUnder("ESPLANADE AT SKYE RANCH PH II")).toBeNull();
  });

  it("leaves the other markets' near misses alone", () => {
    expect(fileUnder("ENGLEWOOD ISLES SUB")).toBeNull();
    expect(fileUnder("LEMON BAY ISLES PH 02")).toBeNull();
    expect(fileUnder("EMERALD HARBOR")).toBeNull();
    expect(fileUnder("EDGEWATER CENTER PH 01 BLDG A")).toBeNull();
    expect(fileUnder("RIVERWALK MHP CO-OP")).toBeNull();
    expect(fileUnder("SWEETWATER VILLAS AT SOUTHWOOD UNIT 2 PH 2")).toBeNull();
    expect(fileUnder("WINDWARD BAY AMD")).toBeNull();
  });

  it("names the terms no anchor was available for, so the probe can check them", () => {
    // These are the ones the MLS writes with nothing to anchor to. They are
    // the open risk this site carries into its first shadow run.
    expect([...BARE_TERMS].sort()).toEqual(["aurora", "cresswind", "del webb", "indigo", "lake club", "palisades"]);
    for (const term of BARE_TERMS) expect(allTerms).toContain(term);
  });

  it("carries the dashboard's tag icons, as the live collection stores them", () => {
    const fit = (id: string) => `https://static.wixstatic.com/media/${id}~mv2.png/v1/fit/w_924,h_520/${id}~mv2.png`;
    const plain = (id: string) => `https://static.wixstatic.com/media/${id}~mv2.png`;
    // The export carries exactly one icon per neighborhood; these are four of them.
    expect(byName("The Country Club").display).toEqual({
      villageSortHelp: "The Country Club",
      blueTag1: fit("d0be81_b31fc860894445a89f08c3fb8b530e34"),
      purpleTag1: fit("d0be81_1f03e4c773b540359c5228a34fcf0ff3"),
      greenTag1: plain("d0be81_ba68daa783d14ab68ac7dc7082fa3d63"),
    });
    expect(byName("Aurora").display.blueTag1).toBe(plain("d0be81_4f9303a511cc42fa986017d290513167"));
    expect(byName("Aurora").display.greenTag1).toBe(plain("d0be81_51600c69200340bf92f94d78f4f47d60"));
    // Two the ternaries leave bare, which the export confirms carry no icon.
    expect(byName("Avalon Woods").display.purpleTag1).toBeUndefined();
    expect(byName("Avalon Woods").display.greenTag1).toBeUndefined();
    expect(byName("Waterside - Avanti").display.purpleTag1).toBeUndefined();
    expect(byName("Edgewater").display.greenTag1).toBeUndefined();
  });

  it("sorts the three neighborhoods the site files under another word", () => {
    expect(byName("Esplanade Golf & Country Club").display.villageSortHelp).toBe("Original Esplanade");
    expect(byName("Azario - Park East").display.villageSortHelp).toBe("Park East - Azario");
    expect(byName("Waterside - LakeHouse Cove").display.villageSortHelp).toBe("LakeHouse Cove - Waterside");
    expect(byName("Harmony").display.villageSortHelp).toBe("Harmony");
  });

  it("marks the four neighborhoods the export cannot confirm", () => {
    const unconfirmed = villages.filter((v) => v.unconfirmed).map((v) => v.name).sort();
    expect(unconfirmed).toEqual(["Palisades", "Waterside - Shellstone", "Waterside - The Alcove", "Windward"]);
    // Their terms are guesses at a spelling this MLS has never shown us, so
    // they are narrow by choice: nothing of theirs can reach another site.
    expect(termsOf("Waterside - The Alcove")).toEqual(["alcove/waterside", "alcove at waterside"].sort());
    expect(termsOf("Windward")).toEqual(["windward/lakewood", "windward at lakewood"].sort());
  });

  it("emits SQL that quotes the one name with an ampersand and both tables' rows", () => {
    const sql = lakewoodVillagesSql() as string;
    expect(sql).toContain("'Esplanade Golf & Country Club'");
    expect(sql).toContain("INSERT INTO ls_villages");
    expect(sql).toContain("INSERT INTO ls_village_terms");
    expect(sql).toContain("WHERE domain = 'lifeatlakewood.com'");
    expect(sql).toContain(`-- ${villages.length} neighborhoods, ${allTerms.length} subdivision terms`);
    // The exclusions travel with their terms, not as a bare NULL column.
    expect(sql).toContain("'esplanade ph', 'azario'");
  });
});
