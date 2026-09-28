import { describe, expect, it } from "vitest";
import { fieldChanges, mergeForUpdate, type CanonicalRecord } from "@/lib/floorplans/diff";
import { pictureKey } from "@/lib/floorplans/extractors/plan-page";
import { picturesAdded, primaryReplaced, withKnownSpellings } from "@/lib/floorplans/pictures";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Addresses from the queue (Homes by WestBay and D.R. Horton, Jeff 2026-09-28).
const wb = "https://d3ep4ovemm7dcp.cloudfront.net/mixed-media";
const veronaCover = `${wb}/a158b9f9-866b-4e63-a4e7-58996549be46/large/Verona-Flat-Tile-Coastal-A-Coastal-07-Paver-Gen3-elev_IND-%28Large%29.jpg`;
const veronaHd = `${wb}/a158b9f9-866b-4e63-a4e7-58996549be46/hd/Verona-Flat-Tile-Coastal-A-Coastal-07-Paver-Gen3-elev_IND-%28Large%29.jpg`;
const veronaB = `${wb}/a158b9fa-3696-40f2-91dd-339fad782b02/hd/Verona-Flat-Tile-Coastal-B-Coastal-08-Paver-Gen3-elev_IND-%28Large%29.jpg`;
const veronaC = `${wb}/a158ba39-f1f4-4ac2-993b-f3e10c233780/hd/Verona-Flat-Tile-Coastal-C-Coastal-08-Paver-Gen3-elev_IND-%28Large%29.jpg`;

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "verona",
  name: "Verona",
  price: 500000,
  priceDisplay: "$500,000",
  beds: "3",
  baths: "2",
  sqft: 2000,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.homesbywestbay.com/verona",
  galleryImages: [veronaCover, veronaB, veronaC],
  blueprintImages: [],
  ...over,
});

describe("WestBay's cover photo and its page's copy of it are one photo", () => {
  it("knows the same upload at another size for that upload", () => {
    expect(pictureKey(veronaHd)).toBe(pictureKey(veronaCover));
  });

  it("knows the same photo uploaded again, its name written with spaces and a size", () => {
    const lidoCover = `${wb}/a2564440-3cee-4544-82f7-95f304b31a11/large/Lido-Key-I-Coastal-COA-Coastal-10-Flat-Tile-Paver-3-Car-Gen3-elev_IND.jpg`;
    const lidoHd = `${wb}/a2563dee-207a-4c55-abfd-1f4b937ebdfd/hd/Lido%20Key%20I-Coastal-COA-Coastal%2010-Flat%20Tile-Paver-3%20Car-Gen3-elev_IND%20%28Large%29.jpg`;
    expect(pictureKey(lidoHd)).toBe(pictureKey(lidoCover));
    const largoCover = `${wb}/a1fbcfa5-d7a0-400d-8c6d-158125b6d1f2/large/Key%20Largo%20II%20XT-Coastal-A-Coastal%20Scheme%2008-Flat%20Tile-Paver-Gen3-elev_IND.jpg`;
    const largoHd = `${wb}/a1ffdeb0-5cd3-4fb9-8f0e-3f4b376001dd/hd/Key-Largo-II-XT-Coastal-A-Coastal-Scheme-08-Flat-Tile-Paver-Gen3-elev_IND.jpg`;
    expect(pictureKey(largoHd)).toBe(pictureKey(largoCover));
  });

  it("keeps different elevations apart", () => {
    expect(pictureKey(veronaB)).not.toBe(pictureKey(veronaC));
    expect(pictureKey(veronaB)).not.toBe(pictureKey(veronaCover));
  });

  it("proposes nothing when a run reads the cover again under the page's address", () => {
    const current = plan() as CanonicalRecord;
    const run = withKnownSpellings(plan({ galleryImages: [veronaCover, veronaHd, veronaB, veronaC] }), current);
    expect(run.galleryImages).toEqual([veronaCover, veronaB, veronaC]);
    expect(fieldChanges(current, run).map((c) => c.field)).not.toContain("galleryImages");
  });
});

describe("a copy taken out stays out (Jeff, 2026-09-28)", () => {
  const front = "https://cdn.example.com/elston/front.jpg";
  const copy = "https://cdn.example.com/elston/front_hiddenbanksglen.jpg";
  const kitchen = "https://cdn.example.com/elston/kitchen.jpg";

  it("files a copy the pixels found under the photo kept in its place", () => {
    const current = plan({ galleryImages: [front, kitchen], copiesOf: { [copy]: front } }) as CanonicalRecord;
    const run = withKnownSpellings(plan({ galleryImages: [front, kitchen, copy], galleryMeta: { [copy]: { kind: "photo", room: "exterior", caption: null } } }), current);
    expect(run.galleryImages).toEqual([front, kitchen]);
    expect(Object.keys(run.galleryMeta ?? {})).toEqual([front]);
    expect(fieldChanges(current, run).map((c) => c.field)).not.toContain("galleryImages");
  });

  it("carries what was learned into the next proposal", () => {
    const current = plan({ galleryImages: [front], copiesOf: { [copy]: front } }) as CanonicalRecord;
    expect(mergeForUpdate(current, plan({ galleryImages: [front, kitchen] })).copiesOf).toEqual({ [copy]: front });
  });
});

