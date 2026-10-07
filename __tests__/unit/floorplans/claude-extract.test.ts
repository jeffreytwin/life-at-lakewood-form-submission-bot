import { describe, it, expect } from "vitest";
import {
  keptFromPage,
  statedPrice,
  statedSqft,
  livingSqft,
  asList,
  distinctKey,
  isTourUrl,
  orderPhotos,
  tourLinkIn,
  tourUrlIn,
  withoutBlanks,
  pictureAddresses,
  distill,
  withTotalPrices,
  sortDrawings,
  planName,
  mergeRepeatedPlan,
  homesPageIn,
  EXTRACT_TOOL,
  EXTRACT_TOOL_STRICT,
  drawingsOrPhotos,
  drawingsNotShownAsPhotos,
} from "@/lib/floorplans/extractors/claude-extract";
import type { NormalizedPlan } from "@/lib/floorplans/types";
import { elevationPictures, firstGallery } from "@/lib/floorplans/extractors/plan-page";

describe("tourUrlIn", () => {
  it("finds a Zillow 3D Home, which carries no tour-looking words at all", () => {
    expect(
      tourUrlIn('data-x="https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017?wl=true"')
    ).toBe("https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017");
  });

  it("finds a tour the page keeps in its own scripts, which distillation drops", () => {
    // Stock's plan pages carry the tour in the React payload, not in a link
    // or an iframe (Wyndam IV, probed 2026-09-21).
    const payload =
      '<script>self.__next_f.push([1,"...\\"$L31\\",\\"3019\\",{\\"src\\":\\"https://my.matterport.com/show/?m=K1hZHtKa6ok\\",\\"title\\":\\"Virtual Tour\\"}..."])</script>';
    expect(tourUrlIn(payload)).toBe("https://my.matterport.com/show/?m=K1hZHtKa6ok");
  });

  it("reads a payload that escapes its slashes", () => {
    expect(tourUrlIn('{"src":"https:\\/\\/my.matterport.com\\/show\\/?m=Rb3LScZcMBr"}')).toBe(
      "https://my.matterport.com/show/?m=Rb3LScZcMBr"
    );
  });

  it("takes the first tour where a page offers several", () => {
    const two =
      '{"a":"https://my.matterport.com/show/?m=K1hZHtKa6ok","b":"https://my.matterport.com/show/?m=Rb3LScZcMBr"}';
    expect(tourUrlIn(two)).toBe("https://my.matterport.com/show/?m=K1hZHtKa6ok");
  });

  it("knows the other hosts builders use, and says nothing for a page with none", () => {
    expect(tourUrlIn('<a href="https://www.insidemaps.com/tours/abc123">Tour</a>')).toBe(
      "https://www.insidemaps.com/tours/abc123"
    );
    expect(tourUrlIn('<a href="https://kuula.co/share/collection/7abc">Tour</a>')).toBe(
      "https://kuula.co/share/collection/7abc"
    );
    expect(tourUrlIn("<p>No tour here, just a Google Tag Manager iframe.</p>")).toBeNull();
    // A page's own marketing copy is not a tour link.
    expect(tourUrlIn('<meta content="View elevations, specs, virtual tours, and available homes."/>')).toBeNull();
  });
});

describe("tourLinkIn", () => {
  it("takes the link a page labels as its tour, whatever host it points at", () => {
    // SimplyDwell's tour is a Zillow 3D Home behind "Take a Virtual Tour!".
    const html =
      '<div class="sd-ov__desc-actions"><a class="sd-ov__btn-vtour" ' +
      'href="https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017?wl=true&#038;initialViewType=pano" ' +
      'target="_blank" rel="noopener"><span>Take a Virtual Tour!</span></a></div>';
    expect(tourLinkIn(html)).toBe(
      "https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017?wl=true&initialViewType=pano"
    );
  });

  it("knows the other words builders put on the link", () => {
    const link = (label: string) => `<a href="https://tours.example.com/x">${label}</a>`;
    expect(tourLinkIn(link("3D Tour"))).toBe("https://tours.example.com/x");
    expect(tourLinkIn(link("Tour this home"))).toBe("https://tours.example.com/x");
    expect(tourLinkIn(link("<span>Video Tour</span>"))).toBe("https://tours.example.com/x");
  });

  it("passes over a link that is not a tour, and a relative one", () => {
    expect(tourLinkIn('<a href="https://x.test/plans">Tour our communities</a>')).toBeNull();
    expect(tourLinkIn('<a href="/virtual-tour/">Virtual Tour</a>')).toBeNull();
    expect(tourLinkIn("<p>Virtual Tour</p>")).toBeNull();
  });
});

describe("orderPhotos", () => {
  const sd = (name: string) => `https://simplydwellhomes.com/wp-content/uploads/2026/06/${name}`;

  it("leads with the hero, then the rooms, and puts the other elevations last", () => {
    // SimplyDwell prints three elevations per plan and all three were
    // landing in front of the interiors (Jeff, 2026-09-22).
    const ordered = orderPhotos([
      sd("Azalea-40-1817_Elevation-A-1.webp"),
      sd("Azalea-40-1817_Elevation-B-1.webp"),
      sd("Azalea-40-1817_Elevation-C.webp"),
      sd("4638-8-scaled-1.webp"),
      sd("4638-12-scaled-1.webp"),
    ]);
    expect(ordered.urls).toEqual([
      sd("Azalea-40-1817_Elevation-A-1.webp"),
      sd("4638-8-scaled-1.webp"),
      sd("4638-12-scaled-1.webp"),
      sd("Azalea-40-1817_Elevation-B-1.webp"),
      sd("Azalea-40-1817_Elevation-C.webp"),
    ]);
    expect(ordered.meta[sd("Azalea-40-1817_Elevation-A-1.webp")].kind).toBe("primary");
    expect(ordered.meta[sd("Azalea-40-1817_Elevation-C.webp")].room).toBe("exterior");
  });

  it("sorts by the rooms a file name does say", () => {
    const ordered = orderPhotos([
      sd("front-elevation.webp"),
      sd("owners-bath.webp"),
      sd("kitchen-island.webp"),
      sd("great-room.webp"),
    ]);
    expect(ordered.urls).toEqual([
      sd("front-elevation.webp"),
      sd("kitchen-island.webp"),
      sd("great-room.webp"),
      sd("owners-bath.webp"),
    ]);
  });

  it("reads nothing into a media store's own id", () => {
    // "bed" is valid hex, and a UUID that spells it is not a bedroom.
    const opaque = "https://fabrik.blob.core.windows.net/public/0bed8fcc-430d-480c-919f-a55d52c53bd8_lg.jpg";
    const kitchen = sd("kitchen.webp");
    const ordered = orderPhotos([sd("elevation-a.webp"), opaque, kitchen]);
    expect(ordered.meta[opaque].room).toBeNull();
    expect(ordered.urls).toEqual([sd("elevation-a.webp"), kitchen, opaque]);
  });
});

