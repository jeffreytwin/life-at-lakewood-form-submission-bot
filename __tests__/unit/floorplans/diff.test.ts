import { describe, expect, it } from "vitest";
import { describeGallery, describeText, fieldChanges, galleryOf, mergeForUpdate, type CanonicalRecord } from "@/lib/floorplans/diff";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "avery",
  name: "Avery",
  price: 807995,
  priceDisplay: "$807,995",
  beds: "3",
  baths: "3.5",
  sqft: 2443,
  garages: "3 car",
  homeType: "Single-Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://example.com/avery",
  galleryImages: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
  blueprintImages: ["https://cdn/plan.svg"],
  ...over,
});

describe("fieldChanges", () => {
  it("reports a scalar change, and nothing when nothing changed", () => {
    expect(fieldChanges(plan(), plan())).toEqual([]);
    expect(fieldChanges(plan(), plan({ priceDisplay: "$819,995" }))).toEqual([
      { field: "priceDisplay", label: "price", oldValue: "$807,995", newValue: "$819,995" },
    ]);
  });

  it("never proposes reverting a field a person edited", () => {
    const current = plan({ name: "Avery II", userEditedFields: ["name"] });
    expect(fieldChanges(current, plan({ name: "Avery" }))).toEqual([]);
  });

  it("treats a photo moved as a change, described by count and digest so a rejection sticks to that exact set", () => {
    const reordered = plan({ galleryImages: ["https://cdn/b.jpg", "https://cdn/a.jpg"] });
    const changes = fieldChanges(plan(), reordered);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "galleryImages", label: "photos" });
    expect(changes[0].oldValue).toMatch(/^2 photos · [0-9a-f]{8}$/);
    expect(changes[0].newValue).toMatch(/^2 photos · [0-9a-f]{8}$/);
    expect(changes[0].newValue).not.toBe(changes[0].oldValue);
  });

  it("skips a gallery a person arranged by hand", () => {
    const current = plan({ galleryImages: ["https://cdn/b.jpg"], userEditedFields: ["galleryImages"] });
    expect(fieldChanges(current, plan())).toEqual([]);
  });

  it("reads the first slice's primaryImage as the photo gallery, and sees a blueprint gained", () => {
    const early: CanonicalRecord = { ...plan({ galleryImages: [], blueprintImages: [] }), primaryImage: "https://cdn/a.jpg" };
    expect(fieldChanges(early, plan({ galleryImages: ["https://cdn/a.jpg"] }))).toEqual([
      {
        field: "blueprintImages",
        label: "blueprints",
        oldValue: "no blueprints",
        newValue: expect.stringMatching(/^1 blueprint · [0-9a-f]{8}$/),
      },
    ]);
  });
});

describe("long text fields", () => {
  it("queues a description change as a lead-in plus digest, so the row stays readable and a rejection sticks", () => {
    const long = "Contemporary elegance. The Avery's welcoming covered entry and foyer reveal views of the spacious great room and dining room.";
    const changes = fieldChanges(plan({ description: null }), plan({ description: long }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "description", label: "description", oldValue: "" });
    expect(changes[0].newValue).toMatch(/^Contemporary elegance\. The Avery's welcoming covered entry and foyer reveal view… · [0-9a-f]{8}$/);
    expect(describeText(long)).toBe(changes[0].newValue);
    expect(describeText("short")).toMatch(/^short · [0-9a-f]{8}$/);
    expect(describeText("   ")).toBe("");
  });

  it("shows square feet with a thousands separator", () => {
    expect(fieldChanges(plan({ sqft: 2443 }), plan({ sqft: 3908 }))).toEqual([
      { field: "sqft", label: "sqft", oldValue: "2,443", newValue: "3,908" },
    ]);
  });

  it("diffs the virtual tour like any scalar", () => {
    const changes = fieldChanges(plan(), plan({ virtualTourUrl: "https://my.matterport.com/show/?m=HQYuPU2ve1n&qs=1&play=1" }));
    expect(changes).toEqual([{ field: "virtualTourUrl", label: "virtual tour", oldValue: "", newValue: "https://my.matterport.com/show/?m=HQYuPU2ve1n&qs=1&play=1" }]);
  });
});

describe("mergeForUpdate", () => {
  it("takes the scrape for every field but the edited ones, price following the edited display price", () => {
    const current = plan({ name: "Avery II", priceDisplay: "$800,000", price: 800000, userEditedFields: ["name", "priceDisplay"] });
    const merged = mergeForUpdate(current, plan({ beds: "4", priceDisplay: "$819,995", price: 819995 }));
    expect(merged.beds).toBe("4");
    expect(merged.name).toBe("Avery II");
    expect(merged.priceDisplay).toBe("$800,000");
    expect(merged.price).toBe(800000);
    expect(merged.userEditedFields).toEqual(["name", "priceDisplay"]);
  });

  it("keeps a hand-arranged gallery", () => {
    const current = plan({ galleryImages: ["https://cdn/b.jpg"], userEditedFields: ["galleryImages"] });
    expect(mergeForUpdate(current, plan()).galleryImages).toEqual(["https://cdn/b.jpg"]);
  });

  it("is the plain scrape when nothing was edited", () => {
    expect(mergeForUpdate(plan({ price: 1 }), plan()).price).toBe(807995);
  });
});

describe("describeGallery and galleryOf", () => {
  it("is deterministic, singular for one, order-sensitive, and empty-aware", () => {
    expect(describeGallery([], "photos")).toBe("no photos");
    expect(describeGallery(["a"], "photos")).toMatch(/^1 photo · [0-9a-f]{8}$/);
    expect(describeGallery(["a", "b"], "photos")).toBe(describeGallery(["a", "b"], "photos"));
    expect(describeGallery(["a", "b"], "photos")).not.toBe(describeGallery(["b", "a"], "photos"));
  });

  it("falls back to primaryImage for photos only", () => {
    const early: CanonicalRecord = { ...plan({ galleryImages: [], blueprintImages: [] }), primaryImage: "https://cdn/a.jpg" };
    expect(galleryOf(early, "galleryImages")).toEqual(["https://cdn/a.jpg"]);
    expect(galleryOf(early, "blueprintImages")).toEqual([]);
  });
});
