import { describe, expect, it } from "vitest";
import { looksLikeHighlights, writtenInSentences } from "@/lib/floorplans/description";
import { descriptionChanged } from "@/lib/floorplans/diff";
import { descriptionFromPage } from "@/lib/floorplans/extractors/claude-extract";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "tuttle",
  name: "Tuttle",
  price: 501990,
  priceDisplay: "$501,990",
  beds: "5",
  baths: "4.5",
  sqft: 2775,
  garages: "3 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.ashtonwoods.com/tampa/oakfield-trails-signature/signature-tuttle",
  galleryImages: [],
  blueprintImages: [],
  ...over,
});

// Ashton Woods' Tuttle at Oakfield Trails Signature: the paragraph and the
// "Plan Highlights" under it, as the queue proposed each over the other
// (Jeff, 2026-11-13).
const tuttle =
  "Discover the Tuttle home plan, a harmonious blend of elegance and functionality. This 2-story residence boasts 4 beautifully appointed bedrooms, 2 full bathrooms, and a thoughtfully placed half bathroom. Entertain effortlessly in the spacious living area and enjoy intimate meals in the charming dining space.";
const tuttleHighlights = [
  "Open kitchen, nook and family room space",
  "Private dining room",
  "First floor primary suite",
  "Optional butler's pantry",
  "Loft",
  "Walk in closets",
];

// Every way the queue has carried an Ashton highlights list.
const plantHighlights = ["Spacious kitchen with island", "Primary suite with walk-in closet", "Covered lanai", "Optional guest suite", "Optional 3 car garage"];
const siestaHighlights = [
  "Open concept kitchen, dining and family room",
  "Covered lanai",
  "Separate one car garage perfect for storage or a golf cart",
  "Den space option",
  "Optional in-law suite in place of tandem garage",
  "Tray ceiling options throughout",
];
const listings = (items: string[]) => [items.join("\n"), items.join("; "), items.join(". "), items.join(" ")];

describe("looksLikeHighlights", () => {
  it("knows a plan's highlights however the read joined them", () => {
    for (const items of [tuttleHighlights, plantHighlights, siestaHighlights]) {
      for (const text of listings(items)) expect(looksLikeHighlights(text), text).toBe(true);
    }
  });

  it("takes no paragraph for a list, nor a single unpunctuated sentence", () => {
    expect(looksLikeHighlights(tuttle)).toBe(false);
    expect(looksLikeHighlights("This Joyce floorplan home has close to 100K in structural upgrades and has Two Primary Suites")).toBe(false);
    expect(looksLikeHighlights("Executive Series 60'")).toBe(false);
    expect(looksLikeHighlights("")).toBe(false);
  });
});

describe("writtenInSentences", () => {
  it("is true of a paragraph and false of a list with stops between its pieces", () => {
    expect(writtenInSentences(tuttle)).toBe(true);
    expect(writtenInSentences(plantHighlights.join(". ") + ".")).toBe(false);
    expect(writtenInSentences("A home made for gathering, with a lanai.")).toBe(false);
  });
});

describe("descriptionChanged: a plan's highlights never replace its paragraph", () => {
  it("proposes no list over the paragraph, however the list is joined", () => {
    for (const text of listings(tuttleHighlights)) {
      expect(descriptionChanged(plan({ description: tuttle }), plan({ description: text })), text).toBe(false);
    }
  });

  it("still proposes the paragraph over a list", () => {
    expect(descriptionChanged(plan({ description: tuttleHighlights.join("; ") }), plan({ description: tuttle }))).toBe(true);
  });
});

describe("descriptionFromPage: the page's paragraph over a card's highlights", () => {
  it("takes the paragraph, and keeps the list beside it", () => {
    const listed = tuttleHighlights.join("\n");
    const got = descriptionFromPage(plan({ description: listed }), tuttle);
    expect(got.description).toBe(tuttle);
    expect(got.raw?.featuresLine).toBe(listed);
  });

  it("keeps the list where the page gave no paragraph", () => {
    const listed = tuttleHighlights.join("\n");
    expect(descriptionFromPage(plan({ description: listed }), null).description).toBe(listed);
  });
});
