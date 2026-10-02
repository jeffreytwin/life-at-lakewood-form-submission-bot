import { describe, expect, it } from "vitest";
import { goneModels, isGone, matterportModel, withoutDeadTours } from "@/lib/floorplans/dead-tours";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const p = (name: string, virtualTourUrl: string | null): NormalizedPlan => ({
  planKey: name.toLowerCase(), name, price: null, priceDisplay: null, beds: "", baths: "", sqft: null, garages: null,
  homeType: null, quickMoveIn: false, comingSoon: false, sourceUrl: null, galleryImages: [], blueprintImages: [], virtualTourUrl,
});

// Matterport's answers (2026-10-02): Lennar's Richmond is gone, Ashton Woods' Plant is not.
const GONE = { errors: [{ message: "Not Found", extensions: { code: "not.found", httpCode: 404 } }], data: { model: null } };
const LIVE = { data: { model: { state: "active", visibility: "public", name: "Plant" } } };

describe("dead tours (Jeff, 2026-10-02)", () => {
  it("reads the model a tour shows, however the link is written", () => {
    expect(matterportModel("https://my.matterport.com/show/?m=21MTfZNyNTn")).toBe("21MTfZNyNTn");
    expect(matterportModel("https://my.matterport.com/show/?m=VeHUNNA562F&brand=0&mls=1&")).toBe("VeHUNNA562F");
    expect(matterportModel("https://my.matterport.com/show/?play=1&m=PGRgMuog2b1")).toBe("PGRgMuog2b1");
    expect(matterportModel("https://www.zillow.com/view-imx/47b84908")).toBeNull();
  });

  it("calls a model gone only when Matterport says so", () => {
    expect(isGone(GONE)).toBe(true);
    expect(isGone(LIVE)).toBe(false);
    expect(isGone({ errors: [{ extensions: { code: "internal" } }], data: { model: null } })).toBe(false);
    expect(isGone(null)).toBe(false);
  });

  it("asks once per model, and a question that fails keeps the tour", async () => {
    const asked: string[] = [];
    const fetcher = (async (_url: string, init: { body: string }) => {
      const id = (JSON.parse(init.body).query as string).match(/id: "([A-Za-z0-9]+)"/)![1];
      asked.push(id);
      if (id === "brokenNetwk") throw new Error("socket hang up");
      return { json: async () => (id === "21MTfZNyNTn" ? GONE : LIVE) };
    }) as unknown as typeof fetch;
    const plans = [
      p("The Richmond", "https://my.matterport.com/show/?m=21MTfZNyNTn"),
      p("Richmond", "https://my.matterport.com/show/?m=21MTfZNyNTn&play=1"),
      p("Plant", "https://my.matterport.com/show/?m=N1ZYSGXAVVS"),
      p("Unknown", "https://my.matterport.com/show/?m=brokenNetwk"),
      p("Zillow", "https://www.zillow.com/view-imx/47b84908"),
    ];
    const gone = await goneModels(plans, fetcher);
    expect(asked.sort()).toEqual(["21MTfZNyNTn", "N1ZYSGXAVVS", "brokenNetwk"]);
    expect([...gone]).toEqual(["21MTfZNyNTn"]);
    const out = withoutDeadTours(plans, gone);
    expect(out[0]).toMatchObject({ virtualTourUrl: null, virtualTourImage: null, tourStated: true });
    expect(out[1]).toMatchObject({ virtualTourUrl: null, tourStated: true });
    expect(out.slice(2).map((x) => x.virtualTourUrl)).toEqual(plans.slice(2).map((x) => x.virtualTourUrl));
  });
});
