import { describe, it, expect } from "vitest";
import {
  asList,
  distinctKey,
  isTourUrl,
  orderPhotos,
  tourLinkIn,
  tourUrlIn,
  withoutBlanks,
  pictureAddresses,
  distill,
  EXTRACT_TOOL,
  EXTRACT_TOOL_STRICT,
} from "@/lib/floorplans/extractors/claude-extract";
import type { NormalizedPlan } from "@/lib/floorplans/types";

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
