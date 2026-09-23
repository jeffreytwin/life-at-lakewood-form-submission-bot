import { describe, expect, it } from "vitest";
import { withoutCommunityPictures } from "@/lib/floorplans/community-pictures";
import type { GalleryMeta, NormalizedPlan } from "@/lib/floorplans/types";

const plan = (name: string, pictures: [string, GalleryMeta?][], quickMoveIn = false): NormalizedPlan =>
  ({
    planKey: name.toLowerCase(),
    name,
    price: null,
    priceDisplay: null,
    beds: "",
    baths: "",
    sqft: null,
    garages: null,
    homeType: null,
    quickMoveIn,
    comingSoon: false,
    sourceUrl: null,
    galleryImages: pictures.map(([src]) => src),
    galleryMeta: Object.fromEntries(pictures.filter(([, m]) => m).map(([src, m]) => [src, m!])),
    blueprintImages: [],
    raw: {},
  }) as NormalizedPlan;

// Lakespur at Wellen Park as Mattamy files it (2026-09-23): each condo
// plan leads with the building, then its own rooms, then the place.
const building: [string, GalleryMeta] = ["coastal.jpg", { kind: "primary" }];
const exterior: [string, GalleryMeta] = ["exterior-1.jpg", { kind: "exterior", caption: "Exterior" }];
const pier: [string, GalleryMeta] = ["fishing-pier.jpg", { caption: "fishing pier at sunset", room: null }];
const amenity: [string, GalleryMeta] = ["amenities-aerial.jpg", { caption: "amenity center", room: null }];
const lakespur = (name: string) =>
  plan(name, [building, [`${name}-kitchen.jpg`, { room: "kitchen" }], [`${name}-primary.jpg`, { caption: "model home staged" }], pier, amenity, exterior]);

describe("withoutCommunityPictures", () => {
  it("takes the place's pictures out of every plan and keeps the plan's own", () => {
    const got = withoutCommunityPictures([lakespur("seabright"), lakespur("carmel"), lakespur("delmar"), lakespur("oceangrove")]);
    expect(got[0].galleryImages).toEqual(["coastal.jpg", "seabright-kitchen.jpg", "seabright-primary.jpg", "exterior-1.jpg"]);
    expect(Object.keys(got[0].galleryMeta ?? {})).not.toContain("fishing-pier.jpg");
  });

  it("takes them out of the homes too", () => {
    const home = plan("17420 Moonflower Drive", [["home-front.jpg"], pier, ["home-kitchen.jpg", { room: "kitchen" }]], true);
    const got = withoutCommunityPictures([lakespur("seabright"), lakespur("carmel"), lakespur("delmar"), home]);
    expect(got[3].galleryImages).toEqual(["home-front.jpg", "home-kitchen.jpg"]);
  });

  it("keeps a plan's first picture even when every plan shares it", () => {
    const shared = (name: string) => plan(name, [["building.jpg"], [`${name}.jpg`]]);
    const got = withoutCommunityPictures([shared("a"), shared("b"), shared("c")]);
    expect(got.map((p) => p.galleryImages[0])).toEqual(["building.jpg", "building.jpg", "building.jpg"]);
  });

  it("leaves a picture only a few plans share", () => {
    const plans = ["a", "b", "c", "d", "e", "f"].map((n, i) => plan(n, [[`${n}.jpg`], ...(i < 2 ? [pier] : [])]));
    expect(withoutCommunityPictures(plans)[0].galleryImages).toEqual(["a.jpg", "fishing-pier.jpg"]);
  });

  it("leaves a community of two plans as it is", () => {
    const got = withoutCommunityPictures([lakespur("seabright"), lakespur("carmel")]);
    expect(got[0].galleryImages).toContain("fishing-pier.jpg");
  });
});
