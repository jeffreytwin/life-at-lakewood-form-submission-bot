import { describe, expect, it } from "vitest";
import { forTheList } from "@/lib/floorplans/queue-list";

describe("a queued change as the list shows it (Jeff, 2026-09-26)", () => {
  const row = {
    id: "c1",
    proposed_record: {
      name: "Casey",
      priceDisplay: "$487,990",
      galleryImages: ["https://x/1.jpg", "https://x/2.jpg"],
      blueprintImages: ["https://x/fp.jpg"],
      galleryMeta: { "https://x/1.jpg": { caption: "Front", room: "exterior" }, "https://x/2.jpg": { caption: "Kitchen", room: "kitchen" } },
      scrapedGalleryImages: ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"],
      scrapedBlueprintImages: ["https://x/fp.jpg"],
      raw: { featuresLine: "3 Bedroom, 2 Bath" },
      description: "A plan.",
    },
  };

  it("leaves out what only the overlay reads, and keeps the first photo's caption", () => {
    const listed = forTheList(row).proposed_record as Record<string, unknown>;
    expect(listed).not.toHaveProperty("scrapedGalleryImages");
    expect(listed).not.toHaveProperty("scrapedBlueprintImages");
    expect(listed).not.toHaveProperty("raw");
    expect(listed.galleryMeta).toEqual({ "https://x/1.jpg": { caption: "Front", room: "exterior" } });
    expect(listed).toMatchObject({ name: "Casey", priceDisplay: "$487,990", galleryImages: row.proposed_record.galleryImages, description: "A plan." });
  });

  it("leaves a row without a record as it is", () => {
    const empty = { id: "c2", proposed_record: null };
    expect(forTheList(empty)).toBe(empty);
  });
});