describe("distinctKey", () => {
  // Stock keeps its homes for sale on a page of their own, and names each
  // one for the plan it is built from (Jeff, 2026-09-22). Two rows named
  // "Madison II" would otherwise be read as one plan.
  const home = (planKey: string, sourceUrl: string | null): NormalizedPlan => ({
    planKey,
    name: planKey,
    price: null,
    priceDisplay: null,
    beds: "",
    baths: "",
    sqft: null,
    garages: null,
    homeType: null,
    quickMoveIn: true,
    comingSoon: false,
    sourceUrl,
    galleryImages: [],
    blueprintImages: [],
  });
  const inventory = (id: string) => `https://www.stockdevelopment.com/projects/wild-blue-at-waterside/inventory/${id}/`;

  it("leaves a home whose name no plan has taken alone", () => {
    expect(distinctKey(home("1003-blue-shell-loop", inventory("20011060173")), new Set(["madison-ii"])))
      .toBe("1003-blue-shell-loop");
  });

  it("keeps a home named for its plan apart from the plan itself", () => {
    const key = distinctKey(home("madison-ii", inventory("20011060173")), new Set(["madison-ii"]));
    expect(key).toBe("madison-ii-20011060173");
  });

  it("gives the same home the same key on every run", () => {
    const once = distinctKey(home("madison-ii", inventory("20011060173")), new Set(["madison-ii"]));
    const again = distinctKey(home("madison-ii", inventory("20011060173")), new Set(["madison-ii"]));
    expect(again).toBe(once);
  });

  it("keeps two homes of one plan apart even where their pages give nothing to tell them by", () => {
    const taken = new Set(["madison-ii"]);
    const first = distinctKey(home("madison-ii", null), taken);
    taken.add(first);
    const second = distinctKey(home("madison-ii", null), taken);
    expect(first).toBe("madison-ii-home-2");
    expect(second).toBe("madison-ii-home-3");
  });

  it("ignores a query string and a missing trailing slash", () => {
    expect(distinctKey(home("easton-iii", inventory("20011060174").replace(/\/$/, "") + "?utm=x"), new Set(["easton-iii"])))
      .toBe("easton-iii-20011060174");
  });
});

describe("orderPhotos, with what the page said about its own pictures", () => {
  // Perry's payload leads with the front of the house and follows it with
  // twenty-two rooms (Jeff, 2026-09-22). Exteriors go last, so the lead
  // has to be the first room, not the first picture.
  const perry = (name: string) => `https://res.cloudinary.com/perryhomes/image/upload/v1/${name}.jpg`;
  const front = perry("3413CountryViewCourt");
  const rooms = [perry("3413CountryViewCourt-01"), perry("3413CountryViewCourt-02"), perry("3413CountryViewCourt-03")];
  /** The page calling one of its pictures an outside view, as the reader records it. */
  const outside = (src: string) => ({ [src]: { caption: null, room: "exterior" as const, kind: "exterior" as const } });

  it("leads with a room and puts the page's own exterior last", () => {
    const ordered = orderPhotos([front, ...rooms], outside(front));
    expect(ordered.urls).toEqual([...rooms, front]);
    expect(ordered.meta[rooms[0]].kind).toBe("primary");
    expect(ordered.meta[front].room).toBe("exterior");
  });

  it("keeps the page's order among the rooms it says nothing about", () => {
    const ordered = orderPhotos([front, ...rooms], outside(front));
    expect(ordered.urls.slice(0, 3)).toEqual(rooms);
  });

  it("behaves as before for a gallery the page said nothing about", () => {
    const ordered = orderPhotos([front, ...rooms]);
    expect(ordered.urls[0]).toBe(front);
    expect(ordered.meta[front].kind).toBe("primary");
  });
});

describe("distinctKey across several list pages", () => {
  // Perry splits a community by lot width and lists the homes under each
  // (Jeff, 2026-09-22). One design offered on two of them is two rows, and
  // each keeps a key of its own rather than the second overwriting the
  // first.
  const perry = (lot: string, design: string) =>
    `https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch/star-farms-at-lakewood-ranch-${lot}/${design}`;
  const plan = (planKey: string, sourceUrl: string): NormalizedPlan => ({
    planKey,
    name: planKey,
    price: null,
    priceDisplay: null,
    beds: "",
    baths: "",
    sqft: null,
    garages: null,
    homeType: null,
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl,
    galleryImages: [],
    blueprintImages: [],
  });

  it("keeps one design offered on two pages apart, by the page it came from", () => {
    const taken = new Set<string>();
    const first = distinctKey(plan("3741f", perry("75", "3741f")), taken);
    taken.add(first);
    const second = distinctKey(plan("3741f", perry("90", "3741f")), taken);
    // The first keeps the plain key; the second takes one of its own,
    // drawn from its page's address. What matters is that they differ —
    // the exact spelling of the second is the address's business.
    expect(first).toBe("3741f");
    expect(second).not.toBe(first);
    expect(second.startsWith("3741f-")).toBe(true);
  });

  it("leaves designs that appear once alone", () => {
    const taken = new Set<string>();
    for (const design of ["3741f", "3638f", "3024f"]) {
      const key = distinctKey(plan(design, perry("90", design)), taken);
      taken.add(key);
      expect(key).toBe(design);
    }
    expect([...taken]).toEqual(["3741f", "3638f", "3024f"]);
  });
});

