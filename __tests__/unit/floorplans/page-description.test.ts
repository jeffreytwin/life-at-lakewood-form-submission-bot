import { describe, expect, it } from "vitest";
import { descriptionFromPage } from "@/lib/floorplans/extractors/claude-extract";
import { withDescriptions } from "@/lib/floorplans/description";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "vilano",
  name: "Vilano",
  price: 787990,
  priceDisplay: "$787,990",
  beds: "4",
  baths: "3",
  sqft: 3000,
  garages: "3 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.kolterhomes.com/new-homes/sarasota-bradenton-cresswind-lakewood-ranch/4027/floorplan/vilano/",
  galleryImages: [],
  blueprintImages: [],
  ...over,
});

// Kolter's Cresswind: the card on the list, and the plan page's "About this floorplan" (Jeff, 2026-09-28).
const card = "Coastal Collection - 3,969 Total Sq. Ft. 3 Bedroom (up to 4 Bedroom), Den, 3 Bath, Great Room, 2-Car Garage (up to 3-Car Garage)";
const about =
  "This single-story 3 Bedroom floorplan is built for comfort and flexibility. Entertaining guests and making memories with family and friends is effortless in the Vilano's expansive main living areas.";

describe("descriptionFromPage: a plan page's prose over a card's line of facts (Kolter's Cresswind)", () => {
  it("takes the page's prose, and keeps the card's line beside it", () => {
    const got = descriptionFromPage(plan({ description: card }), about);
    expect(got.description).toBe(about);
    expect(got.raw?.featuresLine).toBe(card);
  });

  it("keeps a description the list gave in prose", () => {
    const listed = "The Vilano is built for comfort, with a great room made for gathering and a den that becomes a fourth bedroom.";
    expect(descriptionFromPage(plan({ description: listed }), about).description).toBe(listed);
  });

  it("takes the page's where the list gave none, and keeps the card's where the page has no prose", () => {
    expect(descriptionFromPage(plan({ description: null }), about).description).toBe(about);
    expect(descriptionFromPage(plan({ description: card }), null).description).toBe(card);
    expect(descriptionFromPage(plan({ description: card }), "3 Bedroom, Den, 3 Bath, Great Room, 2-Car Garage").description).toBe(card);
  });

  it("goes out as the builder's words, with the baths the card says in words", () => {
    const line = "Coastal Collection - 3,541 Total Sq. Ft. 2 Bedroom (up to 3 bedroom), Den, 2 Full and 1 Half Bath, Dining Room, Club Room, 2-Car Garage";
    const read = descriptionFromPage(plan({ name: "Rosemary", baths: "3", description: line }), about);
    const [out] = withDescriptions([plan({ name: "Rosemary", baths: "3", description: read.description, raw: read.raw })], "Cresswind");
    expect(out.description).toBe(about);
    expect(out.raw?.descriptionGenerated).toBeUndefined();
    expect(out.baths).toBe("2.5");
  });
});
