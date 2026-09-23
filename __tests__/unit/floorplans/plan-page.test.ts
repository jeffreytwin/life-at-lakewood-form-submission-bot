import { describe, expect, it } from "vitest";
import {
  documentBase,
  firstGallery,
  fullSize,
  largestInSrcSet,
  pictureKey,
  captionedCarousel,
  drawingsNamed,
  sectionsOf,
} from "@/lib/floorplans/extractors/plan-page";

const BASE = "https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/320/";
const blob = (id: string, size: "sm" | "md" | "lg", ext = "jpg") =>
  `https://fabrik.blob.core.windows.net/public/${id}_${size}.${ext}`;

const tile = (src: string, alt: string) =>
  `<button class="relative aspect-[4/3]" aria-label="Open ${alt}"><img alt="${alt}" loading="lazy" class="object-cover" src="${src}"/></button>`;

const escaped = (src: string) => src.replace(/\//g, "\\/");

/**
 * What Stock's framework ships in the page's data: each gallery's pictures
 * in full, in order, while the markup draws five of them over a "+25 MORE"
 * button. The first gallery holds six here and draws three.
 */
const payload =
  `{"galleries":[` +
  `{"name":"Wild Blue at Waterside","by":"Dan Rak Design","images":[` +
  ["6e8cfe1d", "e042dbd0", "b25872ce", "77aa11bb", "88cc22dd", "99ee33ff"]
    .flatMap((id) => [blob(id, "sm"), blob(id, "md")])
    .map((src) => `\\"${escaped(src)}\\"`)
    .join(",") +
  `]},` +
  `{"name":"Wild Blue at Waterside","by":"Clive Daniel Home","images":[` +
  [blob("b0d4d01a", "sm"), blob("b74eed4c", "sm"), blob("44ff55aa", "sm")]
    .map((src) => `\\"${escaped(src)}\\"`)
    .join(",") +
  `]}]}`;

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
<script>self.__next_f.push([1,"${payload}"])</script>
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

  it("takes the first gallery, whoever it is named for", () => {
    expect(first.slice(0, 3).map((i) => i.src)).toEqual([
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

  it("follows the gallery past what the page draws, into the page's own data", () => {
    // The markup draws three of six over a "+N MORE" button; the run in the
    // payload is the whole gallery, and it is the run that wins. The store
    // lists each picture at two sizes, which is six pictures, not twelve.
    expect(first).toHaveLength(6);
    expect(first.map((i) => pictureKey(i.src))).toEqual(
      ["6e8cfe1d", "e042dbd0", "b25872ce", "77aa11bb", "88cc22dd", "99ee33ff"].map((id) =>
        pictureKey(blob(id, "sm"))
      )
    );
  });

  it("stops the run at the next gallery's pictures, and keeps the drawn captions", () => {
    expect(first.map((i) => i.src)).not.toContain(blob("b0d4d01a", "sm"));
    expect(first.map((i) => i.src)).not.toContain(blob("44ff55aa", "sm"));
    expect(first[0].alt).toBe("333");
    expect(first[3].alt).toBe("");
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

  it("takes the largest size the page names, not only the largest that exists", () => {
    // Stock's data lists a gallery picture as _sm and _md and nothing else.
    const html = `<img src="${blob("qq", "sm")}"/><span>${blob("qq", "md")}</span>`;
    expect(fullSize(blob("qq", "sm"), html)).toBe(blob("qq", "md"));
    expect(fullSize(blob("qq", "md"), html)).toBe(blob("qq", "md"));
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

describe("a picture offered as a set of sizes", () => {
  it("takes the largest the set names", () => {
    expect(largestInSrcSet("/p-400.jpg 400w, /p-1600.jpg 1600w, /p-800.jpg 800w")).toBe("/p-1600.jpg");
    expect(largestInSrcSet("/p.jpg 1x, /p@2x.jpg 2x")).toBe("/p@2x.jpg");
    expect(largestInSrcSet("/only.jpg")).toBe("/only.jpg");
    expect(largestInSrcSet(null)).toBe(null);
    expect(largestInSrcSet("   ")).toBe(null);
  });

  it("reads a gallery whose pictures carry no src at all", () => {
    const html =
      '<h2>Gallery</h2>' +
      '<img srcset="https://x.test/a-400.webp 400w, https://x.test/a-1600.webp 1600w" alt="Kitchen">' +
      '<img data-srcset="https://x.test/b-1200.webp 1200w" alt="Bedroom">';
    const [, gallery] = sectionsOf(html, "https://x.test/plan/");
    expect(gallery.heading).toBe("Gallery");
    expect(gallery.images.map((i) => i.src)).toEqual([
      "https://x.test/a-1600.webp",
      "https://x.test/b-1200.webp",
    ]);
  });
});

describe("documentBase: a page's <base href> (Richmond American, 2026-09-23)", () => {
  const page = "https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/";
  it("resolves a relative link against the page's base, not the page", () => {
    const html = `<html><head><base href="/"></head><body><a href="florida/tampa-new-homes/parrish/estates-at-rivers-edge/fraser/">Fraser</a></body></html>`;
    expect(documentBase(html, page)).toBe("https://www.richmondamerican.com/");
    expect(new URL("florida/x/", documentBase(html, page)).href).toBe("https://www.richmondamerican.com/florida/x/");
  });
  it("is the page itself where no base is named", () => {
    expect(documentBase("<html><body></body></html>", page)).toBe(page);
  });
});

describe("captionedCarousel (Pulte plan pages, Daylen at Riversong, 2026-09-23)", () => {
  const cdn = (id: number, w = 768) =>
    `https://res.cloudinary.com/dv0jqjrc3/image/fetch/ar_1.5,c_fill,f_auto,q_auto,w_${w}/https://pultegroup.picturepark.com/Go/mLJpMux8/V/${id}/13`;
  const slide = (id: number, caption: string) =>
    `<div class="slide"><img src="${cdn(id)}" alt="${caption}"><div class="caption"><h5>${caption}</h5><button>Save Item</button></div></div>`;
  const DAYLEN = [
    [650661, "Daylen Exterior"],
    [650640, "Designer Kitchen"],
    [650639, "Large Center Island"],
    [650642, "Gathering Room"],
    [650648, "Owner's Suite"],
    [650650, "Owner's Bath"],
    [650641, "Perfect for Entertaining"],
    [439080, "Elevation FM1"],
  ] as const;
  const PINECREST = [
    [700001, "Pinecrest Exterior"],
    [700002, "Designer Kitchen"],
    [700003, "Versatile Loft"],
    [700004, "Covered Lanai"],
  ] as const;
  const page = [
    `<h2>Daylen</h2>`,
    // The loop's clone of the last slide, before the first.
    slide(439080, "Elevation FM1"),
    ...DAYLEN.map(([id, caption]) => slide(id, caption)),
    `<h1>Daylen At Riversong</h1><h3>Floor Plans</h3><img src="https://www.pulte.com/-/media/fp.png" alt="">`,
    `<h2>Similar plans</h2>`,
    ...PINECREST.map(([id, caption]) => slide(id, caption)),
  ].join("\n");
  const BASE = "https://www.pulte.com/homes/florida/sarasota/parrish/riversong-211407/daylen-699105";

  it("takes the first carousel of captioned slides, each picture once", () => {
    const { first } = captionedCarousel(page, BASE);
    expect(first.map((i) => i.alt)).toEqual([
      "Elevation FM1",
      "Daylen Exterior",
      "Designer Kitchen",
      "Large Center Island",
      "Gathering Room",
      "Owner's Suite",
      "Owner's Bath",
      "Perfect for Entertaining",
    ]);
  });

  it("marks the later carousels' pictures as somebody else's", () => {
    const { drop } = captionedCarousel(page, BASE);
    expect(drop.has(cdn(700002))).toBe(true);
    expect(drop.has(cdn(650640))).toBe(false);
  });

  it("does not take a row of other plans' cards for a gallery", () => {
    const cards = ["Daylen", "Pinecrest", "Crestmere", "Heston", "Mercer"]
      .map((name, i) => `<a href="/p/${i}"><img src="https://x.com/${i}.jpg" alt="${name}"><h3>${name}</h3></a><p>From $400,000</p>`)
      .join("");
    expect(captionedCarousel(cards, BASE)).toEqual({ first: [], drop: new Set() });
  });

  it("knows one picture at two sizes of the same image service", () => {
    expect(pictureKey(cdn(650661, 400))).toBe(pictureKey(cdn(650661, 768)));
    expect(pictureKey(cdn(650661))).not.toBe(pictureKey(cdn(650640)));
  });
});

describe("drawingsNamed (Homes by Towne's Floor Plan tab, 2026-09-23)", () => {
  const cdn = "https://d195jfz94fv5eb.cloudfront.net/uploads";
  const page = `
    <img src="${cdn}/gallery/banyan-kitchen.jpg" alt="Kitchen">
    <div data-tab="floor-plan" hidden><img data-src="${cdn}/floorplan/hbt-fl-shellstone-waterside-fp-banyan.jpg"></div>
    <script>{"other":"${cdn.replace(/\//g, "\\/")}\\/floorplan\\/hbt-fl-shellstone-waterside-fp-mooring.jpg"}</script>
    <img src="https://x.com/plans/1272_fp.svg"><img src="https://x.com/plans/palmetto-floor-plan.png">`;
  const BASE = "https://homesbytowne.com/florida/shellstone-at-waterside/banyan";

  it("takes the drawing a file names for this plan, and not another plan's", () => {
    expect(drawingsNamed(page, BASE, ["Banyan"])).toEqual([`${cdn}/floorplan/hbt-fl-shellstone-waterside-fp-banyan.jpg`]);
    expect(drawingsNamed(page, BASE, ["Mooring"])).toEqual([`${cdn}/floorplan/hbt-fl-shellstone-waterside-fp-mooring.jpg`]);
  });

  it("reads a plan named by its number, and a home by its plan's name", () => {
    expect(drawingsNamed(page, BASE, ["Plan 1272"])).toEqual(["https://x.com/plans/1272_fp.svg"]);
    expect(drawingsNamed(page, BASE, ["12 Harbor Way", "Banyan"])).toHaveLength(1);
  });

  it("does not take a photo, or a word inside another word", () => {
    expect(drawingsNamed(page, BASE, ["Palm"])).toEqual([]);
    expect(drawingsNamed(`<img src="${cdn}/gallery/banyan-kitchen.jpg">`, BASE, ["Banyan"])).toEqual([]);
  });
});