describe("isTourUrl", () => {
  it("knows a tour from a page about one", () => {
    // Ryan wraps its Matterports in a page of its own, and handing a
    // visitor the wrapper is not handing them the tour (Jeff, 2026-09-22).
    expect(isTourUrl("https://my.matterport.com/show/?m=azMuVg7aAri")).toBe(true);
    expect(
      isTourUrl(
        "https://www.ryanhomes.com/new-homes/communities/10222120152673/florida/lakewood-ranch/mayport/virtual-tour/31336"
      )
    ).toBe(false);
  });

  it("knows the other hosts that serve tours", () => {
    expect(isTourUrl("https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017")).toBe(true);
    expect(isTourUrl("https://www.insidemaps.com/tours/abc123")).toBe(true);
    // Kuula serves its tours from .co, not .com, which the host list had
    // wrong — a real Kuula tour would never have been recognised.
    expect(isTourUrl("https://kuula.co/share/collection/7abc")).toBe(true);
  });

  it("is not fooled by a tour's address appearing inside another", () => {
    // A tour has to be the address, not a word in it.
    expect(isTourUrl("https://example.com/redirect?to=https://my.matterport.com/show/?m=abc")).toBe(false);
  });

  it("says nothing is a tour for a builder's plan page", () => {
    expect(isTourUrl("https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms")).toBe(false);
  });
});

describe("asList", () => {
  it("takes a list as a list", () => {
    expect(asList([{ name: "Mayport" }])).toEqual([{ name: "Mayport" }]);
    expect(asList([])).toEqual([]);
  });

  it("takes a list the model spelled as text", () => {
    // Pulte's community page came back this way twice running, at both
    // ceilings, so it is the answer that page draws rather than one cut
    // short (Jeff, 2026-09-22).
    expect(asList('[{"name":"Mayport"},{"name":"Easton"}]')).toEqual([
      { name: "Mayport" },
      { name: "Easton" },
    ]);
  });

  it("is nothing for an answer that is not a list at all", () => {
    expect(asList("No floor plans were found on this page.")).toBeNull();
    expect(asList('{"name":"Mayport"}')).toBeNull();
    expect(asList(42)).toBeNull();
    expect(asList(null)).toBeNull();
    expect(asList(undefined)).toBeNull();
  });

  it("tells an empty list from no list at all", () => {
    // One means the page listed nothing; the other means the answer was
    // unusable, and they are not the same outcome.
    expect(asList("[]")).toEqual([]);
    expect(asList("")).toBeNull();
  });
});

describe("orderPhotos, when the file names say nothing", () => {
  // Richmond American names every picture media-<id>.webp and titles each
  // one for the room it shows (Jeff, 2026-09-22), so the title is all
  // there is to sort by.
  const media = (id: number) => `https://www.richmondamerican.com/content/plans/media-${id}.webp`;
  /** A picture as the reader records it: the page's own title, and the room that title names. */
  const titled = (id: number, alt: string, room: "bedroom" | "kitchen" | "living" | "exterior") =>
    [media(id), { caption: alt, room, kind: "photo" as const }] as const;

  it("sorts by what the page titled each picture", () => {
    const said = Object.fromEntries([
      titled(161663, "Bedroom of the Slate floor plan", "bedroom"),
      titled(161666, "Kitchen of the Slate floor plan", "kitchen"),
      titled(161668, "Great Room of the Slate floor plan", "living"),
      titled(180528, "Elevation M of the Slate floor plan", "exterior"),
    ]);
    const ordered = orderPhotos(
      [media(161663), media(161666), media(161668), media(180528)],
      said
    );
    // The first picture that is not an outside view leads; then the
    // kitchen and the living room; the elevation goes last.
    expect(ordered.urls).toEqual([media(161663), media(161666), media(161668), media(180528)]);
    expect(ordered.meta[media(161663)].kind).toBe("primary");
    expect(ordered.meta[media(161666)].room).toBe("kitchen");
    expect(ordered.meta[media(161668)].room).toBe("living");
    expect(ordered.meta[media(180528)].room).toBe("exterior");
  });

  it("puts the rooms in the order the site shows them in", () => {
    const said = Object.fromEntries([
      titled(1, "Elevation M of the Slate floor plan", "exterior"),
      titled(2, "Bedroom of the Slate floor plan", "bedroom"),
      titled(3, "Kitchen of the Slate floor plan", "kitchen"),
    ]);
    const ordered = orderPhotos([media(1), media(2), media(3)], said);
    expect(ordered.urls).toEqual([media(2), media(3), media(1)]);
    expect(ordered.meta[media(2)].kind).toBe("primary");
  });
});

describe("withoutBlanks: a strict tool answers every field, and a blank means the page said nothing", () => {
  it("drops empty text and zeros, keeps what was said", () => {
    expect(
      withoutBlanks({ name: "Aspen", price: 0, sqft: 1850, garages: "", homeType: "  ", quickMoveIn: false, photoImages: [] })
    ).toEqual({ name: "Aspen", sqft: 1850, quickMoveIn: false, photoImages: [] });
  });
});

describe("the strict second ask", () => {
  it("requires every field the loose one offers, allows no others, and never says omit", () => {
    const itemsOf = (tool: typeof EXTRACT_TOOL) =>
      (tool.input_schema as unknown as { properties: { plans: { items: { properties: Record<string, { description?: string }>; required: string[]; additionalProperties?: boolean } } } }).properties.plans.items;
    const loose = itemsOf(EXTRACT_TOOL);
    const strict = itemsOf(EXTRACT_TOOL_STRICT);
    expect(EXTRACT_TOOL.strict).toBeUndefined();
    expect(EXTRACT_TOOL_STRICT.strict).toBe(true);
    expect(strict.required.sort()).toEqual(Object.keys(loose.properties).sort());
    expect(strict.additionalProperties).toBe(false);
    for (const field of Object.values(strict.properties)) expect(field.description ?? "").not.toMatch(/omit/i);
  });
});

