import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { plansFromSearchData, normalizeMattamyCard, readPlanLayout } from "@/lib/floorplans/extractors/mattamy";
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

  it("takes the floor plan drawing apart from the photos", () => {
    expect(readPlanLayout(layout).drawings).toEqual(["https://cdn.mattamy.com/anclote-fp.png"]);
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
