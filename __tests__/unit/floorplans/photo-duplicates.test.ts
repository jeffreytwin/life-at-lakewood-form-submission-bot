import { describe, expect, it } from "vitest";
import { NEAR_PRINT, SAME_PRINT, confirmedSame, printDistance, sameFromAnswer, withoutDuplicates } from "@/lib/floorplans/photo-duplicates";

const md = (f: string) => `https://medallionhome.com/wp-content/uploads/2026/04/${f}`;
const sd = (f: string) => `https://simplydwellhomes.com/wp-content/uploads/2026/06/${f}`;

describe("withoutDuplicates", () => {
  it("keeps one of each photograph Claude found twice, at its largest, in the place it first came (Medallion)", () => {
    const gallery = [
      md("ra_aruba-ii_a_3_car_02-800x534.jpg"),
      md("ra_aruba-ii_b_3_car_01-800x534.jpg"),
      md("6980c6db4ae900c5327bb513_41667.jpeg"),
      md("ra_aruba-ii_a_3_car_02-1200x801.jpg"),
      md("ra_aruba-ii_b_3_car_01-1200x801.jpg"),
    ];
    const got = withoutDuplicates(gallery, [
      [0, 3],
      [1, 4],
    ]);
    expect(got.urls).toEqual([md("ra_aruba-ii_a_3_car_02-1200x801.jpg"), md("ra_aruba-ii_b_3_car_01-1200x801.jpg"), md("6980c6db4ae900c5327bb513_41667.jpeg")]);
    expect(got.removed).toEqual([md("ra_aruba-ii_a_3_car_02-800x534.jpg"), md("ra_aruba-ii_b_3_car_01-800x534.jpg")]);
  });

  it("takes WordPress's scaled original over a crop, and keeps the lead's place (SimplyDwell's Buttonwood)", () => {
    const gallery = [sd("Buttonwood-30-2216_Elevation-A-1200x720-1.webp"), sd("4634-10-scaled-1-1.webp"), sd("Buttonwood-30-2216_Elevation-A-scaled-1.webp")];
    const got = withoutDuplicates(gallery, [[2, 0]]);
    expect(got.urls).toEqual([sd("Buttonwood-30-2216_Elevation-A-scaled-1.webp"), sd("4634-10-scaled-1-1.webp")]);
    expect(got.removed).toEqual([sd("Buttonwood-30-2216_Elevation-A-1200x720-1.webp")]);
  });

  it("joins sets that share a picture, and one file spelled twice without being told", () => {
    const df = "https://media.dreamfindershomes.com/371/2024/3/17/Pearl-A.jpg";
    const gallery = [`${df}?width=400`, "https://x.com/b.jpg", `${df}?width=1000`, "https://x.com/c.jpg", "https://x.com/d.jpg"];
    const got = withoutDuplicates(gallery, [
      [1, 3],
      [3, 4],
    ]);
    expect(got.urls).toEqual([`${df}?width=1000`, "https://x.com/b.jpg"]);
    expect(got.removed).toEqual([`${df}?width=400`, "https://x.com/c.jpg", "https://x.com/d.jpg"]);
  });

  it("pairs WordPress's sizes of one upload without being told, and not two uploads", () => {
    const gallery = [
      md("ra_aruba-ii_a_3_car_02-800x534.jpg?ver=1779839219"),
      sd("4634-1-scaled-1-1.webp"),
      sd("4634-1a-scaled-1-1.webp"),
      md("ra_aruba-ii_a_3_car_02-1200x801.jpg?ver=1779839219"),
    ];
    const got = withoutDuplicates(gallery, []);
    expect(got.urls).toEqual([md("ra_aruba-ii_a_3_car_02-1200x801.jpg?ver=1779839219"), sd("4634-1-scaled-1-1.webp"), sd("4634-1a-scaled-1-1.webp")]);
    expect(got.removed).toEqual([md("ra_aruba-ii_a_3_car_02-800x534.jpg?ver=1779839219")]);
  });

  it("changes nothing when every photograph is different", () => {
    const gallery = ["https://x.com/a.jpg", "https://x.com/b.jpg"];
    expect(withoutDuplicates(gallery, [])).toEqual({ urls: gallery, removed: [] });
  });
});

describe("sameFromAnswer", () => {
  it("reads Claude's picture numbers as positions, dropping numbers that name no picture", () => {
    expect(sameFromAnswer([[1, 4], [2, 9], [3, 3], "x", [5, 6, 6]], 6)).toEqual([
      [0, 3],
      [4, 5],
    ]);
    expect(sameFromAnswer(undefined, 6)).toEqual([]);
  });
});

describe("confirmedSame", () => {
  const bits = (flip: number, from = "0".repeat(64)) => "1".repeat(flip) + from.slice(flip);

  it("takes fingerprints that all but match as one photograph, whatever the captions or names say", () => {
    expect(printDistance(bits(3), bits(0))).toBe(3);
    expect(confirmedSame([bits(0), bits(SAME_PRINT), bits(40)], [])).toEqual({ same: [[0, 1]], rejected: [] });
  });

  it("takes Claude's word only where the fingerprints are near too", () => {
    // Near the first, and far from each other: the first 22 bits set, and the last 23.
    const prints = [bits(0), bits(NEAR_PRINT), "0".repeat(64 - NEAR_PRINT - 1) + "1".repeat(NEAR_PRINT + 1), null];
    expect(confirmedSame(prints, [[0, 1, 2, 3]])).toEqual({ same: [[0, 1]], rejected: [[0, 2], [0, 3]] });
  });
});
