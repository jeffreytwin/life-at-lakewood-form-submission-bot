import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ledByHome, normalizeMattamyCard, plansFromSearchData, readPlanLayout, tourAddress } from "@/lib/floorplans/extractors/mattamy";
import { standardHomeType } from "@/lib/floorplans/standardize";

// Real /search-data layout-service payload captured in round-7 discovery
// (pruned: arrays capped at 5, long strings truncated).
const capture = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../fixtures/floorplans/mattamy-search-data.pruned.json"
    ),
    "utf8"
  )
);

describe("plansFromSearchData (Mattamy)", () => {
  it("scopes cards by community page path prefix", () => {
    // Avila plan cards live at /florida/palm-city-stuart/jensen-beach/avila/…
    const plans = plansFromSearchData(capture.data, "/florida/palm-city-stuart/jensen-beach/avila");
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(p.sourceUrl).toContain("/avila/");
    const oceana = plans.find((p) => p.planKey === "oceana")!;
    expect(oceana.price).toBe(506990);
    expect(oceana.priceDisplay).toBe("$506,990");
    expect(oceana.beds).toBe("3");
    expect(oceana.baths).toBe("2.5");
    expect(oceana.sqft).toBe(2351);
    expect(oceana.garages).toBe("2 car");
    expect(oceana.quickMoveIn).toBe(false);
  });

  it("maps QMI cards with address names and related plans", () => {
    const plans = plansFromSearchData(capture.data, "/florida/tampa/palmetto/sanderling");
    const qmis = plans.filter((p) => p.quickMoveIn);
    expect(qmis.length).toBeGreaterThan(0);
    const soaring = qmis.find((p) => p.name === "1758 Soaring Vida St")!;
    expect(soaring.price).toBe(389878);
    expect(soaring.raw?.relatedPlan).toBe("Woodruff");
  });

  it("returns null for cards without a title", () => {
    expect(normalizeMattamyCard({}, { quickMoveIn: false })).toBeNull();
  });
});

describe("a community whose market was renamed in its address (Sunstone, 2026-09-23)", () => {
  it("still matches its cards by the last two parts of the address", () => {
    const renamed = plansFromSearchData(capture.data, "/florida/some-old-market-name/jensen-beach/avila");
    const current = plansFromSearchData(capture.data, "/florida/palm-city-stuart/jensen-beach/avila");
    expect(renamed.length).toBeGreaterThan(0);
    expect(renamed.map((p) => p.planKey)).toEqual(current.map((p) => p.planKey));
  });
});

