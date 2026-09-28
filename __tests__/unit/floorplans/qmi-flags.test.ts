import { describe, expect, it } from "vitest";
import { flagFixes, linkFixes, markersFor } from "@/lib/floorplans/qmi-flags";
import type { WixDataItem } from "@/lib/wix/client";

let n = 0;
const row = (data: Record<string, unknown>): WixDataItem => ({ id: `item-${++n}`, dataCollectionId: "FloorPlansV2", data });
const plan = (name: string, has: boolean, over: Record<string, unknown> = {}) =>
  row({ floorPlanName: name, builder: "Lennar", village: "Calusa Country Club", ...markersFor(has), ...over });
const home = (address: string, under: string, over: Record<string, unknown> = {}) =>
  row({ floorPlanName: address, builder: "Lennar", village: "Calusa Country Club", relatedFloorPlanQuickMoveInOnly: under, ...over });

describe("quick move-in flags (Jeff, 2026-09-25)", () => {
  it("sets the flag on a floor plan with a quick move-in under it, and clears it on one without", () => {
    // Calusa Country Club: Bromelia II had a home and no flag; Napoli Grande a flag and no home.
    const bromelia = plan("Bromelia II", false);
    const napoli = plan("The Napoli Grande", true);
    const { fixes, problems } = flagFixes([bromelia, napoli, home("123 Palm Way", "Bromelia II")]);
    expect(problems).toEqual([]);
    expect(fixes).toEqual([
      expect.objectContaining({ itemId: bromelia.id, has: true, homes: 1 }),
      expect.objectContaining({ itemId: napoli.id, has: false, homes: 0 }),
    ]);
  });

  it("leaves a floor plan alone when its flag is right, however Wix spells the pictures", () => {
    const right = plan("Bromelia II", true, {
      constructionDot: "wix:image://v1/d0be81_f345a9c85f234f6b8f240bbdefa0ed9b~mv2.png/dot.png#originWidth=20&originHeight=20",
      quickMoveInImage: "wix:image://v1/28c2d7_1e474c9af37440efa879388e9827b4a9~mv2.png/badge.png#originWidth=90&originHeight=30",
    });
    expect(flagFixes([right, home("123 Palm Way", "bromelia ii")]).fixes).toEqual([]);
  });

  it("counts only published quick move-ins, of the same builder and community", () => {
    const palm = plan("Palm", true);
    const fixes = flagFixes([
      palm,
      home("1 Draft St", "Palm", { _publishStatus: "DRAFT" }),
      home("2 Elsewhere St", "Palm", { village: "Everly" }),
    ]).fixes;
    expect(fixes).toEqual([expect.objectContaining({ itemId: palm.id, has: false })]);
  });

  it("puts right the banner, badge and dot that do not go with the flag", () => {
    const halfway = plan("Jubilee", true, { newConstructionOrMoveIn: "NEW CONSTRUCTION" });
    expect(flagFixes([halfway, home("9 Jubilee Ct", "Jubilee")]).fixes).toEqual([expect.objectContaining({ itemId: halfway.id, has: true })]);
  });

  it("reports a quick move-in it cannot place, and a name two floor plans share, instead of guessing", () => {
    const a = plan("Sanctuary", false);
    const b = plan("Sanctuary", false);
    const { fixes, problems } = flagFixes([a, b, home("5 Oak Ln", "Sanctuary"), home("7 Oak Ln", "Sancturay")]);
    expect(fixes).toEqual([]);
    expect(problems.map((p) => p.kind).sort()).toEqual(["no-plan", "same-name", "same-name"]);
  });

  it("adds no markers to a row that shows none and has nothing under it (it may be a home missing its floor plan)", () => {
    const bare = row({ floorPlanName: "2207 Anders Drive", builder: "Richmond American Homes", village: "Estates at Rivers Edge" });
    expect(flagFixes([bare]).fixes).toEqual([]);
  });
});

describe("a row's builder and neighborhood links (Jeff, 2026-09-28)", () => {
  const found = { builderId: "richmond", villageId: "crosswind" };
  const parrish = (data: Record<string, unknown>) => row({ floorPlanName: "Fraser", builder: "Richmond American Homes", village: "Estates at Rivers Edge", ...data });

  it("sets a link a row is missing", () => {
    const blank = parrish({ builder1: "", villages: null });
    expect(linkFixes([blank], () => ({ builderId: "richmond", villageId: "rivers-edge" }))).toEqual([
      expect.objectContaining({ itemId: blank.id, builder1: "richmond", villages: "rivers-edge" }),
    ]);
  });

  it("moves a Crosswind Point or Crosswind Ranch row to Crosswind's page", () => {
    const point = row({ floorPlanName: "Aspen", builder: "Homes by WestBay", village: "Crosswind Point", builder1: "westbay", villages: "crosswind-point" });
    const ranch = row({ floorPlanName: "Birch", builder: "Homes by WestBay", village: "Crosswind Ranch", builder1: "westbay", villages: { _id: "crosswind-ranch" } });
    const fixes = linkFixes([point, ranch], () => ({ builderId: "westbay", villageId: "crosswind" }));
    expect(fixes).toEqual([
      expect.objectContaining({ itemId: point.id, villages: "crosswind" }),
      expect.objectContaining({ itemId: ranch.id, villages: "crosswind" }),
    ]);
    expect(fixes.every((f) => f.builder1 === undefined)).toBe(true);
  });

  it("leaves a link set by hand, one already right, and a name that finds nothing", () => {
    const byHand = parrish({ builder1: "richmond-2", villages: "rivers-edge-2" });
    const right = row({ floorPlanName: "Aspen", builder: "Homes by WestBay", village: "Crosswind Point", builder1: "westbay", villages: "crosswind" });
    const unknown = parrish({ builder1: "", villages: "" });
    expect(linkFixes([byHand], () => found)).toEqual([]);
    expect(linkFixes([right], () => ({ builderId: "westbay", villageId: "crosswind" }))).toEqual([]);
    expect(linkFixes([unknown], () => ({ builderId: null, villageId: null }))).toEqual([]);
  });
});
