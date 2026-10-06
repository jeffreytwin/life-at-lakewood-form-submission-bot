import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cardsIn, communityGuidIn, fromCard, isMiHomesPage } from "@/lib/floorplans/extractors/mi-homes";
import { extractorFor, resolveExtractor } from "@/lib/floorplans/sync";

// M/I's plan feed for Seaire as it answered (2026-10-06), pruned to the
// first two plans, the first two homes and the model.
const feed = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../fixtures/floorplans/mihomes-seaire-feed.pruned.json"), "utf8")
) as Record<"plans" | "homes" | "models", { TotalItems: number; Html: string }>;

const ORIGIN = "https://www.mihomes.com";
const SEAIRE = `${ORIGIN}/new-homes/florida/sarasota-metro/parrish/seaire`;

describe("communityGuidIn", () => {
  it("reads the id the community page keeps for the feed", () => {
    expect(
      communityGuidIn(`<div data-subnav-page-link-group="" id="pqmb" data-guid="25849bbc-5cd8-4640-907c-2217abf56049" data-name="Seaire">`)
    ).toBe("25849bbc-5cd8-4640-907c-2217abf56049");
  });

  it("falls back to the id the load-more script asks the feed with", () => {
    expect(
      communityGuidIn(`items = $this.data('itemcount'),\n id = '%7B4D4287D0-A457-460F-9C0C-7EEFC7A89695%7D';`)
    ).toBe("4d4287d0-a457-460f-9c0c-7eefc7a89695");
    expect(communityGuidIn("<html><body>no feed here</body></html>")).toBeNull();
  });
});

describe("isMiHomesPage", () => {
  it("tells M/I's own pages from a master-planned community's listings", () => {
    expect(isMiHomesPage(SEAIRE)).toBe(true);
    expect(isMiHomesPage("https://mihomes.com/new-homes/florida/x")).toBe(true);
    expect(isMiHomesPage("https://www.wellenpark.com/homes/")).toBe(false);
    expect(isMiHomesPage(undefined)).toBe(false);
  });
});

describe("cardsIn", () => {
  it("reads each card's data, facts and flags", () => {
    const plans = cardsIn(feed.plans.Html);
    expect(plans.map((c) => c.kind)).toEqual(["plans", "plans"]);
    expect(plans[0].data.name).toBe("Coral");
    expect(plans[0].meta.Garage).toBe("3");
    const homes = cardsIn(feed.homes.Html);
    expect(homes.map((c) => c.kind)).toEqual(["inventory", "inventory"]);
    expect(homes[0].meta.Plan).toBe("Coral Xl - B");
    expect(homes[0].meta["Estimated Move in Date"]).toBe("Ready Now");
    expect(homes[0].flags).toEqual(["Ready Now"]);
    expect(cardsIn(feed.models.Html).map((c) => c.kind)).toEqual(["models"]);
  });
});

describe("fromCard", () => {
  const [coral] = cardsIn(feed.plans.Html).map((c) => fromCard(c, ORIGIN)!);

  it("takes a plan with its ranges, its starting price and its page", () => {
    expect(coral).toMatchObject({
      planKey: "coral",
      name: "Coral",
      price: 554999,
      priceDisplay: "$554,999",
      beds: "3-5",
      baths: "3-4",
      sqft: 2306,
      garages: "3 car",
      homeType: "Single Family Home",
      quickMoveIn: false,
      comingSoon: false,
      sourceUrl: `${SEAIRE}/coral-plan`,
    });
    expect(coral.galleryImages).toEqual(["https://dam.mihomes.com/media/4253402/50421.jpeg"]);
  });

  it("takes a home by its street, tied to the plan its page sits under", () => {
    const plansByPage = new Map([[`${SEAIRE}/coral-xl-plan`, "Coral XL"]]);
    const home = fromCard(cardsIn(feed.homes.Html)[0], ORIGIN, plansByPage)!;
    expect(home).toMatchObject({
      planKey: "8928-deep-horizon-loop",
      name: "8928 Deep Horizon Loop",
      price: 839999,
      beds: "4",
      baths: "4",
      sqft: 3746,
      garages: "3 car",
      quickMoveIn: true,
      sourceUrl: `${SEAIRE}/coral-xl-plan/8928-deep-horizon-loop`,
      relatedPlanName: "Coral XL",
    });
    expect(home.raw).toMatchObject({ relatedPlan: "Coral XL", readyDate: "Ready Now" });
  });

  it("names a home's plan from its page's address when the run has no card for the plan", () => {
    const home = fromCard(cardsIn(feed.homes.Html)[1], ORIGIN)!;
    expect(home.relatedPlanName).toBe("Gulf Stream Xl");
  });

  it("leaves out the model, which M/I shows but does not sell", () => {
    expect(fromCard(cardsIn(feed.models.Html)[0], ORIGIN)).toBeNull();
  });
});

describe("M/I's engine", () => {
  it("reads a community on M/I's own pages from its feed, and Palmera from Wellen Park's listings", () => {
    const mi = resolveExtractor("M/I Homes", "json_api");
    expect(mi).not.toBeNull();
    // A connection that names an engine of its own still gets it.
    expect(extractorFor("M/I Homes", "json_api", { url: SEAIRE, engine: "render_claude" })).not.toBe(mi);
    expect(extractorFor("M/I Homes", "json_api", { url: SEAIRE })).toBe(mi);
  });
});
