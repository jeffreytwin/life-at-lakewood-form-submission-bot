import { describe, expect, it, vi } from "vitest";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const front = "https://cdn.example.com/front.jpg";
const kitchen = "https://cdn.example.com/kitchen.jpg";
const living = "https://cdn.example.com/living.jpg";
const livingAgain = "https://cdn.example.com/living-copy.jpg";

vi.mock("@/lib/floorplans/photo-duplicates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/floorplans/photo-duplicates")>();
  return {
    ...actual,
    // The living room, shown twice.
    samePhotos: vi.fn(async (urls: string[]) => ({ same: [[urls.indexOf(living), urls.indexOf(livingAgain)]], checked: true, rejected: [], shows: [], looks: [] })),
  };
});
vi.mock("@/lib/floorplans/photo-rooms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/floorplans/photo-rooms")>();
  return {
    ...actual,
    labelPhotos: vi.fn(async () => new Map<string, string | null>([[front, "front"], [kitchen, "kitchen"], [living, "living"]])),
  };
});

import { sortGalleryNow } from "@/lib/floorplans/sort-queue";

const plan = (galleryImages: string[]): NormalizedPlan => ({
  planKey: "verona",
  name: "Verona",
  price: 500000,
  priceDisplay: "$500,000",
  beds: "3",
  baths: "2",
  sqft: 2000,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages,
  blueprintImages: [],
});

describe("sortGalleryNow: the ticked plans' photos sorted from the queue (Jeff, 2026-09-28)", () => {
  it("shows each photo once, leads with the front, and marks the gallery sorted and checked without a hand edit", async () => {
    const { record, removed, placed } = await sortGalleryNow(plan([kitchen, living, livingAgain, front]));
    expect(record.galleryImages[0]).toBe(front);
    expect(record.galleryImages).toHaveLength(3);
    expect(record.galleryImages).not.toContain(livingAgain);
    expect(removed).toEqual([livingAgain]);
    expect(record.copiesOf).toEqual({ [livingAgain]: living });
    expect(placed).toBe(3);
    expect(record.photosSorted).toBe(true);
    expect(record.copiesChecked).toBe(true);
    expect(record.userEditedFields ?? []).not.toContain("galleryImages");
  });
});
