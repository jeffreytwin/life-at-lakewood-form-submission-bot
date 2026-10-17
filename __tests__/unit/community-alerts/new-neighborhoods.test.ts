import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  cleanSubdivision,
  DISMISS_QUIET_DAYS,
  groupHomes,
  isQuiet,
  lakewoodRanchHomes,
  MIN_MLS_HOMES,
  mlsHomes,
  placeKey,
  titleCase,
  wellenParkHomes,
} from "@/lib/community-alerts/new-neighborhoods";
import type { VillageWithTerms } from "@/lib/listings/types";

describe("placeKey", () => {
  it("reads Wellen Park's home-finder names as the engines' names", () => {
    expect(placeKey("esplanade")).toBe(placeKey("Esplanade at Wellen Park"));
    expect(placeKey("wellen-park-golf-country-club")).toBe(placeKey("Wellen Park Country Club"));
    expect(placeKey("boca-royale")).toBe(placeKey("Boca Royale"));
  });

  it("reads Lakewood Ranch's village names as the engines' names", () => {
    expect(placeKey("Waterside – Wild Blue")).toBe(placeKey("Waterside - Wild Blue"));
  });

  it("keeps a different neighborhood different", () => {
    expect(placeKey("Star Farms East")).not.toBe(placeKey("Star Farms"));
    expect(placeKey("Waterbury Park")).not.toBe(placeKey("Waterbury"));
  });

  it("is empty for a name that is only the place", () => {
    expect(placeKey("WELLEN PARK")).toBe("");
    expect(placeKey("Lakewood Ranch")).toBe("");
  });
});

describe("cleanSubdivision", () => {
  it("drops the county's code, the note and the phase", () => {
    expect(cleanSubdivision("3458 - STRAND AT CEDAR GROVE")).toBe("STRAND AT CEDAR GROVE");
    expect(cleanSubdivision("4556; REAGAN LANDING --- PRELIM")).toBe("REAGAN LANDING");
    expect(cleanSubdivision("SEAFLOWER PH I SUBPH IA AND IB-1 PB82/60")).toBe("SEAFLOWER");
    expect(cleanSubdivision("GRAND PARK PHASE 2")).toBe("GRAND PARK");
    expect(cleanSubdivision("WATERCOLOR PLACE I")).toBe("WATERCOLOR PLACE");
  });

  it("leaves a plain name alone", () => {
    expect(cleanSubdivision("RIVER PRESERVE ESTATES")).toBe("RIVER PRESERVE ESTATES");
  });
});

describe("titleCase", () => {
  it("spells a slug or a shouted name as a name", () => {
    expect(titleCase("wellen-park-golf-country-club")).toBe("Wellen Park Golf Country Club");
    expect(titleCase("RIVER PRESERVE ESTATES")).toBe("River Preserve Estates");
  });
});

describe("groupHomes", () => {
  it("gathers the homes into neighborhoods, with their builders and prices", () => {
    const groups = groupHomes([
      { neighborhood: "RIVER PRESERVE ESTATES", builder: null, price: 694_990 },
      { neighborhood: "THE RIVER PRESERVE ESTATES", builder: null, price: 1_100_000 },
      { neighborhood: "RIVER PRESERVE ESTATES", builder: "Neal", price: null },
      { neighborhood: "GOLD STAR RANCHES", builder: null, price: 925_000 },
    ]);
    expect(groups[0]).toEqual({
      key: placeKey("River Preserve Estates"),
      name: "River Preserve Estates",
      homes: 3,
      builders: ["Neal"],
      priceLow: 694_990,
      priceHigh: 1_100_000,
    });
    expect(groups[1].name).toBe("Gold Star Ranches");
  });

  it("leaves out a name that is only the place", () => {
    expect(groupHomes([{ neighborhood: "WELLEN PARK", builder: null, price: 1 }])).toEqual([]);
  });
});

