import { describe, it, expect } from "vitest";
import { isSvgUrl, mediaUrlsOf, rasterStoragePath, urlsToRelease } from "@/lib/floorplans/media";

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
