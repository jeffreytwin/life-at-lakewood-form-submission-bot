import { describe, expect, it } from "vitest";
// The seed generator is plain ESM so it can be run from the shell; the test
// checks the transcription of the Parrish dashboard code it stands in for.
import { parrishVillages, parrishVillagesSql } from "../../../scripts/listings-parrish-villages.mjs";

const ICON = (id: string) => `https://static.wixstatic.com/media/${id}~mv2.png`;
const clubhouse = ICON("d0be81_aae6b9125c784fffbe6b679d403c01d6");
const gated = ICON("d0be81_12f5e34e37d54c11a1b630db35b9fcd6");
const fiftyFivePlus = ICON("d0be81_8d4ae4966d7144039c8a9e212c09b48f");
const purpleTennis = ICON("d0be81_7b27a5adc02a4354a2b7892f7af85c2c");
const greenPickleball = ICON("d0be81_b01f771f67cf41c6b51d04672c8b0da0");
const yellowPlayground = ICON("d0be81_1228248c285845f1a9a0e2073fd93fde");

interface Village { name: string; slug: string; itemId: string; pageUrl: string; display: Record<string, string>; terms: string[] }
const villages = parrishVillages() as unknown as Village[];
const byName = (name: string) => villages.find((v) => v.name === name)!;

describe("Parrish neighborhoods seed", () => {
  it("covers every neighborhood the dashboard code maps, each with a page and a Wix item", () => {
    expect(villages).toHaveLength(51);
    for (const v of villages) {
      expect(v.itemId).toMatch(/^[0-9a-f-]{36}$/);
      expect(v.pageUrl).toBe(`https://www.lifeatparrish.com/neighborhood/${v.slug}`);
      expect(v.terms.length).toBeGreaterThan(0);
    }
  });

  it("keeps terms lowercase and unique across the site (one term, one neighborhood)", () => {
    const all = villages.flatMap((v) => v.terms);
    expect(all).toHaveLength(63);
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) expect(t).toBe(t.trim().toLowerCase());
  });

  it("folds the North River Ranch aliases, the Salt Meadows spellings and the Willows/Laurels pair", () => {
    expect(byName("North River Ranch").terms.sort()).toEqual(["brightwood", "crescent creek", "del webb explore", "highview", "longmeadow", "north river ranch", "riverfield", "wildleaf"]);
    expect(byName("Salt Meadows").terms.sort()).toEqual(["salt meadows", "saltmdws", "saltmeadows"]);
    expect(byName("The Willows & The Laurels").terms.sort()).toEqual(["laurels", "willows"]);
    expect(byName("Oakfield").terms.sort()).toEqual(["oakfield lakes", "oakfield trails"]);
  });

  it("evaluates the tag ternaries in order, first match wins", () => {
    // Prosperity Lakes is in no green list before the 55+ one.
    expect(byName("Prosperity Lakes").display).toEqual({ blueTag1: clubhouse, purpleTag1: gated, greenTag1: fiftyFivePlus });
    // Del Webb At Bayview hits the pickleball list before the 55+ list (which spells it "at").
    expect(byName("Del Webb At Bayview").display).toEqual({ blueTag1: clubhouse, purpleTag1: purpleTennis, greenTag1: greenPickleball });
    // Foxbrook only has a blue tag; Riversong has none.
    expect(byName("Foxbrook").display).toEqual({ blueTag1: yellowPlayground });
    expect(byName("Riversong").display).toEqual({});
  });

  it("emits idempotent SQL keyed by the site domain", () => {
    const sql = parrishVillagesSql() as string;
    expect(sql).toContain("WHERE domain = 'lifeatparrish.com'");
    expect(sql).toContain("ON CONFLICT (site_id, name) DO UPDATE");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(sql).toContain("('The Willows & The Laurels', 'willows')");
  });
});
