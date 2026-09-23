import { describe, expect, it } from "vitest";
import { classifyRoom, fileNameWords, orderGallery } from "@/lib/floorplans/gallery-order";

/**
 * Jeff's order (2026-09-18): primary picture, kitchen, living room, dining
 * room, pool/lanai, office, hallways, stairs, bedrooms, bathrooms, laundry,
 * closets, extra exterior options. This pass reads the room off the
 * builder's captions and file names; the vision pass comes later.
 */
describe("classifyRoom", () => {
  it("reads Toll Brothers' showcase captions", () => {
    expect(classifyRoom("Gourmet kitchens with oversize center island")).toBe("kitchen");
    expect(classifyRoom("Open-concept great rooms filled with natural light")).toBe("living");
    expect(classifyRoom("Designed for outdoor enjoyment")).toBe("outdoor");
    expect(classifyRoom("Beautiful outdoor living space with swimming pool, perfect for entertaining")).toBe("outdoor");
  });

  it("settles the ambiguous ones the way a person would: the room named first wins", () => {
    expect(classifyRoom("Owner's bath with soaking tub")).toBe("bathroom");
    expect(classifyRoom("Luxurious owner's suite")).toBe("bedroom");
    expect(classifyRoom("Front porch")).toBe("outdoor");
    expect(classifyRoom("Kitchen and dining")).toBe("kitchen");
    expect(classifyRoom("Relaxing primary bedroom suite with generous walk-in closet")).toBe("bedroom");
    expect(classifyRoom("Spacious walk-in closet off the owner's suite")).toBe("closet");
    expect(classifyRoom("Light-filled great rooms with views to the covered rear lanai")).toBe("living");
    expect(classifyRoom("Covered lanai off the great room")).toBe("outdoor");
  });

  it("puts anything with a loft right after the stairs", () => {
    expect(classifyRoom("Spacious loft overlooking the great room")).toBe("loft");
    const { urls } = orderGallery([
      { src: "https://cdn/bed.jpg", caption: "Secondary bedroom" },
      { src: "https://cdn/loft.jpg", caption: "Versatile loft" },
      { src: "https://cdn/stairs.jpg", caption: "Elegant staircase" },
    ]);
    expect(urls).toEqual(["https://cdn/stairs.jpg", "https://cdn/loft.jpg", "https://cdn/bed.jpg"]);
  });

  it("names nothing when nothing is said", () => {
    expect(classifyRoom("Caribbean")).toBeNull();
    expect(classifyRoom("")).toBeNull();
  });
});

describe("fileNameWords", () => {
  it("finds the room words Pulte and D.R. Horton put in file names", () => {
    expect(classifyRoom(fileNameWords("https://cdn/x/swfl-dw-dwc-cascadia-kitchen-4-67eeb387dc442.jpeg"))).toBe("kitchen");
    expect(classifyRoom(fileNameWords("https://cdn/x/02_KitchenDining.jpg"))).toBe("kitchen");
    expect(classifyRoom(fileNameWords("https://cdn/x/swfl-dw-dwc-cascadia-lanai-1.jpeg"))).toBe("outdoor");
  });

  it("reads Toll's literal room tags, which beat the caption's prose", () => {
    const src = "https://cdn.tollbrothers.com/x/TheIslesatLakewoodRanch-SanibelCollection_Lori_408_OFFICE_1920.jpg";
    expect(classifyRoom(fileNameWords(src))).toBe("office");
    const { meta } = orderGallery([{ src, caption: "Flexible living spaces offer an ideal work from home setting" }]);
    expect(meta[src].room).toBe("office");
  });

  it("finds nothing in Toll's coded file names, and survives a bad URL", () => {
    expect(classifyRoom(fileNameWords("https://cdn.tollbrothers.com/a/AVER_CRB_FLT_3CE_6231_5_1920.jpg"))).toBeNull();
    expect(fileNameWords("not a url")).toBe("");
  });
});

describe("orderGallery", () => {
  const primary = "https://cdn/exteriors/AVER_CRB.jpg";
  const items = [
    { src: "https://cdn/e/antilles.jpg", caption: "Antilles", kind: "exterior" as const },
    { src: "https://cdn/p/1.jpg", caption: "Designed for outdoor enjoyment" },
    { src: "https://cdn/p/2.jpg", caption: "Open-concept great rooms filled with natural light" },
    { src: "https://cdn/p/3.jpg", caption: "Gourmet kitchens with oversize center island" },
    { src: "https://cdn/p/4.jpg", caption: "Spacious secondary bedrooms" },
    { src: "https://cdn/p/5.jpg", caption: "Thoughtfully designed" },
    { src: primary, caption: "Caribbean", kind: "primary" as const },
    { src: "https://cdn/p/6.jpg", caption: "Well-appointed owner's bath" },
    { src: "https://cdn/e/island-colonial.jpg", caption: "Island Colonial", kind: "exterior" as const },
  ];

  it("leads with the primary, walks the rooms in order, parks the unplaced before the exteriors", () => {
    const { urls } = orderGallery(items);
    expect(urls).toEqual([
      primary,
      "https://cdn/p/3.jpg", // kitchen
      "https://cdn/p/2.jpg", // living
      "https://cdn/p/1.jpg", // outdoor
      "https://cdn/p/4.jpg", // bedroom
      "https://cdn/p/6.jpg", // bathroom
      "https://cdn/p/5.jpg", // unplaced
      "https://cdn/e/antilles.jpg",
      "https://cdn/e/island-colonial.jpg",
    ]);
  });

  it("records the caption, room and origin of each image", () => {
    const { meta } = orderGallery(items);
    expect(meta[primary]).toEqual({ caption: "Caribbean", room: "primary", kind: "primary" });
    expect(meta["https://cdn/p/3.jpg"]).toEqual({ caption: "Gourmet kitchens with oversize center island", room: "kitchen", kind: "photo" });
    expect(meta["https://cdn/p/5.jpg"]).toEqual({ caption: "Thoughtfully designed", room: null, kind: "photo" });
    expect(meta["https://cdn/e/antilles.jpg"]).toEqual({ caption: "Antilles", room: "exterior", kind: "exterior" });
  });

  it("keeps page order within a room, drops duplicates, and lets a named room beat the caption", () => {
    const { urls, meta } = orderGallery([
      { src: "https://cdn/a.jpg", caption: "Kitchen view one" },
      { src: "https://cdn/b.jpg", caption: "Kitchen view two" },
      { src: "https://cdn/a.jpg", caption: "Kitchen view one again" },
      { src: "https://cdn/c.jpg", caption: "Kitchen-adjacent", room: "dining" },
    ]);
    expect(urls).toEqual(["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"]);
    expect(meta["https://cdn/c.jpg"].room).toBe("dining");
  });

  it("is deterministic, so a re-run proposes no change", () => {
    expect(orderGallery(items).urls).toEqual(orderGallery([...items]).urls);
  });
});

describe("a caption that is only a style is an elevation (Kolter, 2026-09-23)", () => {
  it("reads Transitional and Spanish Bonus as exteriors, and a coastal kitchen as a kitchen", () => {
    expect(classifyRoom("Transitional")).toBe("exterior");
    expect(classifyRoom("Spanish Bonus")).toBe("exterior");
    expect(classifyRoom("Coastal B")).toBe("exterior");
    expect(classifyRoom("Coastal kitchen with island")).toBe("kitchen");
  });
});
