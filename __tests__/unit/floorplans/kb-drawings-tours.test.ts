import { describe, expect, it } from "vitest";
import { sortDrawings } from "@/lib/floorplans/extractors/claude-extract";
import { drawingsNamed } from "@/lib/floorplans/extractors/plan-page";
import { asTour } from "@/lib/floorplans/standardize";

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
