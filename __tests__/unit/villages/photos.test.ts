import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/floorplans/media", () => ({ measureImageUrl: vi.fn() }));

import { photoCandidates, photoFills, placePhotos, sharedImageOf, sizeOf, wantsPhotos, type Placed, type PlanPhotos } from "@/lib/villages/photos";

const lennar = (name: string, base: string, extra: Partial<PlanPhotos> = {}): PlanPhotos => ({
  name,
  builder: "Lennar",
  quickMoveIn: false,
  score: null,
  images: [`${base}/front.jpg?d=1`, `${base}/kitchen.jpg`, `${base}/bath2.jpg`, `${base}/lanai.jpg`, `${base}/owners.jpg`, `${base}/elev-d.jpg`],
  meta: {
    // As the engine files Lennar's: the lead elevation is "primary", the others "exterior".
    [`${base}/front.jpg?d=1`]: { kind: "primary", room: "primary", caption: "Exterior E" },
    [`${base}/elev-d.jpg`]: { kind: "exterior", room: "exterior", caption: "Exterior D" },
    [`${base}/kitchen.jpg`]: { kind: "photo", room: "kitchen", caption: "Kitchen" },
    [`${base}/bath2.jpg`]: { kind: "photo", room: "bathroom", caption: "Bathroom 2" },
    [`${base}/lanai.jpg`]: { kind: "photo", room: "outdoor", caption: "Lanai" },
  },
  ...extra,
});

const placed = (url: string, label: Placed["label"], width = 2000, height = 1200): Placed => ({
  url,
  label,
  builder: "Lennar",
  uri: `wix:image://v1/d0be81_${label}~mv2.jpg/x.jpg#originWidth=${width}&originHeight=${height}`,
  width,
  height,
});

describe("photoCandidates", () => {
  it("leads with the builder's page picture, then a front per plan, then one of each room, base plans first", () => {
    const rooms = new Map<string, string | null>([["https://cdn/b/owners.jpg", "bedroom"]]);
    const qmi = lennar("18216 Kettle Lake Pl", "https://cdn/q", { quickMoveIn: true });
    const out = photoCandidates([qmi, lennar("Summerville II", "https://cdn/a"), lennar("Richmond", "https://cdn/b", { score: 9 })], rooms, [
      { url: "https://lennar.com/og.jpg", label: "community", builder: "Lennar" },
    ]);
    expect(out.map((c) => [c.url, c.label])).toEqual([
      ["https://lennar.com/og.jpg", "community"],
      ["https://cdn/b/front.jpg?d=1", "front"],
      ["https://cdn/a/front.jpg?d=1", "front"],
      ["https://cdn/q/front.jpg?d=1", "front"],
      ["https://cdn/b/kitchen.jpg", "kitchen"],
      ["https://cdn/q/lanai.jpg", "outdoor"],
      ["https://cdn/b/owners.jpg", "suite"],
    ]);
    // Bathrooms never make the list, and a plan's front is its lead elevation.
    expect(out.some((c) => c.label === "bathroom")).toBe(false);
    expect(out.some((c) => c.url.endsWith("elev-d.jpg"))).toBe(false);
  });

  it("counts a picture once under a cache-busting query, and stops at the cap", () => {
    const a = lennar("A", "https://cdn/a");
    const b = { ...lennar("B", "https://cdn/a"), images: ["https://cdn/a/front.jpg?d=2"] };
    expect(photoCandidates([a, b], new Map()).filter((c) => c.label === "front")).toHaveLength(1);
    expect(photoCandidates([a, b], new Map(), [], 2)).toHaveLength(2);
  });
});

