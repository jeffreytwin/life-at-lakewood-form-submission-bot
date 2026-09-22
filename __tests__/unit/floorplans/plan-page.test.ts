import { describe, expect, it } from "vitest";
import { firstGallery, fullSize, sectionsOf } from "@/lib/floorplans/extractors/plan-page";

const BASE = "https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/320/";
const blob = (id: string, size: "sm" | "lg", ext = "jpg") =>
  `https://fabrik.blob.core.windows.net/public/${id}_${size}.${ext}`;

const tile = (src: string, alt: string) =>
  `<button class="relative aspect-[4/3]" aria-label="Open ${alt}"><img alt="${alt}" loading="lazy" class="object-cover" src="${src}"/></button>`;

/**
 * Wyndam IV's page, in the shape the probe found (2026-09-22): a hero of
 * full-size elevations before the title, an Elevations grid of the same
 * pictures as thumbnails, a Virtual Tours grid of stills, three galleries
 * named for the designers who furnished them, and the floor plan drawing.
 */
const WYNDAM = `<!doctype html><html><body>
<header><img src="/logos/Dark.png" alt="STOCK"/></header>
<div class="hero">
  ${tile(blob("d52610f4", "lg"), "Wyndam IV — B")}
  ${tile(blob("2b390d1e", "lg", "png"), "Wyndam IV — E")}
</div>
<h1 class="display-1">Wyndam IV</h1>
<p>Four Bedroom (Opt. Bonus Room), Four Full and 1/2 Bath, Great Room, Dining Room, Two 2-Car Garage</p>
<h2 class="display-3">Elevations</h2>
<div class="grid grid-cols-2 gap-2 mt-6">
  ${tile(blob("d52610f4", "sm"), "Elevation B — British West Indies")}
  ${tile(blob("2b390d1e", "sm", "png"), "Elevation E — Modern")}
</div>
<h2 class="display-3">Virtual Tours</h2>
<div class="grid grid-cols-1 gap-4 mt-6">
  ${tile(blob("b74eed4c", "sm"), "20013040049")}
  ${tile(blob("6e8cfe1d", "sm"), "20013090333")}
</div>
<h2 class="display-3">Galleries</h2>
<div class="mt-6 space-y-10">
  <div><h4 class="mb-4">Wild Blue at Waterside<span class="ml-2 text-sm">Interior by <!-- -->Dan Rak Design</span></h4>
  <div class="grid grid-cols-2 gap-2 ">
    ${tile(blob("6e8cfe1d", "sm"), "333")}
    ${tile(blob("e042dbd0", "sm"), "333")}
    ${tile(blob("b25872ce", "sm"), "333")}
  </div></div>
  <div><h4 class="mb-4">Wild Blue at Waterside<span class="ml-2 text-sm">Interior by <!-- -->Clive Daniel Home</span></h4>
  <div class="grid grid-cols-2 gap-2 ">
    ${tile(blob("b0d4d01a", "sm"), "Wyndam WBWS 49")}
    ${tile(blob("b74eed4c", "sm"), "Wyndam WBWS 49")}
  </div></div>
  <div><h4 class="mb-4">The Lake Club<span class="ml-2 text-sm">Interior by <!-- -->Beasley &amp; Henley</span></h4>
  <div class="grid grid-cols-2 gap-2 ">
    ${tile(blob("81864891", "sm"), "Wyndam IV / lot 226")}
  </div></div>
</div>
<h2 class="display-3">Floor Plan</h2>
<img src="https://fabrik.blob.core.windows.net/public/81695783.jpg" alt="Wyndam IV floor plan"/>
<h2>Interested in the Wyndam IV</h2>
<footer><h5>Floor Plans</h5><h5>Company</h5><img src="/logos/Light.png" alt="STOCK"/></footer>
<script>{"tour":"https:\\/\\/my.matterport.com\\/show\\/?m=K1hZHtKa6ok"}</script>
${[blob("6e8cfe1d", "lg"), blob("e042dbd0", "lg"), blob("b25872ce", "lg"), blob("d52610f4", "lg")]
  .map((u) => `<link rel="preload" as="image" href="${u}"/>`)
  .join("")}
</body></html>`;