describe("readPlanLayout (Mattamy plan pages, Anclote at Sunstone, 2026-09-23)", () => {
  // Shaped like the layout service's answer for a plan page, pruned.
  const layout = {
    sitecore: {
      route: {
        fields: {
          "Product Line": { displayName: "Attached Villa" },
          "Home Type": { displayName: "Villa", fields: { homeType: { value: "Villa" } } },
        },
        placeholders: {
          main: [
            {
              componentName: "TitleDetailsBlock",
              fields: { image: { value: { src: "https://cdn.mattamy.com/anclote-hero.jpg", alt: "Anclote" } } },
            },
            {
              componentName: "Container",
              placeholders: {
                inner: [
                  {
                    componentName: "ExtendedGallery",
                    fields: {
                      media: {
                        value: [
                          { type: "image", src: "https://cdn.mattamy.com/a1.jpg", alt: "Dining" },
                          { type: "image", src: "https://cdn.mattamy.com/a2.jpg", alt: "Kitchen" },
                          { type: "image", src: "https://cdn.mattamy.com/owners-bath.jpg", alt: "" },
                        ],
                      },
                    },
                  },
                  {
                    componentName: "StaticCarousel",
                    fields: { media: { value: [{ type: "floorplan", src: "https://cdn.mattamy.com/anclote-fp.png" }] } },
                  },
                  {
                    componentName: "MediaGallery",
                    fields: {
                      media: {
                        value: [
                          {
                            type: "tour",
                            src: "<iframe title='' style='min-height: 500px; width: 100%;' src='https://my.matterport.com/show/?m=of1T1UYQHiB' frameborder='0'></iframe>",
                            thumbnail: "https://cdn.mattamy.com/Image-Coming-Soon.png",
                          },
                          { type: "external", src: "https://vimeo.com/1071164024?share=copy" },
                        ],
                      },
                    },
                  },
                  {
                    componentName: "ExteriorStyles",
                    fields: {
                      styles: {
                        value: [
                          { imageUrl: "https://cdn.mattamy.com/anclote-a.jpg", imageCaption: "Coastal" },
                          { imageUrl: "https://cdn.mattamy.com/anclote-b.jpg", imageCaption: "Craftsman" },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  };

  it("leads with the hero, sorts the gallery by the rooms Mattamy names, and puts the styles last", () => {
    const page = readPlanLayout(layout);
    expect(page.photos).toEqual([
      "https://cdn.mattamy.com/anclote-hero.jpg",
      "https://cdn.mattamy.com/a2.jpg",
      "https://cdn.mattamy.com/a1.jpg",
      "https://cdn.mattamy.com/owners-bath.jpg",
      "https://cdn.mattamy.com/anclote-a.jpg",
      "https://cdn.mattamy.com/anclote-b.jpg",
    ]);
    expect(page.meta["https://cdn.mattamy.com/a2.jpg"].room).toBe("kitchen");
    expect(page.meta["https://cdn.mattamy.com/owners-bath.jpg"].room).toBe("bathroom");
    expect(page.meta["https://cdn.mattamy.com/anclote-b.jpg"]).toMatchObject({ kind: "exterior", caption: "Craftsman" });
  });

  it("keeps a style's rendering a style where the gallery shows it too (11898 Mandala Ct, 2026-09-25)", () => {
    const shown = JSON.parse(JSON.stringify(layout).replace('"alt":"Kitchen"}', '"alt":"Kitchen"},{"type":"image","src":"https://cdn.mattamy.com/anclote-b.jpg","alt":"TPA_Sunstone_Villa_Anclote_Topsail_Craftsman","description":"Exterior"}'));
    const page = readPlanLayout(shown);
    expect(page.meta["https://cdn.mattamy.com/anclote-b.jpg"]).toMatchObject({ kind: "exterior" });
    expect(page.photos.filter((u) => u === "https://cdn.mattamy.com/anclote-b.jpg")).toHaveLength(1);
  });

  it("takes the floor plan drawing apart from the photos", () => {
    expect(readPlanLayout(layout).drawings).toEqual(["https://cdn.mattamy.com/anclote-fp.png"]);
  });

  it("reads the Matterport a tour item embeds as the virtual tour, and not the video (Carmel II, 2026-09-24)", () => {
    const page = readPlanLayout(layout);
    expect(page.tour).toBe("https://my.matterport.com/show/?m=of1T1UYQHiB");
    // Neither the tour's placeholder picture nor the video joins the photos.
    expect(page.photos.some((u) => /Image-Coming-Soon|vimeo/.test(u))).toBe(false);
  });

  it("reads a tour's address from its iframe or as given, and nothing else", () => {
    expect(tourAddress("<iframe src=\"https://my.matterport.com/show/?m=abc&amp;play=1\"></iframe>")).toBe("https://my.matterport.com/show/?m=abc&play=1");
    expect(tourAddress("https://my.matterport.com/show/?m=abc")).toBe("https://my.matterport.com/show/?m=abc");
    expect(tourAddress("<iframe></iframe>")).toBeNull();
    expect(tourAddress(null)).toBeNull();
  });

  it("reads the product line as the home type", () => {
    expect(readPlanLayout(layout).homeType).toBe(standardHomeType("Attached Villa"));
    expect(readPlanLayout(layout).homeType).not.toBeNull();
  });

  it("files a picture under the room Mattamy names in its description before its prose", () => {
    // Isle Royal (2026-09-23): eighteen alts saying only where the model is.
    const isleRoyal = {
      sitecore: {
        route: {
          placeholders: {
            main: [
              {
                componentName: "ExtendedGallery",
                fields: {
                  media: {
                    value: [
                      { type: "image", src: "https://cdn.mattamy.com/ir-1", alt: "Model photos Lakeside in Sunstone Isle Royal", description: "Kitchen" },
                      { type: "image", src: "https://cdn.mattamy.com/ir-2", alt: "Model photos Lakeside in Sunstone Isle Royal", description: "" },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    };
    const page = readPlanLayout(isleRoyal);
    expect(page.meta["https://cdn.mattamy.com/ir-1"]).toMatchObject({ room: "kitchen", caption: "Model photos Lakeside in Sunstone Isle Royal" });
    expect(page.meta["https://cdn.mattamy.com/ir-2"].room ?? null).toBeNull();
  });

  it("gives nothing for a layout it cannot read", () => {
    expect(readPlanLayout(null)).toMatchObject({ photos: [], drawings: [], homeType: null });
  });
});

describe("a Mattamy home's pictures lead with the house itself (11898 Mandala Ct, Jeff, 2026-09-25)", () => {
  const cdn = (name: string) => `https://prodmh.b-cdn.net//dfsmedia/a2/${name}`;
  const porch = cdn("42164-50420/tpa-sunstone-anclote-ownersentry-jpg");
  const kitchen = cdn("42159-50420/tpa-sunstone-anclote-kitchen1-jpg");
  const home = cdn("42142-50420/tpa-sunstone-villa-anclote-topsail-craftsman-jpg");
  const meta = {
    [porch]: { kind: "primary" as const, room: "primary" as const, caption: "Front Porch" },
    [kitchen]: { kind: "photo" as const, room: "kitchen" as const, caption: "Kitchen" },
    [home]: { kind: "exterior" as const, room: "exterior" as const, caption: "Topsail Craftsman" },
  };

  it("leads with the home's one exterior style, and puts the model's porch back among the photos", () => {
    // The card shows the model's porch too.
    const led = ledByHome(porch, [porch, kitchen, home], meta);
    expect(led.photos).toEqual([home, porch, kitchen]);
    expect(led.meta[home]).toMatchObject({ kind: "primary", room: "primary", caption: "Topsail Craftsman" });
    expect(led.meta[porch]).toMatchObject({ kind: "photo", room: null, caption: "Front Porch" });
  });

  it("leaves the card's picture to lead where the page names several styles, or none", () => {
    const other = cdn("42143-50420/tpa-sunstone-villa-anclote-topsail-coastal-jpg");
    const both = { ...meta, [other]: { kind: "exterior" as const, room: "exterior" as const, caption: "Coastal" } };
    expect(ledByHome(porch, [porch, kitchen, home, other], both).photos[0]).toBe(porch);
    expect(ledByHome(cdn("card.jpg"), [porch, kitchen], meta).photos).toEqual([cdn("card.jpg"), porch, kitchen]);
    expect(ledByHome(undefined, [porch, kitchen], meta).photos).toEqual([porch, kitchen]);
  });
});