describe("a new gallery is checked and sorted again (Jeff, 2026-09-28)", () => {
  it("drops the record's marks when the run's photos are taken", () => {
    const current = plan({ copiesChecked: true, photosSorted: true }) as CanonicalRecord;
    const merged = mergeForUpdate(current, plan({ galleryImages: [veronaCover, veronaB, veronaC, "https://cdn.example.com/new.jpg"] }));
    expect(merged.copiesChecked).toBeUndefined();
    expect(merged.photosSorted).toBeUndefined();
  });

  it("keeps them when the photos are the record's", () => {
    const current = plan({ copiesChecked: true, photosSorted: true }) as CanonicalRecord;
    const merged = mergeForUpdate(current, plan({ price: 510000 }));
    expect(merged.copiesChecked).toBe(true);
    expect(merged.photosSorted).toBe(true);
  });
});

describe("a picture the run reads as a photo leaves the drawings (D.R. Horton's Harper, Jeff 2026-09-28)", () => {
  const drh = "https://cdn.drhorton.com/harper";
  const drawing = `${drh}/floorplan.jpg`;
  const elevation = `${drh}/3emb/14.jpg`;

  it("takes it out of the drawings when the run's photos are taken", () => {
    const current = plan({ galleryImages: [`${drh}/front.jpg`], blueprintImages: [drawing, elevation] }) as CanonicalRecord;
    const merged = mergeForUpdate(current, plan({ galleryImages: [`${drh}/front.jpg`, elevation], blueprintImages: [] }));
    expect(merged.galleryImages).toEqual([`${drh}/front.jpg`, elevation]);
    expect(merged.blueprintImages).toEqual([drawing]);
  });

  it("leaves drawings a person arranged alone", () => {
    const current = plan({ galleryImages: [`${drh}/front.jpg`], blueprintImages: [drawing, elevation], userEditedFields: ["blueprintImages"] }) as CanonicalRecord;
    const merged = mergeForUpdate(current, plan({ galleryImages: [`${drh}/front.jpg`, elevation], blueprintImages: [] }));
    expect(merged.blueprintImages).toEqual([drawing, elevation]);
  });
});

describe("picturesAdded: what a change adds to the live plan, for the overlay to mark (Jeff, 2026-09-28)", () => {
  const front = "https://cdn.example.com/verona/front.jpg";
  const kitchen = "https://cdn.example.com/verona/kitchen.jpg";
  const drawing = "https://cdn.example.com/verona/plan.png";

  it("marks the photos and drawings the live plan does not have, however either spells them", () => {
    const live = plan({ galleryImages: [veronaCover, front], blueprintImages: [drawing] });
    const proposed = plan({ galleryImages: [veronaHd, front, kitchen], blueprintImages: [drawing, `${drawing}?w=800`, "https://cdn.example.com/verona/plan-2.png"] });
    expect(picturesAdded(live, proposed)).toEqual([kitchen, "https://cdn.example.com/verona/plan-2.png"]);
  });

  it("does not mark a copy the record already took out", () => {
    const copy = "https://cdn.example.com/verona/front-copy.jpg";
    expect(picturesAdded(plan({ galleryImages: [front], copiesOf: { [copy]: front } }), plan({ galleryImages: [front, copy] }))).toEqual([]);
  });

  it("marks nothing without a live plan", () => {
    expect(picturesAdded(null, plan({ galleryImages: [front] }))).toEqual([]);
  });
});

describe("primaryReplaced: a quick move-in's one picture, changed (Neal's 2143 Sylvester Palm Lane, Jeff 2026-09-28)", () => {
  const up = "https://images.nealcommunities.com/wp-content/uploads/2026/02";
  const one = `${up}/06163215/2143-1_MLS.jpg?auto=format%2Ccompress&fit=crop&ar=16%3A9&w=1600`;
  const two = `${up}/23101512/2143-2_MLS.jpg`;
  const home = (galleryImages: string[]) => plan({ quickMoveIn: true, name: "2143 Sylvester Palm Lane", galleryImages });

  it("gives the picture on the site where the change leads with another it already had", () => {
    expect(picturesAdded(home([one, two]), home([two, one]))).toEqual([]);
    expect(primaryReplaced(home([one, two]), home([two, one]))).toBe(one);
  });

  it("gives nothing where the picture stays, however it is spelled, or for a floor plan", () => {
    expect(primaryReplaced(home([one, two]), home([`${up}/06163215/2143-1_MLS.jpg`, two]))).toBeNull();
    expect(primaryReplaced(plan({ galleryImages: [one, two] }), plan({ galleryImages: [two, one] }))).toBeNull();
    expect(primaryReplaced(null, home([two]))).toBeNull();
  });
});
