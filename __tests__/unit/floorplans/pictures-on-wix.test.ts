import { describe, expect, it } from "vitest";
import { describeGallery, type CanonicalRecord } from "@/lib/floorplans/diff";
import { listedPictures, MAX_GALLERY_IMAGES, unwrittenPictureChanges } from "@/lib/floorplans/pictures-on-wix";

const plan = (galleryImages: string[], blueprintImages: string[] = [], quickMoveIn = false) =>
  ({ planKey: "olivia", name: "Olivia", galleryImages, blueprintImages, quickMoveIn }) as unknown as CanonicalRecord;
const photos = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `https://builder.example/photo-${from + i}.jpg`);

/**
 * Rows written before every picture had to reach Wix (Jeff, 2026-10-06):
 * SimplyDwell's Olivia without its eighth photo, Neal's Bright Star without
 * its drawing, and every plan of more than forty photos with its first forty.
 */
describe("unwrittenPictureChanges", () => {
  it("proposes the photos a live plan lists that Wix has never held", () => {
    const listed = photos(12);
    const onWix = new Set(listed.filter((_, i) => i !== 7));
    expect(unwrittenPictureChanges(plan(listed), onWix, new Set())).toEqual([
      { field: "galleryImages", label: "photos", oldValue: describeGallery([...onWix], "photos"), newValue: describeGallery(listed, "photos") },
    ]);
  });

  it("proposes a drawing that never went up, apart from the photos", () => {
    const listed = photos(2);
    const drawing = "https://neal.example/Bright-Star.webp";
    const changes = unwrittenPictureChanges(plan(listed, [drawing]), new Set(listed), new Set());
    expect(changes.map((c) => [c.label, c.oldValue])).toEqual([["blueprints", "no blueprints"]]);
  });

  it("proposes photos 41 to 70 of a plan the old cap of forty left at forty", () => {
    const listed = photos(70);
    const changes = unwrittenPictureChanges(plan(listed), new Set(listed.slice(0, 40)), new Set());
    expect(changes).toHaveLength(1);
    expect(changes[0].oldValue).toMatch(/^40 photos · /);
    expect(changes[0].newValue).toMatch(/^70 photos · /);
  });

  it("asks nothing past the cap of eighty", () => {
    expect(MAX_GALLERY_IMAGES).toBe(80);
    const listed = photos(95);
    expect(unwrittenPictureChanges(plan(listed), new Set(listed.slice(0, 80)), new Set())).toEqual([]);
    expect(listedPictures(plan(listed, photos(3, 500)))).toHaveLength(83);
  });

  it("proposes nothing for a plan whose pictures are all on Wix", () => {
    const listed = photos(12);
    expect(unwrittenPictureChanges(plan(listed, ["https://x.example/d.png"]), new Set([...listed, "https://x.example/d.png"]), new Set())).toEqual([]);
  });

  it("leaves a gallery the run already proposes to the run's own change", () => {
    const listed = photos(12);
    expect(unwrittenPictureChanges(plan(listed), new Set(listed.slice(0, 11)), new Set(["photos"]))).toEqual([]);
  });

  it("leaves a quick move-in alone: its row shows one picture and is never written without it", () => {
    const listed = photos(12);
    expect(unwrittenPictureChanges(plan(listed, [], true), new Set(), new Set())).toEqual([]);
  });
});
