import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { copyStoragePath, copyStoragePaths, copyTypeOf, isSvgUrl, mediaUrlsOf, rasterStoragePath, urlsToRelease } from "@/lib/floorplans/media";

describe("mediaUrlsOf", () => {
  it("collects every picture a record points at, and nothing else", () => {
    expect(
      mediaUrlsOf({
        galleryImages: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
        blueprintImages: ["https://cdn.example.com/plan.svg"],
        primaryImage: "https://cdn.example.com/a.jpg",
        virtualTourImage: "https://cdn.example.com/tour.jpg",
        description: "not a picture",
      })
    ).toEqual([
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
      "https://cdn.example.com/plan.svg",
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/tour.jpg",
    ]);
    expect(mediaUrlsOf(null)).toEqual([]);
    expect(mediaUrlsOf({ galleryImages: "not a list", primaryImage: 7 })).toEqual([]);
  });
});

describe("urlsToRelease", () => {
  it("keeps a picture another plan on the site still uses, and lists each of the rest once", () => {
    const inScope = ["a.jpg", "b.jpg", "a.jpg", "shared.jpg", ""];
    expect(urlsToRelease(inScope, new Set(["shared.jpg"]))).toEqual(["a.jpg", "b.jpg"]);
    expect(urlsToRelease([], new Set())).toEqual([]);
  });
});

describe("raster helpers", () => {
  it("knows an SVG by its path and places its rendering by content hash", () => {
    expect(isSvgUrl("https://cdn.tollbrothers.com/plans/93G-01.svg")).toBe(true);
    expect(isSvgUrl("https://cdn.tollbrothers.com/plans/93G-01.SVG?x=1")).toBe(true);
    expect(isSvgUrl("https://cdn.tollbrothers.com/photo.jpg")).toBe(false);
    expect(isSvgUrl("not a url")).toBe(false);
    expect(rasterStoragePath("site-1", "abc123")).toBe("floorplans/site-1/abc123.png");
  });
});

describe("copy helpers", () => {
  it("places a copy by content hash, and a clean-up clears every format it could be in", async () => {
    expect(copyStoragePath("site-1", "abc123", "webp")).toBe("floorplans/site-1/copies/abc123.webp");
    expect(copyStoragePaths("site-1", "abc123")).toEqual([
      "floorplans/site-1/copies/abc123.jpg",
      "floorplans/site-1/copies/abc123.png",
      "floorplans/site-1/copies/abc123.webp",
      "floorplans/site-1/copies/abc123.gif",
    ]);
  });

  it("stores a copy under what the bytes are, not what the link says", async () => {
    const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).webp().toBuffer();
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect(await copyTypeOf(new Uint8Array(webp))).toEqual({ ext: "webp", contentType: "image/webp" });
    expect(await copyTypeOf(new Uint8Array(jpeg))).toEqual({ ext: "jpg", contentType: "image/jpeg" });
    expect(await copyTypeOf(new TextEncoder().encode("<html>not found</html>"))).toBeNull();
    // Every format a copy is stored in is one a clean-up clears.
    for (const bytes of [webp, jpeg]) {
      const type = await copyTypeOf(new Uint8Array(bytes));
      expect(copyStoragePaths("s", "h")).toContain(copyStoragePath("s", "h", type!.ext));
    }
  });
});
