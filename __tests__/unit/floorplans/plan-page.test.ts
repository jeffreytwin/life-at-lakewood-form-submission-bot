import { describe, expect, it } from "vitest";
import {
  documentBase,
  firstGallery,
  fullSize,
  largestInSrcSet,
  pictureKey,
  captionedCarousel,
  drawingsNamed,
  joinedPicture,
  lightboxGallery,
  elevationPictures,
  picturesNamedFor,
  imageAddress,
  namedGallery,
  sectionsOf,
  askedSize,
  onePerPicture,
  drawingsMarked,
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

describe("Pulte's carousel as the page writes it (Daylen at Riversong, 2026-09-23)", () => {
  // As fetched: no src at all — the script joins data-dam and data-name.
  const slide = (id: number, caption: string) => `
    <div class="Carousel-slide" data-type="image">
      <button class="image-wrapper" type="button">
        <span class="sr-only">Expand carousel image. </span>
        <img loading="lazy" class="u-responsiveMedia cld-responsive" alt="${caption} "
             data-dam="//res.cloudinary.com/dv0jqjrc3/image/fetch/"
             data-name="https://pultegroup.picturepark.com/Go/mLJpMux8/V/${id}/13"
             data-size="{&quot;0&quot;:&quot;ar_1.5&quot;,&quot;768&quot;:&quot;ar_1.5&quot;,&quot;1025&quot;:&quot;ar_1.5&quot;,&quot;1920&quot;:&quot;ar_1.5&quot;}"
             data-transformations="c_fill,f_auto,q_auto,w_auto"
             data-alt="${caption} ">
      </button>
      <h5 class="Image-caption mr-lg-6" title="${caption} " tabindex="-1">
        ${caption.replace("'", "&#39;")}
      </h5>
      <div class="Social-links"><button type="button"><i data-image-caption="${caption} "></i></button></div>
    </div>`;
  const page = `<section class="Carousel-v2">${[
    [650661, "Daylen Exterior"],
    [650640, "Designer Kitchen"],
    [650639, "Large Center Island"],
    [650648, "Owner's Suite"],
    [650650, "Owner's Bath"],
  ]
    .map(([id, caption]) => slide(id as number, caption as string))
    .join("")}</section>`;

  it("joins each slide's two halves at the largest size the page asks for", () => {
    expect(joinedPicture(page.match(/<img\b[^>]*>/)![0])).toBe(
      "https://res.cloudinary.com/dv0jqjrc3/image/fetch/ar_1.5,c_fill,f_auto,q_auto,w_1920/https://pultegroup.picturepark.com/Go/mLJpMux8/V/650661/13"
    );
  });

  it("reads the carousel whole, captions and all", () => {
    const { first } = captionedCarousel(page, "https://www.pulte.com/homes/florida/sarasota/parrish/riversong-211407/daylen-699105");
    expect(first.map((i) => i.alt)).toEqual(["Daylen Exterior", "Designer Kitchen", "Large Center Island", "Owner's Suite", "Owner's Bath"]);
    expect(first[0].src).toContain("/image/fetch/ar_1.5,c_fill,f_auto,q_auto,w_1920/https://pultegroup.picturepark.com/Go/mLJpMux8/V/650661/13");
  });
});

describe("lightboxGallery (Kolter's Eva at Woodland Preserve, 2026-09-23)", () => {
  const r = "https://cdn.kolterhomes.com/kh-includes/communities/parrish-florida-woodland-preserve/renderings";
  const slide = (file: string, caption: string, group = "model-carousel") =>
    `<div class="f-carousel__slide" data-fancybox="${group}" data-src="${r}/${file}" data-caption="${caption}"> <img data-lazy-src="${r}/tr:h-720,w-1280,c-maintain_ratio/${file}" alt="Eva Model Home | ${caption}"> </div>`;
  const page = `<section id="model-images"><div class="f-carousel default">
    ${slide("kolter%2Dwp%2Deva%2Ddusk%2D011%2Ejpg", "Transitional ")}
    ${slide("woodland%2Dpreserve%2Deva%2D003%2Ejpg", "Entry")}
    ${slide("woodland%2Dpreserve%2Deva%2D008%2Ejpg", "Dining room ")}
    ${slide("woodland%2Dpreserve%2Deva%2D005%2Ejpg", "Kitchen")}
    ${slide("eva%2Dfloorplan%2Ejpg", "Floor Plan", "floorplans")}
    ${slide("clubhouse%2D1%2Ejpg", "Clubhouse", "community")}${slide("clubhouse%2D2%2Ejpg", "Pool", "community")}${slide("clubhouse%2D3%2Ejpg", "Gym", "community")}
  </div></section>`;
  const BASE = "https://www.kolterhomes.com/new-homes/parrish-florida-woodland-preserve/5289/floorplan/eva/";

  it("takes the first lightbox gallery whole, full size, with its captions", () => {
    const { first } = lightboxGallery(page, BASE);
    expect(first.map((i) => i.alt)).toEqual(["Transitional", "Entry", "Dining room", "Kitchen"]);
    expect(first[1].src).toBe(`${r}/woodland%2Dpreserve%2Deva%2D003%2Ejpg`);
  });

  it("takes a floor plan group's pictures as drawings, and leaves the community's gallery out", () => {
    const { first, drawings } = lightboxGallery(page, BASE);
    expect(drawings).toEqual([`${r}/eva%2Dfloorplan%2Ejpg`]);
    expect(first.some((i) => /clubhouse/.test(i.src))).toBe(false);
  });

  it("reads the lazy picture's address", () => {
    expect(imageAddress(`<img data-lazy-src="${r}/x.jpg" alt="">`)).toBe(`${r}/x.jpg`);
  });
});

describe("elevationPictures (Stock's plan pages)", () => {
  it("takes the pictures under an Elevations heading, and not a tour's still or the gallery", () => {
    const html = `<h2>Elevations</h2><img src="https://x.com/a/elev-a.jpg" alt="A"><img src="https://x.com/a/elev-b.jpg" alt="B">
      <h2>Virtual Tours</h2><img src="https://x.com/a/tour.jpg">
      <h2>Galleries</h2><h4>Wild Blue — Interior by Dan Rak</h4><img src="https://x.com/a/kitchen.jpg">`;
    expect(elevationPictures(html, "https://x.com/plan").map((i) => i.src)).toEqual(["https://x.com/a/elev-a.jpg", "https://x.com/a/elev-b.jpg"]);
  });
});

describe("captionedCarousel prefers the plan's own carousel (Pulte's Riversong, 2026-09-23)", () => {
  const slide = (id: string, caption: string) => `<img src="https://x.com/${id}.jpg" alt="${caption}"><h5>${caption}</h5>`;
  const amenities = ["Resort-Style Pool", "Covered Lanai", "Fitness Room", "Community Kitchen"].map((c, i) => slide(`a${i}`, c)).join("");
  const daylen = ["Daylen Exterior", "Designer Kitchen", "Gathering Room", "Owner's Bath"].map((c, i) => slide(`d${i}`, c)).join("");
  const page = `<section>${amenities}</section><h2>Daylen</h2><section>${daylen}</section>`;

  it("takes the carousel that names the plan, and drops the community's", () => {
    const { first, drop } = captionedCarousel(page, "https://x.com/daylen", "Daylen");
    expect(first.map((i) => i.alt)).toEqual(["Daylen Exterior", "Designer Kitchen", "Gathering Room", "Owner's Bath"]);
    expect(drop.has("https://x.com/a0.jpg")).toBe(true);
  });

  it("takes the first carousel where none names the plan", () => {
    expect(captionedCarousel(page, "https://x.com/daylen", "Pinecrest").first[0].alt).toBe("Resort-Style Pool");
  });
});

describe("picturesNamedFor (Perry's elevations, drawn in the browser, 2026-09-23)", () => {
  const cl = (overlay: string, id: string) =>
    `https://res.cloudinary.com/perryhomes/image/upload/f_auto,c_limit,w_1920,q_auto/b_rgb:1B1919,co_rgb:fafafa,l_text:Arial_700_bold_24:%20%20${overlay}%20%20/c_scale,fl_relative,w_0.15/fl_layer_apply,g_south_east/v1/${id}?_a=B`;
  const page = `<img alt="star-farms-at-lakewood-ranch" src="${cl("DESIGN%202016F%20E-1", "a1")}">
    <img alt="star-farms-at-lakewood-ranch" src="${cl("DESIGN%202016F%20E-31", "a31")}">
    <img alt="star-farms-at-lakewood-ranch" src="${cl("DESIGN%202016F%20E-50", "a50")}">
    <img alt="Floor plan" src="https://res.cloudinary.com/perryhomes/image/upload/c_limit,w_500/2016F-FP_frnnpg">
    <img alt="" src="${cl("DESIGN%202200F%20E-1", "b1")}">`;

  it("takes the pictures whose address names the plan, and not its drawing or another plan's", () => {
    const got = picturesNamedFor(page, "https://www.perryhomes.com/x/2016f", ["2016F"]);
    expect(got).toHaveLength(3);
    expect(got.every((u) => u.includes("2016F%20E-"))).toBe(true);
  });
});

describe("elevationPictures does not take a slide's caption for a section (Pulte, 2026-09-23)", () => {
  it("ignores what follows a heading like \"Elevation FM1\"", () => {
    const html = `<h5>Elevation FM1</h5><img src="https://x.com/community-pool.jpg"><img src="https://x.com/clubhouse.jpg">`;
    expect(elevationPictures(html, "https://x.com/plan")).toEqual([]);
  });
});

describe("imageAddress and placeholders", () => {
  it("takes no loading picture for a picture of the home", () => {
    // Ashton Woods' gallery at 10046 Hidden Hammock Loop (2026-09-23).
    expect(imageAddress('<img src="https://www.ashtonwoods.com/assets/loading-dot-pattern-1bcbfdcf1f.gif" alt="Loading...">')).toBeNull();
    expect(imageAddress('<img src="/img/spacer.gif">')).toBeNull();
    expect(imageAddress('<img src="/img/placeholder.png" data-src="/img/kitchen.jpg">')).toBe("/img/kitchen.jpg");
    expect(imageAddress('<img src="/img/loading-dock.jpg">')).toBe("/img/loading-dock.jpg");
  });
});

describe("namedGallery", () => {
  // Haven at Bungalow Walk (Dream Finders, 2026-09-23): the gallery's title
  // is a <div>, and every slide is captioned only by its number.
  const DF = "https://dreamfindershomes.com/new-homes/fl/lakewood-ranch/bungalow-walk-at-lakewood-ranch/haven/";
  const slide = (n: number) =>
    `<div class="swiper-slide"><div class="oi-aspect three-two"><img src="https://media.dreamfindershomes.com/371/Haven-${n}.jpg?width=1000&amp;height=625" loading="lazy" alt="Haven New Home in Lakewood Ranch, FL.  - Slide ${n}" /></div></div>`;
  const page = `<div class="community-gallery"><img src="/amenity-1.jpg"><img src="/amenity-2.jpg"><img src="/amenity-3.jpg"></div>
    <div id="model-gallery" class="py-3"><div class="heading">Floor Plan Gallery</div>
      <div class="swiper modeGallerySwiper"><div class="swiper-wrapper">${[1, 2, 3, 4].map(slide).join("")}</div></div>
    </div>
    <div class="similar-plans"><img src="/other-plan.jpg"></div>`;

  it("takes the pictures of the first block named a gallery, and stops where it closes", () => {
    const got = namedGallery(page, DF);
    expect(got.map((i) => i.src)).toEqual([1, 2, 3, 4].map((n) => `https://media.dreamfindershomes.com/371/Haven-${n}.jpg?width=1000&height=625`));
  });

  it("passes over a gallery of the community's", () => {
    expect(namedGallery(page, DF).some((i) => i.src.includes("amenity"))).toBe(false);
  });

  it("gives nothing where no gallery holds three pictures", () => {
    expect(namedGallery(`<div class="gallery"><img src="/a.jpg"><img src="/b.jpg"></div>`, DF)).toEqual([]);
  });

  it("takes each slide once, not again as its thumbnail", () => {
    const thumb = (n: number) =>
      `<div class="swiper-slide"><img src="https://media.dreamfindershomes.com/371/Haven-${n}.jpg?width=100&amp;height=62" alt="Thumbnail for Slide ${n}" /></div>`;
    const withThumbs = page.replace(`</div></div>\n    </div>`, `</div></div><div class="swiper thumbs">${[1, 2, 3, 4].map(thumb).join("")}</div>\n    </div>`);
    expect(withThumbs).toContain("Thumbnail for Slide 4");
    expect(namedGallery(withThumbs, DF).map((i) => i.src)).toEqual(
      [1, 2, 3, 4].map((n) => `https://media.dreamfindershomes.com/371/Haven-${n}.jpg?width=1000&height=625`)
    );
  });
});

describe("pictureKey and askedSize", () => {
  it("knows a file at any size its query asks for, and by its name however it is written", () => {
    const df = "https://media.dreamfindershomes.com/371/2024/3/17/Bunaglow_Walk-Pemberly-A-Gen3.jpg";
    expect(pictureKey(`${df}?width=1000&height=625&fit=bounds&ois=c60fe8c`)).toBe(pictureKey(`${df}?width=100&height=62&fit=bounds&ois=c2eba2b`));
    expect(pictureKey("https://highlandhomes.imgix.net/model/Parker%2DA1%2Ejpg?fit=crop&w=225")).toBe(pictureKey("https://highlandhomes.imgix.net/model/Parker-A1.jpg"));
  });

  it("knows a picture a resizer carries in base64, at any size", () => {
    const adams = (source: string, size: string) =>
      `https://dlqxt4mfnxo6k.cloudfront.net/adamshomes.com/${Buffer.from(source).toString("base64")}/${size}`;
    const front = "https://s3.amazonaws.com/buildercloud/b3b3e717034e6cb586761f1c891a57bc.jpeg";
    expect(pictureKey(adams(front, "exact/w1200"))).toBe(pictureKey(adams(front, "webp/30")));
    expect(pictureKey(adams(front, "webp/30"))).not.toBe(pictureKey(adams("https://s3.amazonaws.com/buildercloud/2ad5275be471ce95852e47de5a1eb882.jpeg", "webp/30")));
  });

  it("keeps apart pictures an address tells apart only by its query", () => {
    expect(pictureKey("https://x.com/photo?id=1")).not.toBe(pictureKey("https://x.com/photo?id=2"));
  });

  it("reads the width an address asks for", () => {
    expect(askedSize("https://m.com/a.jpg?width=1000&height=625")).toBe(1000);
    expect(askedSize("https://m.com/a.jpg?fit=crop&w=900&h=675")).toBe(900);
    expect(askedSize("https://m.com/a.jpg")).toBe(0);
    expect(askedSize("https://www.davidweekleyhomes.com/media/ElevationPhoto/5f903ffd.JPG?h=800")).toBe(800);
  });
});

describe("onePerPicture", () => {
  const front = "https://media.dreamfindershomes.com/371/Pemberly-A-Gen3.jpg";
  it("keeps a picture once, in its first place, at the largest size asked for", () => {
    const got = onePerPicture([`${front}?width=400`, "https://m.com/kitchen.jpg", `${front}?width=1000`, `${front}?width=100`]);
    expect(got.photos).toEqual([`${front}?width=1000`, "https://m.com/kitchen.jpg"]);
    expect(got.enlarged.get(`${front}?width=400`)).toBe(`${front}?width=1000`);
  });

  it("keeps the first spelling where none asks for a size", () => {
    expect(onePerPicture(["https://r.com/media-1.jpg", "https://r.com/media-1.webp"]).photos).toEqual(["https://r.com/media-1.jpg"]);
  });
});

describe("drawingsMarked", () => {
  // Covington III at Wild Blue (Stock, 2026-09-23): the drawing under a heading of its own.
  const STOCK = "https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/281/";
  const stockPage = `<section><h2 class="display-3">Elevations</h2><div><button aria-label="Open Elevation K — Modern"><img alt="Elevation K — Modern" src="https://fabrik.blob.core.windows.net/public/c25d1671_lg.jpg"></button></div></section>
    <section><div class=" "><h2 class="display-3">Floor Plan</h2><div class="h-[3px] w-14"></div></div><div class="mt-6 space-y-6"><div class="flex flex-wrap gap-3"><button>PDF for Print</button></div>
    <div class=" w-full sm:w-1/2"><button class="relative block overflow-hidden group" aria-label="Open Covington III floor plan"><img src="https://fabrik.blob.core.windows.net/public/4a6363de-a6b8-45d1-b158-5cb523dc4947.jpg" alt="Covington III floor plan" class="w-full h-auto block"/></button></div></div></section>
    <section><h2>Interested in the Covington III</h2><img src="https://www.stockdevelopment.com/contact.jpg"></section>`;

  it("takes the pictures under a heading that is only \"Floor Plan\"", () => {
    expect(drawingsMarked(stockPage, STOCK)).toEqual(["https://fabrik.blob.core.windows.net/public/4a6363de-a6b8-45d1-b158-5cb523dc4947.jpg"]);
  });

  // Jasmine 2 at Broadleaf (SimplyDwell, 2026-09-23): the drawing in a box its class names.
  it("takes a picture whose class or box calls it the floor plan, once", () => {
    const fp = "https://simplydwellhomes.com/wp-content/uploads/2026/06/Jasmine-2.jpg";
    const page = `<div class="sd-ov__panel"><div class="sd-ov__floorplan"><img class="sd-ov__fp-img" src="${fp}" alt="Jasmine 2" loading="lazy"></div></div>
      <dialog aria-label="Floorplan zoom"><div class="zoomist-image"><img src="${fp}" alt="Jasmine 2"></div></dialog>
      <section class="sd-hgal" aria-label="Photo gallery"><ul class="sd-hgal__track"><li class="sd-hgal__item"><button class="sd-hgal__thumb"><img src="https://simplydwellhomes.com/wp-content/uploads/2026/06/Jasmine-30-2413_Elevation-A.webp" alt=""></button></li></ul></section>`;
    expect(drawingsMarked(page, "https://simplydwellhomes.com/new-homes/broadleaf/jasmine-2/")).toEqual([fp]);
  });

  it("leaves out the page's icons beside a drawing (Kolter)", () => {
    const page = `<div class="floorplan-image"><img src="https://cdn.kolterhomes.com/kh-includes/images/svg/sketch.svg" width="24" height="24">
      <img src="https://cdn.kolterhomes.com/kh-includes/communities/parrish-florida-woodland-preserve/floorplans/morgan-master-floor-1.jpg"></div>`;
    expect(drawingsMarked(page, "https://www.kolterhomes.com/x/")).toEqual([
      "https://cdn.kolterhomes.com/kh-includes/communities/parrish-florida-woodland-preserve/floorplans/morgan-master-floor-1.jpg",
    ]);
  });

  it("takes nothing from a list of other plans, a page's own title, or a room's caption", () => {
    const page = `<h1>Fraser floor plan</h1><img src="https://r.com/media-1.jpg" alt="Kitchen of the Fraser floor plan">
      <h2>Other Floor Plans</h2><div class="related-floorplans"><div class="floorplan-card"><img src="https://r.com/sage.jpg" alt="Sage"></div></div>
      <div class="fp-section"><img src="https://r.com/hero.jpg"></div>`;
    expect(drawingsMarked(page, "https://r.com/fraser/")).toEqual([]);
  });
});
