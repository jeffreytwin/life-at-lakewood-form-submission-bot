import { describe, expect, it } from "vitest";
import { fieldChanges, mergeForUpdate, samePictures, withDescriptionFrom } from "@/lib/floorplans/diff";
import { fullSize, onePerPicture, pictureKey } from "@/lib/floorplans/extractors/plan-page";
import { viewerFills } from "@/lib/floorplans/extractors/claude-extract";
import { withKnownSpellings } from "@/lib/floorplans/pictures";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Addresses from the queue (Neal's Canoe Creek and Meritage's Salt Meadows, Jeff 2026-09-25).
const up = "https://images.nealcommunities.com/wp-content/uploads";
const q1600 = "?auto=format%2Ccompress&#038;fit=crop&#038;ar=16%3A9&#038;w=1600";
const azureOld = [
  `${up}/2026/02/23101805/Canoe-Creek_-Azure-60-4443-Elevation-FH1.jpg?auto=format%2Ccompress&fit=max&w=1000`,
  `${up}/2026/02/10104751/Canoe-Creek_-Azure-60-4443-Elevation-I1.jpg${q1600}`,
  "https://planviewer.cpsusa.com/nealcom/api/attachment/2299711",
];
const azureNew = [
  `${up}/2026/02/23101805/Canoe-Creek_-Azure-60-4443-Elevation-FH1.jpg`,
  `${up}/2026/02/10104751/Canoe-Creek_-Azure-60-4443-Elevation-I1.jpg${q1600}`,
  "https://planviewer.cpsusa.com/nealcom/api/attachment/2299711",
];
const visionScaled = `${up}/2026/07/23155851/Vision-2-33-2962-Elevation-C1-scaled.jpg?auto=format%2Ccompress&fit=max&w=1000`;
const visionThumb = `${up}/2026/07/23155851/Vision-2-33-2962-Elevation-C1-300x180.jpg?auto=format%2Ccompress`;
const meritage = (id: string) => `https://mhc-p-001.sitecorecontenthub.cloud/api/public/content/${id}?v=1`;

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "azure",
  name: "Azure",
  price: 600000,
  priceDisplay: "$600,000",
  beds: "3",
  baths: "2",
  sqft: 2000,
  garages: "2 car",
  homeType: "Single-Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://nealcommunities.com/azure",
  galleryImages: azureOld,
  blueprintImages: [],
  ...over,
});

describe("one photo, however its address is spelled (Neal, Jeff 2026-09-25)", () => {
  it("knows WordPress's copies of an upload for the upload", () => {
    expect(pictureKey(visionThumb)).toBe(pictureKey(visionScaled));
    expect(pictureKey(`${up}/2026/03/15144506/1350-21_MLS-300x172.jpg?auto=format%2Ccompress`)).toBe(pictureKey(`${up}/2026/03/15144506/1350-21_MLS.jpg${q1600}`));
    expect(pictureKey(`${up}/2026/03/15144506/1350-21_MLS.jpg`)).not.toBe(pictureKey(`${up}/2026/03/15144636/1350-21_MLS-1.jpg`));
  });

  it("keeps the largest copy, in the place the first one came", () => {
    expect(onePerPicture([visionThumb, azureOld[1], visionScaled]).photos).toEqual([visionScaled, azureOld[1]]);
  });

  it("finds the whole photo beside a thumbnail whose address has a query", () => {
    const thumb = `${up}/2026/03/15144506/1350-21_MLS-300x172.jpg?auto=format%2Ccompress`;
    expect(fullSize(thumb, `<img src="${up}/2026/03/15144506/1350-21_MLS.jpg${q1600}">`)).toBe(`${up}/2026/03/15144506/1350-21_MLS.jpg?auto=format%2Ccompress`);
  });

  it("proposes nothing for the same photos under other addresses, and keeps the record's", () => {
    expect(samePictures(azureOld, azureNew)).toBe(true);
    expect(fieldChanges(plan(), plan({ galleryImages: azureNew })).map((c) => c.label)).not.toContain("photos");
    expect(mergeForUpdate(plan(), plan({ galleryImages: azureNew, priceDisplay: "$610,000" })).galleryImages).toEqual(azureOld);
    // A home shows one photo: its lead, as a thumbnail one night and whole the next.
    const home = (lead: string) => plan({ planKey: "13737-spinning-rod-way", quickMoveIn: true, galleryImages: [lead, azureOld[1]] });
    expect(fieldChanges(home(visionScaled), home(visionThumb)).map((c) => c.label)).not.toContain("photos");
  });

  it("reads a gallery that carried a photo twice as the same gallery once it carries it once", () => {
    expect(samePictures([visionThumb, azureOld[1], visionScaled], [visionScaled, azureOld[1]])).toBe(true);
  });

  it("still proposes a photo that truly changed, or moved (Meritage 7733 and 7721 Satterfield Ter)", () => {
    const home = (lead: string, rest: string[]) => plan({ planKey: "7733-satterfield-ter", quickMoveIn: true, galleryImages: [lead, ...rest] });
    const replaced = fieldChanges(home(meritage("dd0916dd"), [meritage("2d112027")]), home(meritage("5fcad250"), [meritage("2d112027")]));
    expect(replaced.map((c) => c.label)).toContain("photos");
    const moved = fieldChanges(home(meritage("989bf0d0"), [meritage("08e72b58")]), home(meritage("08e72b58"), [meritage("989bf0d0")]));
    expect(moved.map((c) => c.label)).toContain("photos");
  });

  it("spells a run's photos as the record spells them, so what was learned about them stays", () => {
    const run = plan({ galleryImages: [azureNew[0], visionThumb, azureNew[1]], galleryMeta: { [azureNew[0]]: { room: "exterior" } } });
    const known = withKnownSpellings(run, plan({ galleryImages: [visionThumb, ...azureOld, visionScaled] }));
    expect(known.galleryImages).toEqual([azureOld[0], visionScaled, azureOld[1]]);
    expect(known.galleryMeta).toEqual({ [azureOld[0]]: { room: "exterior" } });
    expect(withKnownSpellings(run, null)).toBe(run);
  });
});