describe("placePhotos", () => {
  it("puts wide pictures behind the sections and titles a gallery of fronts then rooms", () => {
    const photos = placePhotos(
      [
        placed("k", "kitchen"),
        placed("f1", "front"),
        placed("tall", "front", 1000, 1500),
        placed("f2", "front"),
        placed("o", "outdoor"),
        placed("small", "living", 900, 600),
        placed("f3", "front"),
      ],
      "Stillwater",
      "Lakewood Ranch, Florida"
    );
    expect(photos.main?.url).toBe("f1");
    expect(photos.about?.url).toBe("f2");
    expect(photos.amenities?.url).toBe("o");
    expect(photos.gallery.map((g) => g.title)).toEqual([
      "Beautiful New Homes in Stillwater",
      "Thoughtfully Designed Exteriors",
      "Kitchens Made for Gathering",
      "Outdoor Living, Florida Style",
      "Open, Light-Filled Living Spaces",
      // A third house only once the rooms run out.
      "Curb Appeal at Every Turn",
    ]);
    expect(photos.gallery[0]).toMatchObject({ type: "image", alt: "A Lennar home in Stillwater in Lakewood Ranch, Florida" });
    expect(photos.gallery[2].alt).toBe("The kitchen of a Lennar home in Stillwater, Lakewood Ranch, Florida");
  });

  it("prefers the builder's own picture of the village for the main image", () => {
    const photos = placePhotos([placed("f", "front"), placed("c", "community")], "Crosswind Ranch", "Parrish, Florida");
    expect(photos.main?.url).toBe("c");
    expect(photos.gallery[0].title).toBe("Welcome to Crosswind Ranch");
    expect(photos.gallery[0].alt).toBe("Crosswind Ranch in Parrish, Florida");
  });
});

describe("photoFills", () => {
  const photos = placePhotos([placed("f1", "front"), placed("f2", "front"), placed("o", "outdoor")], "Lakespur", "Wellen Park, Florida");

  it("fills each site's picture fields by their names, blanks only", () => {
    const fields = [
      { key: "topBackgroundImage", displayName: "Main Image", type: "IMAGE" },
      { key: "topOfPageBackground", displayName: "Top of Page Background", type: "IMAGE" },
      { key: "aboutVillageBackground", displayName: "About Neighborhood Background", type: "IMAGE" },
      { key: "amenitiesBackground", displayName: "Amenities Background", type: "IMAGE" },
      { key: "visualTourGallery", displayName: "Visual Tour Gallery", type: "MEDIA_GALLERY" },
      { key: "aboutNeighborhoodImage", displayName: "Unique Neighborhood Image", type: "IMAGE" },
      { key: "poolImage", displayName: "Pool Image", type: "IMAGE" },
    ];
    const out = photoFills(fields, { amenitiesBackground: "wix:image://v1/mine.jpg/x#originWidth=1&originHeight=1" }, photos);
    expect(Object.keys(out).sort()).toEqual(["aboutVillageBackground", "topBackgroundImage", "topOfPageBackground", "visualTourGallery"]);
    expect(out.topBackgroundImage).toBe(photos.main?.uri);
    expect(out.topOfPageBackground).toBe(photos.main?.uri);
    expect(out.aboutVillageBackground).toBe(photos.about?.uri);
    expect(out.visualTourGallery).toEqual(photos.gallery);
  });

  it("fills Lakewood's Top Background Image and Village Details' Main Image", () => {
    const out = photoFills(
      [
        { key: "topBackgroundImage", displayName: "Top Background Image", type: "IMAGE" },
        { key: "mainImage", displayName: "Main Image", type: "IMAGE" },
      ],
      {},
      photos
    );
    expect(out).toEqual({ topBackgroundImage: photos.main?.uri, mainImage: photos.main?.uri });
  });

  it("says whether a row has a picture field left to fill", () => {
    const fields = [{ key: "mainImage", displayName: "Main Image", type: "IMAGE" }];
    expect(wantsPhotos(fields, {})).toBe(true);
    expect(wantsPhotos(fields, { mainImage: "wix:image://v1/mine.jpg/x#originWidth=1&originHeight=1" })).toBe(false);
  });

  it("writes nothing without photos", () => {
    expect(photoFills([{ key: "mainImage", displayName: "Main Image", type: "IMAGE" }], {}, null)).toEqual({});
  });
});

describe("sharedImageOf and sizeOf", () => {
  it("reads og:image in either attribute order, resolved against the page", () => {
    expect(sharedImageOf('<meta content="/img/hero.jpg?w=1&amp;h=2" property="og:image">', "https://www.lennar.com/new-homes/x")).toBe(
      "https://www.lennar.com/img/hero.jpg?w=1&h=2"
    );
    expect(sharedImageOf('<meta name="twitter:image" content="https://cdn/x.png" />', "https://a.com")).toBe("https://cdn/x.png");
    expect(sharedImageOf("<meta name=description content=x>", "https://a.com")).toBeNull();
  });

  it("reads the size a wix:image URI records", () => {
    expect(sizeOf("wix:image://v1/a~mv2.jpg/x.jpg#originWidth=1600&originHeight=900")).toEqual({ width: 1600, height: 900 });
    expect(sizeOf("wix:image://v1/a~mv2.jpg/x.jpg")).toBeNull();
  });
});
