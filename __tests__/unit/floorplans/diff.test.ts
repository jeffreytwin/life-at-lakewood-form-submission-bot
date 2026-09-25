import { describe, expect, it } from "vitest";
import { comparedFields, describeGallery, describeText, descriptionChanged, fieldChanges, galleryOf, galleryRead, mergeForUpdate, readsAsProse, tourChanged, type CanonicalRecord } from "@/lib/floorplans/diff";
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

  it("proposes nothing a plan's own page would have said, when that page could not be read", () => {
    // Richmond American has nineteen pages to render in one community and
    // a budget for fewer, and a page that 500s is no different: the run
    // knows nothing about the gallery, not that it is gone (Jeff,
    // 2026-09-22).
    const current = plan({
      description: "A thoughtfully designed two-story.",
      virtualTourUrl: "https://my.matterport.com/show/?m=abc",
    });
    const unread = plan({
      galleryImages: ["https://cdn/hero.jpg"],
      blueprintImages: [],
      description: null,
      virtualTourUrl: null,
      pageUnread: true,
    });
    expect(fieldChanges(current, unread)).toEqual([]);
    // The list still speaks for what a list carries.
    expect(fieldChanges(current, plan({ ...unread, priceDisplay: "$819,995" }))).toEqual([
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

  it("does not queue a description read again with other quotes or capitals (SimplyDwell's Jasmine 2 and Cypress)", () => {
    const curly = "the Jasmine 2 is a 2-story home that fits a family\u2019s every need.";
    expect(fieldChanges(plan({ description: curly }), plan({ description: curly.replace("\u2019", "'") }))).toEqual([]);
    expect(fieldChanges(plan({ description: "Discover the Cypress" }), plan({ description: "Discover The Cypress" }))).toEqual([]);
    expect(fieldChanges(plan({ description: "Discover the Cypress" }), plan({ description: "Discover the Cypress II" }))).toHaveLength(1);
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

  it("keeps the record's home type when the run read none", () => {
    expect(mergeForUpdate(plan(), plan({ homeType: null })).homeType).toBe("Single-Family Home");
    expect(mergeForUpdate(plan(), plan({ homeType: "Townhome" })).homeType).toBe("Townhome");
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

describe("descriptions that are not a change (Jeff, 2026-09-25)", () => {
  const seaStar =
    "The Sea Star, a new home plan by Neal Communities, offers an open design, accommodating living spaces and flexibility so you can personalize it to reflect your preferences. The great room opens to the island kitchen and breakfast nook.";
  const labels = (a: Partial<NormalizedPlan>, b: Partial<NormalizedPlan>) => fieldChanges(plan(a), plan(b)).map((c) => c.label);

  it("is not a change when the run read none: a blank never replaces a description", () => {
    expect(labels({ description: seaStar }, { description: "" })).toEqual([]);
    expect(labels({ description: seaStar }, { description: null })).toEqual([]);
    expect(descriptionChanged(plan({ description: seaStar }), plan({ description: "  " }))).toBe(false);
  });

  it("is not a change when a page's closing sentences or leading status line come and go", () => {
    const withClose = `${seaStar} Come by and visit Boca Royale in Venice and learn more about the Sea Star and other plans. Call today to schedule a private tour.`;
    expect(labels({ description: seaStar }, { description: withClose })).toEqual([]);
    expect(labels({ description: withClose }, { description: seaStar })).toEqual([]);
    const body =
      "Experience the perfect blend of luxury and comfort in the Vision plan by Neal Communities, with an open great room, a gourmet kitchen and a covered lanai made for Florida living.";
    const led = `MOVE IN READY – Vision 2 at Windward – Homesite #478. ${body}`;
    expect(labels({ description: led }, { description: body })).toEqual([]);
    expect(labels({ description: body }, { description: led })).toEqual([]);
  });

  it("is not a change when only the punctuation differs", () => {
    const a = "UNDER CONSTRUCTION – Imagination 2 at Boca Royale – Homesite #124. The Imagination offers a split bedroom design with an open great room and kitchen.";
    const b = "UNDER CONSTRUCTION – Imagination 2 at Boca Royale – Homesite #124 The Imagination offers a split bedroom design with an open great room and kitchen.";
    expect(labels({ description: a }, { description: b })).toEqual([]);
  });

  it("is a change when the builder's words did change, or its status did", () => {
    const body = "The Heritage 2 is a 2-story, 4 bedroom, 2.5 bath single-family home featuring 2,500 square feet of living space and a loft.";
    expect(labels({ description: `UNDER CONSTRUCTION – Heritage 2 – Homesite #101. ${body}` }, { description: `MOVE IN READY – Heritage 2 – Homesite #101. ${body}` })).toEqual([
      "description",
    ]);
    expect(labels({ description: seaStar }, { description: "The Sea Star has been redesigned with a larger lanai, a summer kitchen and a fourth bedroom off the entry." })).toEqual([
      "description",
    ]);
  });

  it("does not let a tag line replace a paragraph, and does let a paragraph replace a tag line", () => {
    const paragraph = "The Aruba 2 floor plan is designed to bring together open living, flexible space and everyday comfort for the way families live.";
    expect(labels({ description: paragraph }, { description: "1 Story, Den/Office" })).toEqual([]);
    expect(labels({ description: paragraph }, { description: "Preserve View Villa" })).toEqual([]);
    expect(labels({ description: "Pond Views Pool Included Single Family Home" }, { description: paragraph })).toEqual(["description"]);
    expect(readsAsProse("1 Story, Den/Office, New Plan!")).toBe(false);
    expect(readsAsProse(paragraph)).toBe(true);
  });

  it("compares what the builder wrote, not our rewording of it", () => {
    const original = "Our Lori plan gives you a gourmet kitchen, a split owner's suite and a covered lanai for year-round Florida living.";
    const reworded = "The Lori plan by Toll Brothers offers a gourmet kitchen, a split owner's suite and a covered lanai for year-round Florida living.";
    const stored = plan({ description: reworded, raw: { descriptionOriginal: original } });
    // A run that reworded it again in other words, and one that had no time to reword it at all.
    const again = plan({ description: "Toll Brothers' Lori plan includes a gourmet kitchen, a split owner's suite and a covered lanai for year-round Florida living.", raw: { descriptionOriginal: original } });
    const unreworded = plan({ description: original });
    expect(fieldChanges(stored, again).map((c) => c.label)).toEqual([]);
    expect(fieldChanges(stored, unreworded).map((c) => c.label)).toEqual([]);
    // Nor is a changed text that still speaks as the builder put to anyone before it is reworded.
    expect(fieldChanges(stored, plan({ description: "We rebuilt our Lori plan with a larger lanai, a summer kitchen and a fourth bedroom off the entry." })).map((c) => c.label)).toEqual([]);
  });

  it("keeps the record's own description when an approved change writes the record", () => {
    const withClose = `${seaStar} Call today to schedule a private tour of the model and see the options in person.`;
    const merged = mergeForUpdate(plan({ description: seaStar }), plan({ description: withClose, priceDisplay: "$819,995" }));
    expect(merged.description).toBe(seaStar);
    expect(merged.priceDisplay).toBe("$819,995");
    expect(mergeForUpdate(plan({ description: seaStar }), plan({ description: "" })).description).toBe(seaStar);
  });
});

describe("tours that are not a change (Jeff, 2026-09-25)", () => {
  const modsy = "https://www.modsy.com/homejourney/embed/lennar/community/878/modelhome/3893/virtualtour/3944";
  const labels = (a: Partial<NormalizedPlan>, b: Partial<NormalizedPlan>) => fieldChanges(plan(a), plan(b)).map((c) => c.label);

  it("does not take away a working tour because a run found none", () => {
    expect(labels({ virtualTourUrl: modsy }, { virtualTourUrl: null })).toEqual([]);
    expect(tourChanged(plan({ virtualTourUrl: modsy }), plan({ virtualTourUrl: null }))).toBe(false);
    expect(mergeForUpdate(plan({ virtualTourUrl: modsy }), plan({ virtualTourUrl: null, priceDisplay: "$1" })).virtualTourUrl).toBe(modsy);
  });

  it("does take away a link that is not a tour", () => {
    expect(labels({ virtualTourUrl: "https://ifp.thebdxinteractive.com/NealCommunities-Windward-Kiawah" }, { virtualTourUrl: null })).toEqual(["virtual tour"]);
    expect(labels({ virtualTourUrl: "https://hd.lennar.com/tours/3914/" }, { virtualTourUrl: null })).toEqual(["virtual tour"]);
    expect(labels({ virtualTourUrl: "https://hd.lennar.com/tours/3944/" }, { virtualTourUrl: modsy })).toEqual(["virtual tour"]);
  });
});

describe("a rejected change does not ride along with an approved one (Jeff, 2026-09-25)", () => {
  it("keeps the field a person rejected at its current value in the record an approval writes", () => {
    const current = plan({ virtualTourUrl: "https://www.modsy.com/homejourney/embed/lennar/community/1128/modelhome/4648/virtualtour/4679" });
    const scraped = plan({ virtualTourUrl: "https://my.matterport.com/show/?m=abc", priceDisplay: "$819,995" });
    const merged = mergeForUpdate(current, scraped, ["virtualTourUrl"]);
    expect(merged.virtualTourUrl).toBe(current.virtualTourUrl);
    expect(merged.priceDisplay).toBe("$819,995");
    expect(merged.userEditedFields).toEqual(current.userEditedFields);
  });

  it("names the fields a run speaks for, so a pending change it no longer finds can be withdrawn", () => {
    expect(comparedFields(plan(), plan())).toContain("description");
    expect(comparedFields(plan(), plan({ pageUnread: true }))).not.toContain("description");
    expect(comparedFields(plan({ userEditedFields: ["priceDisplay"] }), plan())).not.toContain("price");
  });
});

describe("a gallery read only in part (Richmond's Fraser, Jeff 2026-09-25)", () => {
  const fraser = Array.from({ length: 14 }, (_, i) => `https://cdn/fraser-${i}.webp`);
  const current = plan({ galleryImages: fraser, galleryMeta: { [fraser[1]]: { room: "kitchen" } } });

  it("does not propose taking down the pictures a run missed", () => {
    const partial = plan({ galleryImages: [fraser[0]] });
    expect(galleryRead(current, partial, "galleryImages")).toBe(false);
    expect(fieldChanges(current, partial).map((c) => c.label)).not.toContain("photos");
    expect(comparedFields(current, partial)).not.toContain("photos");
    // Nor a run that found no pictures at all.
    expect(fieldChanges(current, plan({ galleryImages: [] })).map((c) => c.label)).not.toContain("photos");
  });

  it("keeps the record's gallery when another change is approved", () => {
    const partial = plan({ galleryImages: [fraser[0]], priceDisplay: "$819,995" });
    const merged = mergeForUpdate(current, partial);
    expect(merged.galleryImages).toEqual(fraser);
    expect(merged.galleryMeta).toEqual(current.galleryMeta);
    expect(merged.priceDisplay).toBe("$819,995");
  });

  it("still reads new pictures, a few dropped, or a new set as a change", () => {
    expect(galleryRead(current, plan({ galleryImages: [...fraser, "https://cdn/new.webp"] }), "galleryImages")).toBe(true);
    expect(galleryRead(current, plan({ galleryImages: fraser.slice(0, 12) }), "galleryImages")).toBe(true);
    expect(galleryRead(current, plan({ galleryImages: ["https://cdn/replaced.webp"] }), "galleryImages")).toBe(true);
    expect(fieldChanges(current, plan({ galleryImages: ["https://cdn/replaced.webp"] })).map((c) => c.label)).toContain("photos");
  });

  it("keeps what only the plan's page says when that page went unread", () => {
    const unread = plan({ pageUnread: true, garages: null, galleryImages: [fraser[0]], priceDisplay: "$819,995" });
    const merged = mergeForUpdate(plan({ galleryImages: fraser, garages: "2 car" }), unread);
    expect(merged.garages).toBe("2 car");
    expect(merged.galleryImages).toEqual(fraser);
  });
});