describe("a quick move-in's description written on its own (Jeff, 2026-09-25)", () => {
  it("takes the run's description and nothing else", () => {
    const current = plan({ quickMoveIn: true, description: "Old words.", raw: { descriptionOriginal: "Our old words.", lot: "7" } });
    const run = plan({ quickMoveIn: true, description: "MOVE IN READY – Sanibel 2 w/ pool.", galleryImages: [visionThumb], priceDisplay: "$1" });
    const written = withDescriptionFrom(current, run);
    expect(written.description).toBe("MOVE IN READY – Sanibel 2 w/ pool.");
    expect(written.raw).toEqual({ lot: "7" });
    expect(written.galleryImages).toEqual(azureOld);
    expect(written.priceDisplay).toBe("$600,000");
  });
});

describe("a plan viewer adds only what the page lacks (Neal Communities' Canoe Creek, Jeff 2026-09-25)", () => {
  const hub = "https://life-at-lakewood-form-submission-bo.vercel.app/api/floorplans/planviewer/nealcom/2081144";
  const viewer = {
    drawings: [`${hub}/First_Floor.svg`, `${hub}/Second_Floor.svg`],
    elevations: ["https://planviewer.cpsusa.com/nealcom/api/attachment/2299711"],
    meta: { "https://planviewer.cpsusa.com/nealcom/api/attachment/2299711": { caption: "Elevation FH1", room: "exterior" as const, kind: "exterior" as const } },
    tour: null,
  };
  const ownPlan = `${up}/2025/01/10093224/new-homes-parrish-florida-canoe-creek-azure-floorplan-1.jpg?auto=format%2Ccompress`;

  it("draws no floor plan twice where the page shows its own, nor the house", () => {
    const filled = viewerFills({ blueprints: [ownPlan], photos: azureNew.slice(0, 2), ownElevations: true }, viewer);
    expect(filled.blueprints).toEqual([ownPlan]);
    expect(filled.photos).toEqual(azureNew.slice(0, 2));
    expect(filled.meta).toEqual({});
  });

  it("gives a page with no drawing and no outside of the house the viewer's (Neal Signature)", () => {
    const filled = viewerFills({ blueprints: [], photos: [], ownElevations: false }, viewer);
    expect(filled.blueprints).toEqual(viewer.drawings);
    expect(filled.photos).toEqual(viewer.elevations);
    expect(filled.meta).toEqual(viewer.meta);
  });
});

describe("the viewer's duplicates leave the record (Jeff, 2026-09-25)", () => {
  it("proposes taking out the viewer's elevations where the page shows its own", () => {
    const viewer = ["2299711", "2299713", "2299715"].map((id) => `https://planviewer.cpsusa.com/nealcom/api/attachment/${id}`);
    const own = [azureNew[0], azureNew[1], `${up}/2026/02/10104754/Canoe-Creek_-Azure-60-4443-Elevation-C1.jpg${q1600}`];
    expect(fieldChanges(plan({ galleryImages: [...own, ...viewer] }), plan({ galleryImages: own })).map((c) => c.label)).toContain("photos");
  });
});
