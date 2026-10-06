import { describe, expect, it } from "vitest";
import { missingPicturesMessage, picturesMissing, PicturesMissing } from "@/lib/floorplans/writeback";

/**
 * A row is written with every picture its record lists, or not at all
 * (Jeff, 2026-10-06): SimplyDwell's Olivia went up with eleven of its
 * twelve photos, photo 8 left out, and Neal's Bright Star without its one
 * drawing, whose link Neal had taken down.
 */
describe("picturesMissing", () => {
  const olivia = Array.from({ length: 12 }, (_, i) => `https://simplydwellhomes.com/olivia-${i + 1}.jpg`);
  const drawing = "https://images.nealcommunities.com/Bright-Star-scaled.webp";

  it("names a photo the import left out, by its place in the gallery", () => {
    const imported = olivia.filter((_, i) => i !== 7).map((u, i) => ({ kind: "photo" as const, sourceUrl: u, fileId: `f${i}` }));
    expect(picturesMissing([{ kind: "photo", urls: olivia }], imported, new Set())).toEqual([
      { kind: "photo", position: 8, sourceUrl: olivia[7] },
    ]);
  });

  it("counts a picture Wix was asked for but is not holding as missing", () => {
    const imported = [{ kind: "photo" as const, sourceUrl: olivia[0], fileId: "lead" }];
    expect(picturesMissing([{ kind: "photo", urls: [olivia[0]] }], imported, new Set(["lead"]))).toEqual([
      { kind: "photo", position: 1, sourceUrl: olivia[0] },
    ]);
  });

  it("names a drawing and a tour still apart from the photos", () => {
    const listed = [
      { kind: "photo" as const, urls: [olivia[0]] },
      { kind: "drawing" as const, urls: [drawing] },
      { kind: "tour still" as const, urls: ["https://example.com/tour.jpg"] },
    ];
    const imported = [{ kind: "photo" as const, sourceUrl: olivia[0], fileId: "a" }];
    expect(picturesMissing(listed, imported, new Set()).map((m) => `${m.kind} ${m.position}`)).toEqual(["drawing 1", "tour still 1"]);
  });

  it("finds nothing missing when every listed picture is on Wix", () => {
    const imported = olivia.map((u, i) => ({ kind: "photo" as const, sourceUrl: u, fileId: `f${i}` }));
    expect(picturesMissing([{ kind: "photo", urls: olivia }, { kind: "drawing", urls: [] }], imported, new Set())).toEqual([]);
  });

  it("does not let a photo stand in for a drawing at the same address", () => {
    const imported = [{ kind: "photo" as const, sourceUrl: drawing, fileId: "a" }];
    expect(picturesMissing([{ kind: "drawing", urls: [drawing] }], imported, new Set())).toHaveLength(1);
  });
});

describe("missingPicturesMessage", () => {
  it("says what was held and why, naming the pictures, for the Failed row", () => {
    const message = missingPicturesMessage("bright-star", [{ kind: "drawing", position: 1, sourceUrl: "https://neal.example/bs.webp" }], 3);
    expect(message).toBe(
      "1 of 3 pictures could not be put on Wix, so nothing was written for bright-star: drawing 1 (https://neal.example/bs.webp). " +
        "The next run queues it again; a picture the builder has taken down can be removed in Edit."
    );
  });

  it("lists five and counts the rest", () => {
    const missing = Array.from({ length: 8 }, (_, i) => ({ kind: "photo" as const, position: i + 1, sourceUrl: `https://x.example/${i + 1}.jpg` }));
    const message = missingPicturesMessage("olivia", missing, 12);
    expect(message).toContain("8 of 12 pictures");
    expect(message).toContain("photo 5 (https://x.example/5.jpg) and 3 more.");
    expect(message).not.toContain("photo 6 ");
  });

  it("is the error the write throws", () => {
    const error = new PicturesMissing("olivia", [{ kind: "photo", position: 8, sourceUrl: "https://x.example/8.jpg" }], 12);
    expect(error.name).toBe("PicturesMissing");
    expect(error.missing).toHaveLength(1);
    expect(error.message).toMatch(/^1 of 12 pictures could not be put on Wix/);
  });
});