describe("sectionsOf", () => {
  const sections = sectionsOf(WYNDAM, BASE);
  const by = (heading: string) => sections.find((s) => s.heading === heading);

  it("opens with what comes before the first heading", () => {
    expect(sections[0].heading).toBe("");
    expect(sections[0].level).toBe(0);
    expect(sections[0].images.map((i) => i.alt)).toEqual(["STOCK", "Wyndam IV — B", "Wyndam IV — E"]);
  });

  it("gives each heading the images drawn before the next one", () => {
    expect(by("Elevations")?.images.map((i) => i.alt)).toEqual([
      "Elevation B — British West Indies",
      "Elevation E — Modern",
    ]);
    expect(by("Virtual Tours")?.images).toHaveLength(2);
    expect(by("Galleries")?.images).toEqual([]);
  });

  it("reads a heading through the spans and comments a framework leaves in it", () => {
    expect(sections.map((s) => s.heading)).toContain("Wild Blue at Waterside Interior by Dan Rak Design");
    expect(sections.map((s) => s.heading)).toContain("The Lake Club Interior by Beasley & Henley");
  });

  it("remembers the headings a section sits under", () => {
    expect(by("Wild Blue at Waterside Interior by Clive Daniel Home")?.ancestors).toEqual([
      "Wyndam IV",
      "Galleries",
    ]);
    expect(by("Floor Plan")?.ancestors).toEqual(["Wyndam IV"]);
  });

  it("makes image URLs absolute and leaves inline data out", () => {
    expect(sections[0].images[0].src).toBe("https://www.stockdevelopment.com/logos/Dark.png");
    expect(sectionsOf('<img src="data:image/gif;base64,R0lGOD"/>', BASE)[0].images).toEqual([]);
  });
});

describe("firstGallery", () => {
  const { first, drop } = firstGallery(WYNDAM, BASE);

  it("takes the first gallery whole, whoever it is named for", () => {
    expect(first.map((i) => i.src)).toEqual([
      blob("6e8cfe1d", "sm"),
      blob("e042dbd0", "sm"),
      blob("b25872ce", "sm"),
    ]);
  });

  it("drops the later galleries", () => {
    expect(drop.has(blob("b0d4d01a", "sm"))).toBe(true);
    expect(drop.has(blob("81864891", "sm"))).toBe(true);
  });

  it("drops a still that is only ever a virtual tour's", () => {
    expect(drop.has(blob("b74eed4c", "sm"))).toBe(true);
  });

  it("keeps a picture the tours share with the plan's own gallery", () => {
    expect(drop.has(blob("6e8cfe1d", "sm"))).toBe(false);
  });

  it("leaves the elevations, the drawing and the logos alone", () => {
    expect(drop.has(blob("d52610f4", "sm"))).toBe(false);
    expect(drop.has("https://fabrik.blob.core.windows.net/public/81695783.jpg")).toBe(false);
    expect(drop.has("https://www.stockdevelopment.com/logos/Light.png")).toBe(false);
  });

  it("finds no gallery on a page that has none, and drops nothing", () => {
    const plain = "<h1>Chandler V</h1><h2>Elevations</h2><img src='https://x.test/a.jpg'/>";
    expect(firstGallery(plain, BASE)).toEqual({ first: [], drop: new Set() });
  });
});

describe("fullSize", () => {
  it("swaps a thumbnail for the full-size picture the page also names", () => {
    expect(fullSize(blob("6e8cfe1d", "sm"), WYNDAM)).toBe(blob("6e8cfe1d", "lg"));
  });

  it("keeps a thumbnail whose larger file the page never names", () => {
    expect(fullSize(blob("b0d4d01a", "sm"), WYNDAM)).toBe(blob("b0d4d01a", "sm"));
  });

  it("follows the larger file's own extension", () => {
    const html = `<img src="${blob("zz", "sm")}"/><a href="${blob("zz", "lg", "png")}">big</a>`;
    expect(fullSize(blob("zz", "sm"), html)).toBe(blob("zz", "lg", "png"));
  });

  it("swaps a WordPress resize for the original the page also names", () => {
    const wp = (name: string) => `https://simplydwellhomes.com/wp-content/uploads/2026/06/${name}`;
    const html = `<img src="${wp("cypress-elevation-b-scaled-1-1024x614.webp")}"/><img src="${wp("cypress-elevation-b-scaled-1.webp")}"/>`;
    expect(fullSize(wp("cypress-elevation-b-scaled-1-1024x614.webp"), html)).toBe(
      wp("cypress-elevation-b-scaled-1.webp")
    );
  });

  it("keeps a resize whose original the page never names", () => {
    const wp = (name: string) => `https://simplydwellhomes.com/wp-content/uploads/2026/06/${name}`;
    // Stripping the size off this one names a file that does not exist.
    const only = wp("Azalea-40-1817_Elevation-A-1-1024x614-1.webp");
    expect(fullSize(only, `<img src="${only}"/>`)).toBe(only);
  });

  it("leaves a URL that is not a thumbnail as it is", () => {
    expect(fullSize(blob("6e8cfe1d", "lg"), WYNDAM)).toBe(blob("6e8cfe1d", "lg"));
    expect(fullSize("https://x.test/kitchen.jpg", WYNDAM)).toBe("https://x.test/kitchen.jpg");
  });
});
