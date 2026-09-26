import { describe, expect, it } from "vitest";
import { sortDrawings } from "@/lib/floorplans/extractors/claude-extract";
import { drawingsNamed } from "@/lib/floorplans/extractors/plan-page";
import { asTour } from "@/lib/floorplans/standardize";
import { descriptionChanged, mergeForUpdate } from "@/lib/floorplans/diff";

// KB's Creekside at Rutland Ranch, as a run read it (Jeff, 2026-09-25).
const kb = "https://www.kbhome.com/globalassets/images/community-images/florida/sarasota-bradenton/creekside-at-rutland-ranch/floor-plan";
const greatRoom = `${kb}/interior-images/kbtpa_creeksideatrutlandranch_1707-greatroom-1.jpg`;
const ownersSuite = `${kb}/interior-images/kbtpa_creeksideatrutlandranch_1707-ownersuite_rev-1.jpg`;
const cameo = `${kb}/cameos/kbtpa_creekside_at_rutland_ranch_1707_3741-1-1.jpg`;

describe("KB's photos are not its drawings (Creekside at Rutland Ranch, Jeff 2026-09-25)", () => {
  it("does not take a photo for a drawing because a folder above it is called floor-plan", () => {
    const page = `<img src="${greatRoom}"><img src="${ownersSuite}"><img src="${cameo}">`;
    expect(drawingsNamed(page, "https://www.kbhome.com/x/plan-1707-modeled", ["Plan 1707 Modeled"])).toEqual([]);
    // Homes by Towne's drawings still are.
    const towne = "https://homesbytowne.com/wp-content/uploads/floorplan/hbt-fl-shellstone-waterside-fp-mooring.jpg";
    expect(drawingsNamed(`<img src="${towne}">`, "https://homesbytowne.com/x", ["Mooring"])).toEqual([towne]);
  });

  it("puts a picture named for a room, or filed among photos, with the photos", () => {
    const drawing = `${kb}/floorplans/kbtpa_creekside_1707_fp.jpg`;
    expect(sortDrawings([greatRoom, ownersSuite, cameo, drawing])).toEqual({ drawings: [drawing], views: [greatRoom, ownersSuite, cameo] });
  });
});

describe("addresses that are never a tour (KB, Jeff 2026-09-25)", () => {
  it("drops KB's reservation app and any picture or document", () => {
    expect(asTour("https://kb-vu.com/reservu/EaVDErh70Nz7Qlw2aenZ")).toBeNull();
    expect(asTour(`${kb}/exterior-images-front/kbtpa_creeksideatrutlandranch_1707-exterior_4050-1.jpg`)).toBeNull();
    expect(asTour("https://example.com/brochure.pdf?x=1")).toBeNull();
    expect(asTour("https://my.matterport.com/show/?m=bxTr9izXr4F")).toBe("https://my.matterport.com/show/?m=bxTr9izXr4F");
  });
});

describe("a description we wrote never replaces the builder's (KB Creekside, Jeff 2026-09-25)", () => {
  const plan = (description: string | null, generated = false) => ({
    planKey: "plan-1989", name: "Plan 1989", price: 350000, priceDisplay: "$350,000", beds: "3", baths: "2", sqft: 1989,
    garages: "2 car", homeType: "Single Family Home", quickMoveIn: false, comingSoon: false, sourceUrl: null,
    galleryImages: [], blueprintImages: [], description, raw: generated ? { descriptionGenerated: true } : {},
  });
  const builders = "Explore roomy living areas and great features. Highlights include an open great room, a flex space and a covered patio.";
  const ours = "The Plan 1989 is available to be built in Creekside at Rutland Ranch. The price shown is the base price. This plan features 3 Bedrooms, 2 Baths and a 2 car garage.";

  it("keeps the builder's text when a run read none and wrote its own", () => {
    expect(descriptionChanged(plan(builders), plan(ours, true))).toBe(false);
    expect(mergeForUpdate(plan(builders), { ...plan(ours, true), priceDisplay: "$355,000" })).toMatchObject({ description: builders, raw: {} });
  });

  it("still takes the builder's text over one we wrote, and ours where there was none", () => {
    expect(descriptionChanged(plan(ours, true), plan(builders))).toBe(true);
    expect(descriptionChanged(plan(null), plan(ours, true))).toBe(true);
  });

  it("does not propose ours over ours, and an approval writes the run's", () => {
    const before = ours.replace("3 Bedrooms", "4 Bedrooms");
    expect(descriptionChanged(plan(before), plan(ours, true))).toBe(false);
    expect(mergeForUpdate(plan(before), { ...plan(ours, true), priceDisplay: "$355,000" }).description).toBe(ours);
  });
});

describe("D.R. Horton's photos filed as drawings (Jeff, 2026-09-26)", () => {
  const drh = "https://www.drhorton.com/-/media/drhorton/productcatalog/397-sarasota";
  const bonus = `${drh}/39429-saddlestone/397770000-saddlestone-60-drh/2795/14-saddlestone-camden-bonus_room.jpg`;
  const cladding = `${drh}/39411-legacy-preserve-master/397390000-legacy-preserve-50-exp/4eab/aria-c-siding-stone-gen3-elev_ind.jpg`;
  const elev = `${drh}/39292-rye-crossing/397620000-rye-crossing-60-exp/e502/covington-g-gen3-elev_ind.jpg`;
  const harper = `${drh}/39227-bella-lago/392300000-bella-lago-40-exp/3emb`;

  it("takes a bonus room, an elevation by its cladding or by 'elev' for photos", () => {
    expect(sortDrawings([bonus, cladding, elev])).toEqual({ drawings: [], views: [bonus, cladding, elev] });
  });

  it("takes a numbered file for the next photo where the plan's photos are numbered in its folder", () => {
    const photos = [`${harper}/01.jpg`, `${harper}/02.jpg`, `${harper}/13.jpg`];
    expect(sortDrawings([`${harper}/14.jpg`], photos).views).toEqual([`${harper}/14.jpg`]);
    // Not where the photos in its folder are named otherwise.
    expect(sortDrawings([`${harper}/14.jpg`], [`${harper}/front.jpg`]).drawings).toEqual([`${harper}/14.jpg`]);
  });

  it("takes the next of a numbered series of named photos for a photo (Torino at Star Farms)", () => {
    const torino = `${drh}/39429-saddlestone/397770000-saddlestone-60-drh/3975`;
    const photos = [`${torino}/1-oakfield-trails-torino-kitchen.jpg`, `${torino}/30-oakfield-trails-torino-secondary_bed.jpg`];
    const bonusSpace = `${torino}/31-oakfield-trails-torino-bonus_space.jpg`;
    expect(sortDrawings([bonusSpace], photos).views).toEqual([bonusSpace]);
    // A numbered drawing of another series in the folder is still a drawing.
    const drawing = `${torino}/1-torino-first-floor-plan.jpg`;
    expect(sortDrawings([drawing], photos).drawings).toEqual([drawing]);
  });

  it("still keeps a drawing that names the plan's floor plan", () => {
    const plan = `${drh}/39429-star-farms/394330000-star-farms-50-drh-emerald/2767/caroline-floorplan.jpg`;
    expect(sortDrawings([plan]).drawings).toEqual([plan]);
  });
});