describe("pictureAddresses: a picture is an address, not its name (Pulte, 2026-09-23)", () => {
  it("keeps web addresses and drops the names Claude handed back in their place", () => {
    expect(
      pictureAddresses(["Exterior CO2", "https://res.cloudinary.com/x/image/fetch/w_1200/a.jpg", "Elevation FM1", " https://cdn.example.com/b.png ", 7, "/relative/c.jpg"])
    ).toEqual(["https://res.cloudinary.com/x/image/fetch/w_1200/a.jpg", "https://cdn.example.com/b.png"]);
    expect(pictureAddresses("not a list")).toEqual([]);
  });
});

describe("distill: a page as Claude is given it", () => {
  const base = "https://homesbytowne.com/florida/shellstone-at-waterside";

  it("reads a tag whole, though an attribute holds JSON with a > in it (Homes by Towne, 2026-09-23)", () => {
    const html = `<astro-island props="{&quot;note&quot;:[0,&quot;--> 2,617 sq ft everywhere&quot;]}"><h2>Banyan</h2><p>2,410 Sq. Ft.</p></astro-island>`;
    const text = distill(html, base);
    expect(text).toContain("Banyan");
    expect(text).toContain("2,410 Sq. Ft.");
    expect(text).not.toContain("2,617");
    expect(text).not.toContain("quot");
  });

  it("gives a lazy picture the address it keeps in data-src, and a link its target", () => {
    const html = `<img src="data:image/gif;base64,R0lGOD" data-src="/img/banyan-kitchen.jpg" alt="Kitchen"><a href="/florida/shellstone-at-waterside/banyan">Banyan</a><img srcset="/a-400.jpg 400w, /a-1600.jpg 1600w">`;
    const text = distill(html, base);
    expect(text).toContain("[IMG https://homesbytowne.com/img/banyan-kitchen.jpg]");
    expect(text).toContain("[LINK https://homesbytowne.com/florida/shellstone-at-waterside/banyan]");
    expect(text).toContain("[IMG https://homesbytowne.com/a-1600.jpg]");
    expect(text).not.toContain("data:");
  });

  it("keeps a < that opens no tag as text, and is quick on a page of megabytes", () => {
    expect(distill("<p>2 < 3 bedrooms</p>", base)).toBe("2 < 3 bedrooms");
    const big = `<div data-x="${"a>b ".repeat(200_000)}">x</div>`.repeat(4);
    const started = Date.now();
    expect(distill(big, base)).toBe("x x x x");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("distill honours a page's <base href>", () => {
  it("gives Claude the link the browser would follow", () => {
    const html = `<head><base href="/"></head><a href="florida/tampa-new-homes/parrish/estates-at-rivers-edge/fraser/">Fraser</a>`;
    expect(distill(html, "https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/")).toContain(
      "[LINK https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/fraser/]"
    );
  });
});

describe("sortDrawings: an elevation is a view of the house, not its floor plan", () => {
  it("moves elevation renderings out of the drawings and keeps the plans", () => {
    const up = (n: string) => `https://simplydwellhomes.com/wp-content/uploads/2026/06/${n}`;
    const got = sortDrawings([
      up("Jasmine-2.jpg"),
      up("Jasmine-30-2413_Elevation-A-2-scaled-1.webp"),
      up("Juniper_fp.jpg"),
      up("Jasmine-Floor-Plan-Elevation-B.jpg"),
      "https://cdn.lennar.com/api/images/x/tpu_1551_fp_dover_mod1_ow_07_03_23.svg",
    ]);
    expect(got.views).toEqual([up("Jasmine-30-2413_Elevation-A-2-scaled-1.webp")]);
    expect(got.drawings).toEqual([
      up("Jasmine-2.jpg"),
      up("Juniper_fp.jpg"),
      up("Jasmine-Floor-Plan-Elevation-B.jpg"),
      "https://cdn.lennar.com/api/images/x/tpu_1551_fp_dover_mod1_ow_07_03_23.svg",
    ]);
  });
});

describe("planName: a plan's code without the word in front of it (Perry, 2026-09-23)", () => {
  it("drops Design before a numbered code, and leaves other names alone", () => {
    expect(planName("Design 3368F")).toBe("3368F");
    expect(planName("Plan 2016")).toBe("Plan 2016");
    expect(planName("3368F")).toBe("3368F");
    expect(planName("Plan B")).toBe("Plan B");
    expect(planName("The Design House")).toBe("The Design House");
    expect(planName("Model Home Aspen")).toBe("Model Home Aspen");
  });
});

describe("distill leaves out the site's menus and footer", () => {
  it("keeps the page's own words", () => {
    const html = `<nav><a href="/florida">Florida</a> Find a New Home</nav><main><h2>Daylen</h2> From $342,990</main><footer>© Pulte <a href="/privacy">Privacy</a></footer>`;
    expect(distill(html, "https://www.pulte.com/x")).toBe("Daylen From $342,990");
  });
});

describe("mergeRepeatedPlan (Perry's 3220F on two lot widths, 2026-09-23)", () => {
  const listing = (over: Partial<NormalizedPlan>): NormalizedPlan => ({
    planKey: "3220f",
    name: "3220F",
    price: 1_182_900,
    priceDisplay: "$1,182,900",
    beds: "4",
    baths: "4",
    sqft: 3220,
    garages: "3 car",
    homeType: "Single Family",
    quickMoveIn: false,
    comingSoon: false,
    sourceUrl: "https://www.perryhomes.com/x/star-farms-75/3220f",
    galleryImages: ["https://p.com/e1.jpg"],
    blueprintImages: ["https://p.com/fp.jpg"],
    ...over,
  });

  it("keeps one plan: the lower price, the larger baths, both listings' pictures, the first's page", () => {
    const merged = mergeRepeatedPlan(
      listing({}),
      listing({
        price: 1_412_900,
        priceDisplay: "$1,412,900",
        baths: "4.5",
        sourceUrl: "https://www.perryhomes.com/x/star-farms-90/3220f",
        galleryImages: ["https://p.com/e1.jpg", "https://p.com/e31.jpg"],
      })
    );
    expect(merged).toMatchObject({ price: 1_182_900, priceDisplay: "$1,182,900", baths: "4.5", beds: "4" });
    expect(merged.sourceUrl).toBe("https://www.perryhomes.com/x/star-farms-75/3220f");
    expect(merged.galleryImages).toEqual(["https://p.com/e1.jpg", "https://p.com/e31.jpg"]);
    expect(merged.blueprintImages).toEqual(["https://p.com/fp.jpg"]);
  });

  it("takes the other listing's price where the first has none", () => {
    const merged = mergeRepeatedPlan(listing({ price: null, priceDisplay: null }), listing({ price: 1_412_900, priceDisplay: "$1,412,900" }));
    expect(merged).toMatchObject({ price: 1_412_900, priceDisplay: "$1,412,900" });
  });
});

describe("sortDrawings: styles, colour schemes and folders of elevations (2026-09-23)", () => {
  it("moves renderings named for their style or scheme, or filed with the elevations, out of the drawings", () => {
    const df = "https://media.dreamfindershomes.com/371/2026/8/6/Regional-Arlington-Traditional-With-Bonus-3Car-Gen3.jpg?width=1000";
    const aw = "https://awh.widen.net/content/qho3z66qke/webp/cms_Griffin-U-Scheme-122.jpg_q9xGlGv.jpg?w=1000";
    const kb = "https://www.kbhome.com/globalassets/images/community-images/florida/tampa/30ft-kb-2020-series/elevations/1511_a_sch14.jpg";
    const plan = "https://www.kbhome.com/globalassets/images/community-images/florida/tampa/30ft-kb-2020-series/elevations/1511_fp.jpg";
    const towne = "https://d195jfz94fv5eb.cloudfront.net/uploads/floorplan/hbt-fl-shellstone-waterside-fp-mooring.jpg";
    const got = sortDrawings([df, aw, kb, plan, towne]);
    expect(got.views).toEqual([df, aw, kb]);
    expect(got.drawings).toEqual([plan, towne]);
  });
});

describe("homesPageIn (Kolter's Woodland Preserve, 2026-09-23)", () => {
  const PAGE = "https://www.kolterhomes.com/new-homes/parrish-florida-woodland-preserve/";
  it("finds the community's own page of homes for sale beneath its address", () => {
    const html = `<a href="/new-homes/parrish-florida-woodland-preserve/homes/">Homes</a>
      <a href="/new-homes/parrish-florida-woodland-preserve/move-in-ready/#top">Move-In Ready</a>`;
    expect(homesPageIn(html, PAGE)).toBe("https://www.kolterhomes.com/new-homes/parrish-florida-woodland-preserve/move-in-ready/");
  });

  it("does not take the builder's page of every home it has anywhere, or another site's", () => {
    const html = `<a href="https://nealcommunities.com/available-homes/">Quick Move-In Homes</a>
      <a href="https://other.com/new-homes/parrish-florida-woodland-preserve/move-in-ready/">x</a>
      <a href="/move-in-ready/">All homes</a>`;
    expect(homesPageIn(html, PAGE)).toBeNull();
  });
});

describe("distill keeps a menu that lists homes (Kolter's Woodland Preserve, 2026-09-23)", () => {
  it("drops the site's menus and footer, but not a nav that carries plans", () => {
    const html = `<nav><a href="/about">About</a><a href="/contact">Contact</a><a href="/new-homes/parrish-florida-woodland-preserve/">Woodland Preserve</a></nav>
      <nav class="floorplans"><a href="/floorplan/eva/">Eva</a> 4 Beds · 2 Baths · 1,668 Sq Ft · From $428,990</nav>
      <nav class="models"><a href="/new-homes/parrish-florida-woodland-preserve/5289/floorplan/jade/"><img src="/r/jade.jpg" alt="Jade">Jade</a></nav>
      <main><h1>Woodland Preserve</h1></main>
      <footer>© Kolter Homes · Privacy</footer>`;
    const text = distill(html, "https://www.kolterhomes.com/new-homes/parrish-florida-woodland-preserve/");
    expect(text).toContain("Eva");
    expect(text).toContain("$428,990");
    expect(text).toContain("floorplan/jade");
    expect(text).not.toContain("Contact");
    expect(text).not.toContain("Privacy");
  });
});

describe("distill leaves a carousel's joined pictures out (Pulte's Riversong, 2026-09-23)", () => {
  it("does not hand Claude a picture the page writes as two halves", () => {
    const slide = `<img alt="Kitchen" data-dam="//res.cloudinary.com/x/image/fetch/" data-name="https://pultegroup.picturepark.com/Go/a/V/1/13" data-transformations="c_fill,w_auto"><h5>Kitchen</h5>`;
    const text = distill(`<main><h1>Riversong</h1>${slide}<p>Daylen from $342,990</p></main>`, "https://www.pulte.com/homes/florida/tampa/parrish/riversong-211407");
    expect(text).not.toContain("picturepark");
    expect(text).toContain("$342,990");
  });
});

describe("drawingsOrPhotos", () => {
  const sd = (f: string) => `https://simplydwellhomes.com/wp-content/uploads/2026/06/${f}`;

  it("keeps a picture read both ways as the drawing, SimplyDwell's floor plan", () => {
    const got = drawingsOrPhotos([sd("Jasmine-2.jpg")], {
      urls: [sd("Jasmine-30-2413_Elevation-A.webp"), sd("Jasmine-2.jpg"), sd("Jasmine-30-2413_Elevation-B.webp")],
      meta: { [sd("Jasmine-30-2413_Elevation-A.webp")]: { kind: "primary" }, [sd("Jasmine-2.jpg")]: { caption: null, room: null } },
    });
    expect(got.blueprintImages).toEqual([sd("Jasmine-2.jpg")]);
    expect(got.galleryImages).toEqual([sd("Jasmine-30-2413_Elevation-A.webp"), sd("Jasmine-30-2413_Elevation-B.webp")]);
    expect(got.galleryMeta[sd("Jasmine-2.jpg")]).toBeUndefined();
  });

  it("keeps the plan's main picture a photo, whatever format the drawing names it in (Richmond's Palm)", () => {
    const main = "https://www.richmondamerican.com/content/plans/media-61025.jpg";
    const got = drawingsOrPhotos(["https://www.richmondamerican.com/content/plans/media-61025.webp"], { urls: [main], meta: {} });
    expect(got).toMatchObject({ blueprintImages: [], galleryImages: [main] });
  });

  it("keeps each drawing once however it is spelled, the first spelling (Neal's Fresh Spring, 2026-09-24)", () => {
    const at = (host: string) =>
      `https://${host}/wp-content/uploads/2018/08/14134322/new-home-construction-englewood-florida-boca-royale-fresh-spring-floorplan.jpg`;
    const first = `${at("images.nealcommunities.com")}?auto=format%2Ccompress`;
    const other = "https://images.nealcommunities.com/wp-content/uploads/2018/08/14134322/fresh-spring-options.jpg";
    const got = drawingsOrPhotos([first, at("img.nealcommunities.com"), at("images.nealcommunities.com"), other], {
      urls: ["https://x.com/front.jpg"],
      meta: {},
    });
    expect(got.blueprintImages).toEqual([first, other]);
  });

  it("keeps a photo whose caption names a room", () => {
    const kitchen = "https://www.richmondamerican.com/content/pln/media-267142.webp";
    const got = drawingsOrPhotos([kitchen], {
      urls: ["https://x.com/front.jpg", kitchen],
      meta: { [kitchen]: { caption: "Kitchen of the Sage floor plan", room: "kitchen", kind: "photo" } },
    });
    expect(got).toMatchObject({ blueprintImages: [], galleryImages: ["https://x.com/front.jpg", kitchen] });
  });
});

describe("drawingsNotShownAsPhotos", () => {
  const df = (f: string) => `https://media.dreamfindershomes.com/371/2024/3/17/${f}`;
  const gallery = [
    df("Bunaglow_Walk-Pearl-A-Gen3.jpg?width=1000&height=625&fit=bounds"),
    df("Bunaglow_Walk-Pearl-B-Gen3_7DZ3lS9.jpg?width=1000&height=625&fit=bounds"),
  ];

  it("does not take an elevation in the page's gallery for a drawing on Claude's word (Dream Finders' Pearl)", () => {
    expect(drawingsNotShownAsPhotos([df("Bunaglow_Walk-Pearl-B-Gen3_7DZ3lS9.jpg?width=400")], gallery)).toEqual([]);
  });

  it("keeps a picture in the gallery that is named for a plan", () => {
    const fp = df("Pearl-FP.jpg");
    expect(drawingsNotShownAsPhotos([fp], [...gallery, fp])).toEqual([fp]);
  });

  it("keeps a drawing in the gallery that is drawn, not photographed (Medallion's Belize.svg)", () => {
    const svg = "https://medallionhome.com/wp-content/uploads/2026/04/Belize.svg";
    expect(drawingsNotShownAsPhotos([svg], ["https://medallionhome.com/wp-content/uploads/2026/04/ra_belize-plan-_a_01-800x534.jpg", svg])).toEqual([svg]);
  });

  it("keeps a drawing the gallery does not show", () => {
    const drawing = df("8450ec42-69b4-4cc4-b36f-30abf9fd6c03.jpg");
    expect(drawingsNotShownAsPhotos([drawing], gallery)).toEqual([drawing]);
  });
});

describe("keptFromPage (Ashton Woods' Duval, 2026-09-29)", () => {
  // A photo gallery, then an elevations gallery: the second is a later
  // gallery, whose pictures are dropped, but its elevations are the house.
  const w = (file: string) => `https://awh.widen.net/content/${file}`;
  const html =
    `<h2>Gallery</h2><h3>Photos</h3>` +
    `<img src="${w("igba1tibxn/jpeg/TAM_OTR50_Duval_ELEV_Dusk_1.jpg")}" alt="Duval"><img src="${w("ujmba0cs37/jpeg/TAM_OTR50_Duval_KITCH_1.jpg")}" alt="Kitchen">` +
    `<h3>Elevations</h3>` +
    `<img src="${w("aaa/webp/cms_Duval-P-Scheme-110.jpg")}" alt="Elevation P"><img src="${w("bbb/webp/cms_Duval-Q-Scheme-111.jpg")}" alt="Elevation Q"><img src="${w("ccc/webp/cms_Duval-R-Scheme-112.jpg")}" alt="Elevation R">` +
    `<h2>Virtual Tours</h2><img src="${w("ddd/jpeg/tour-still.jpg")}" alt="Tour">`;
  const page = "https://www.ashtonwoods.com/tampa/oakfield-trails-traditional/duval";

  it("keeps the elevations a later gallery holds", () => {
    const { drop } = firstGallery(html, page);
    const outsides = elevationPictures(html, page);
    expect(outsides.map((o) => o.src)).toHaveLength(3);
    for (const o of outsides) {
      expect(drop.has(o.src)).toBe(true);
      expect(keptFromPage(o.src, drop, outsides)).toBe(true);
    }
  });

  it("still drops a tour's still", () => {
    const { drop } = firstGallery(html, page);
    expect(keptFromPage(w("ddd/jpeg/tour-still.jpg"), drop, elevationPictures(html, page))).toBe(false);
  });
});

describe("distill leaves out a builder's social feed (Neal, 2026-09-30)", () => {
  const base = "https://nealcommunities.com/new-homes/windward/";

  it("drops the whole Instagram widget, nested tags and a post naming a price included, and keeps the page's words", () => {
    const feed = `<div id="sb_instagram" class="sbi sbi_col_10"><div class="sb_instagram_header"><p>The official Instagram for Neal Communities</p></div><div id="sbi_images"><div class="sbi_item"><div class="sbi_photo_wrap"><img src="/wp-content/uploads/sb-instagram-feed-images/post1full.jpg"><span class="sbi-screenreader">Ready now: the Dream 2 priced from $498,990</span></div></div></div></div>`;
    const html = `<main><h1>Tidewater 2</h1><p>Priced at $429,990 · 2 beds · 1,530 sq ft</p><img src="/photos/tidewater-kitchen.jpg">${feed}<p>Expected completion October 2026</p></main>`;
    const text = distill(html, base);
    expect(text).toContain("Tidewater 2");
    expect(text).toContain("$429,990");
    expect(text).toContain("[IMG https://nealcommunities.com/photos/tidewater-kitchen.jpg]");
    expect(text).toContain("Expected completion October 2026");
    expect(text).not.toContain("Instagram");
    expect(text).not.toContain("sb-instagram-feed-images");
    expect(text).not.toContain("$498,990");
  });

  it("knows the other widgets by their names, and reads the same page without one exactly as before", () => {
    const words = `<h1>Lori</h1><p>From $459,990</p>`;
    const elfsight = `<div class="elfsight-app-1a2b3c4d-5e6f"><div><p>Follow us: new post about $1</p></div></div>`;
    expect(distill(`<main>${words}${elfsight}</main>`, base)).toBe(distill(`<main>${words}</main>`, base));
    expect(distill(`<main>${words}</main>`, base)).toBe("Lori From $459,990");
  });

  it("leaves a widget that never closes as it is, rather than losing the rest of the page", () => {
    const html = `<main><div class="sbi"><p>feed</p><h1>Lori</h1><p>From $459,990</p></main>`;
    const text = distill(html, base);
    expect(text).toContain("Lori");
    expect(text).toContain("$459,990");
  });
});

describe("distill leaves out a form's honeypot field (Neal and Medallion, 2026-09-30)", () => {
  const base = "https://nealcommunities.com/new-homes/windward/";
  const page = (label: string) =>
    `<main><h1>Applause</h1><p>Priced from $573,990</p><form><div class="gform_fields"><div id="field_1_20" class="gfield gfield--type-honeypot gform_validation_container gfield_visibility_visible"><label class="gfield_label"><span>${label}</span></label><div class="ginput_container"><input name="input_20" type="text"></div><div class="gfield_description">This field is for validation purposes and should be left unchanged.</div></div><div class="gfield gfield--type-text"><label>First name *</label><input type="text"></div></div></form></main>`;

  it("reads the same page the same whatever label the honeypot drew, and keeps the form's real fields", () => {
    const text = distill(page("Facebook"), base);
    expect(text).toBe(distill(page("Instagram"), base));
    expect(text).toBe(distill(page("Comments"), base));
    expect(text).toContain("Applause");
    expect(text).toContain("$573,990");
    expect(text).toContain("First name *");
    expect(text).not.toContain("validation purposes");
    expect(text).not.toContain("Facebook");
  });
});

describe("distill leaves out tracking pixels (Kolter, 2026-09-30)", () => {
  const base = "https://www.kolterhomes.com/new-homes/parrish-florida-woodland-preserve/";

  it("gives a zero- or one-pixel picture no marker, and keeps a real picture and a one-pixel placeholder with its picture in data-src", () => {
    const html = [
      `<img src="https://trkn.us/pixel/conv/ppt=24105;g=sitewide;ord=5f982470-cc46-a4ea-62c25b139ec5dc80" alt="" height="0" width="0" border="0">`,
      `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1" alt="facebook pixel"/>`,
      `<img src="https://cdn.kolterhomes.com/morgan-kitchen.jpg" alt="Kitchen">`,
      `<img src="/1x1.gif" width="1" height="1" data-src="https://cdn.kolterhomes.com/morgan-great-room.jpg">`,
      `<p>Morgan · $579,990</p>`,
    ].join("");
    const text = distill(html, base);
    expect(text).not.toContain("trkn.us");
    expect(text).not.toContain("facebook.com");
    expect(text).toContain("[IMG https://cdn.kolterhomes.com/morgan-kitchen.jpg]");
    expect(text).toContain("[IMG https://cdn.kolterhomes.com/morgan-great-room.jpg]");
    expect(text).toContain("Morgan · $579,990");
  });
});

describe("statedPrice", () => {
  // Homes by Towne's Shellstone plan pages, as distilled (2026-10-02).
  const galley = "Shellstone at Waterside Galley 1,692 SF Base Price: $ High $400s Overview";
  const banyan = "Shellstone at Waterside Banyan 1,747 SF Base Price: $ Low $500s Overview";

  it("takes no price where the page gives only a bracket", () => {
    expect(statedPrice(400000, galley)).toBeNull();
    expect(statedPrice(500000, banyan)).toBeNull();
    expect(statedPrice(450000, "Priced from the mid $400Ks")).toBeNull();
    expect(statedPrice(1200000, "From the $1.2Ms")).toBeNull();
  });

  it("keeps a price the page writes out, round or not", () => {
    expect(statedPrice(574900, "Regatta Base Price: $574,900")).toBe(574900);
    expect(statedPrice(4200000, "The Abaco Homes From $4,200,000")).toBe(4200000);
    expect(statedPrice(400000, "Galley $400,000 — homes in the $400s")).toBe(400000);
    // A round price with no bracket beside it is the page's.
    expect(statedPrice(350000, "7729 Satterfield Ter")).toBe(350000);
  });

  it("takes none for no price", () => {
    expect(statedPrice(undefined, galley)).toBeNull();
    expect(statedPrice(0, galley)).toBeNull();
  });
});

describe("withTotalPrices (Starlight's Oakfield Lakes, 2026-10-06)", () => {
  // The plan page as Starlight serves it: the payment shown, the price kept in data-total-price.
  const toolbar =
    '<div class="toolbar__subheading" data-price="2401" data-monthly-price="2401" data-total-price="381240">Own your new home from ' +
    '<b>$<span class="js-price-toggle__price-value">2401</span><span class="js-price-toggle__price-suffix">/month*</span></b></div>';
  const aside =
    '<div class="price__main" data-price="2401" data-monthly-price="2401" data-total-price="381240"><h2>' +
    '<span class="price__prefix">Starting at</span><span class="price__sign">$</span>' +
    '<span class="price__amount js-price-toggle__price-value">2401</span><span class="price__suffix js-price-toggle__price-suffix">/month*</span>' +
    "</h2></div>";

  it("shows the whole price in place of the monthly payment", () => {
    const text = distill(`<main>${toolbar}${aside}<p>Four bedrooms.</p></main>`, "https://www.starlighthomes.com/tampa/oakfield-lakes/europa");
    expect(text).toMatch(/Own your new home from \$\s?381,240/);
    expect(text).toMatch(/Starting at \$\s?381,240/);
    expect(text).not.toMatch(/2401|month/);
    expect(statedPrice(381240, text)).toBe(381240);
  });

  it("gives the total to a block with no figure to put it in", () => {
    expect(distill('<div data-total-price="381240"><span>Starting at</span></div>', "https://x.test/")).toContain("$381,240");
  });

  it("leaves a page without a total price as it is", () => {
    const html = '<div class="price"><span class="js-price-toggle__price-value">$403,990</span></div><p>x</p>';
    expect(withTotalPrices(html)).toBe(html);
    const unpriced = '<div data-total-price="0"><span class="js-price-toggle__price-value">Call</span></div>';
    expect(withTotalPrices(unpriced)).toBe(unpriced);
  });

  it("leaves what follows the block as it is", () => {
    const got = withTotalPrices(`${toolbar}<div data-price="9"><span class="js-price-toggle__price-value">9</span></div>`);
    expect(got).toContain('<div data-price="9"><span class="js-price-toggle__price-value">9</span></div>');
  });
});

describe("statedSqft (David Weekley's North River Ranch and Neal Signature's Waterbury Park, 2026-10-07)", () => {
  const list =
    "North River Ranch – Garden Series From the $419s Sq Ft 1953-2740 Amenity Highlights " +
    "The Bradson From: $469,990 | Sq. Ft: 2719 - 2740 Stories 2 Bedrooms 4 " +
    "The Benton From: $419,990 | Sq. Ft: 1953 - 1963 Stories 1 Bedrooms 3 " +
    "The Benton 11808 Full Moon Loop, Parrish, FL 34219 $491,550 | Sq. Ft: 1953 Story 1";

  it("gives the larger end of the range the plan's name heads", () => {
    expect(statedSqft(2719, list, "The Bradson")).toBe(2740);
    expect(statedSqft(1953, list, "The Benton")).toBe(1963);
    expect(statedSqft(2719, "The Bradson From $469,990 Sq Ft 2,719 – 2,740", "The Bradson")).toBe(2740);
  });

  it("leaves a size under a community's span of all its plans (Waterbury Park's Palm Bay 2)", () => {
    const waterbury =
      "Lakewood Ranch, FL Waterbury Park 3,138 – 4,189 Sq. Ft. Neal Signature Homes invites you " +
      "Palm Bay 2 3 Bed 3 Bath 3 Car 3,138 Sq. Ft. Starting From $1,399,990 " +
      "Monterey 2 4 Bed 5+ Bath 3 Car 4,189 Sq. Ft. Starting From $1,632,990";
    expect(statedSqft(3138, waterbury, "Palm Bay 2")).toBe(3138);
    expect(statedSqft(3138, waterbury, "Waterbury Park")).toBe(4189);
  });

  it("leaves a figure that is the top of its range, or in none, or with no name to go by, as it is", () => {
    expect(statedSqft(2740, list, "The Bradson")).toBe(2740);
    expect(statedSqft(2310, "The Allex 2,310 Sq. Ft.", "The Allex")).toBe(2310);
    expect(statedSqft(2719, list, null)).toBe(2719);
    expect(statedSqft(null, list, "The Bradson")).toBeNull();
    expect(statedSqft(0, list, "The Bradson")).toBeNull();
  });

  it("does not take a sentence about the community for the plan's range (Medallion's The Willows)", () => {
    const willows =
      "The Willows offers five plans: Harbour, Nevis, Grenada 2, Bermuda and St. Thomas. Configurations range from 1,524 to 2,327 square feet " +
      "Harbour Single Family Home Starting from $486,100 3 Beds 2 Baths 1,524 Sq. Ft. 2 Car Garage";
    expect(statedSqft(1524, willows, "Harbour")).toBe(1524);
  });

  it("does not take the next card's range for the name's", () => {
    const cards = "The Allex From: $389,990 | Sq. Ft: 2140 Stories 1 Bedrooms 3 Full Baths 2 Car Garage 2 Share Compare Plan F030 The Bryce From: $399,990 | Sq. Ft: 2140 - 2210";
    expect(statedSqft(2140, cards, "The Allex")).toBe(2140);
  });
});

describe("livingSqft (Kolter's Woodland Preserve, 2026-10-07)", () => {
  const rachel =
    "Rachel 3 Bedroom (up to 5 Bedroom), Flex Room, 3 Full and 1 Half Bath, Great Room, 2-Car Garage 2,586 Living Area Sq. Ft. " +
    "Garage 2 Living Area Sq. Ft. 2,586 3,405 Total Sq. Ft. Structural Options 37 " +
    "14443 Coastal Woodland Lane Rachel | Harrison Collection Homesite 111 3,405 Total Sq. Ft. 2,586 Living Area Sq. Ft. Move-In: Immediate";

  it("gives the living area where a reading took the total beside it", () => {
    expect(livingSqft(3405, rachel)).toBe(2586);
    expect(livingSqft(3405, "Living Area Sq. Ft. 2,586 3,405 Total Sq. Ft.")).toBe(2586);
    expect(livingSqft(3405, "3,405 Total Sq. Ft. 2,586 Living Area Sq. Ft.")).toBe(2586);
  });

  it("leaves a living area, and a total with no living area beside it, as they are", () => {
    expect(livingSqft(2586, rachel)).toBe(2586);
    expect(livingSqft(3405, "3,405 Total Sq. Ft. Move-In: Immediate")).toBe(3405);
    expect(livingSqft(1638, "1,638 Sq Ft")).toBe(1638);
    expect(livingSqft(null, rachel)).toBeNull();
  });
});