describe("wellenParkHomes", () => {
  it("reads every card's neighborhood and builder", () => {
    const html = readFileSync(join(__dirname, "../../fixtures/floorplans/wellenpark-cards.html"), "utf8");
    const homes = wellenParkHomes(html);
    expect(homes.map((h) => h.neighborhood)).toEqual(["palmera", "sunstone", "palmera"]);
    expect(homes.map((h) => h.builder)).toEqual(["homes-by-towne", "mattamy-homes", "mi-homes"]);
  });
});

describe("lakewoodRanchHomes", () => {
  const hotel = (name: string, village: string) => `
  <div class="hotel ">
    <div class="hotel-photo relative" style="background-image:url(https://lakewoodranch.com/wp-content/uploads/a.jpg);">
      <a class="full-link" href="https://lakewoodranch.com/homes/x/"></a>
    </div>
    <p class="subhead mb-10"><em>Single-Family Home</em></p>
    <h4 class="coral bold no-btm">${name}</h4>
    <h4 class="dark-grey mb-10">Homes From $1,368,000</h4>
    <p class="no-btm"><strong>Village: </strong>${village}</p>
    <p><strong>Builder: </strong>Lee Wetherington Homes</p>
  </div>`;

  it("reads the village and builder each card spells out", () => {
    const homes = lakewoodRanchHomes(
      `<div class="hotels">${hotel("Azure", "Waterside &#8211; Wild Blue")}${hotel("Pine", "Hawkstone")}</div><footer></footer>`,
      "https://lakewoodranch.com"
    );
    expect(homes).toHaveLength(2);
    expect(placeKey(homes[0].neighborhood)).toBe(placeKey("Waterside - Wild Blue"));
    expect(homes[1]).toEqual({ neighborhood: "Hawkstone", builder: "Lee Wetherington Homes", price: 1_368_000 });
  });
});

describe("mlsHomes", () => {
  const villages = [
    { id: "v1", name: "Twin Rivers", active: true, terms: [{ term: "twin rivers", street_term: null, exclude_term: null }] },
  ] as unknown as VillageWithTerms[];

  it("keeps the listings no listings-engine term takes, by cleaned subdivision", () => {
    const homes = mlsHomes(
      [
        { subdivision: "TWIN RIVERS PH 2", street_text: null, list_price: 500_000 },
        { subdivision: "RIVER PRESERVE ESTATES", street_text: null, list_price: 700_000 },
        { subdivision: null, street_text: null, list_price: 1 },
      ],
      villages
    );
    expect(homes).toEqual([{ neighborhood: "RIVER PRESERVE ESTATES", builder: null, price: 700_000 }]);
  });

  it("asks for more than a lot or two before a subdivision is a neighborhood", () => {
    expect(MIN_MLS_HOMES).toBeGreaterThanOrEqual(3);
  });
});

describe("isQuiet", () => {
  const now = new Date("2026-10-17T12:00:00Z").getTime();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

  it("keeps an ignored name quiet for good", () => {
    expect(isQuiet("k", { ignored: new Set(["k"]), closed: [], now })).toBe(true);
  });

  it("keeps a finished one quiet for good", () => {
    expect(isQuiet("k", { ignored: new Set(), closed: [{ subject_key: "k", status: "done", resolved_at: daysAgo(400) }], now })).toBe(true);
  });

  it("keeps a dismissed one quiet for a while, then asks again", () => {
    const dismissed = (d: number) => [{ subject_key: "k", status: "dismissed", resolved_at: daysAgo(d) }];
    expect(isQuiet("k", { ignored: new Set(), closed: dismissed(2), now })).toBe(true);
    expect(isQuiet("k", { ignored: new Set(), closed: dismissed(DISMISS_QUIET_DAYS + 1), now })).toBe(false);
  });

  it("is not quiet for a name never seen", () => {
    expect(isQuiet("k", { ignored: new Set(["other"]), closed: [], now })).toBe(false);
  });
});
