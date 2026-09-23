import { describe, expect, it } from "vitest";
import { payloadGallery } from "@/lib/floorplans/extractors/plan-page";

const BASE =
  "https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch/star-farms-at-lakewood-ranch-50";

/**
 * Perry's section page as it really arrives (read off the live page,
 * 2026-09-22): a Next.js payload of media-library records whose labels
 * are kept by reference, and whose fields are split across script chunks
 * mid-object. String.raw, so the backslashes are the page's own.
 */
const perry = [
  String.raw`<script>self.__next_f.push([1,"3e:[\"interior\"]\n3f:[\"southwest_florida\"]\n`,
  String.raw`3d:{\"active\":\"active\",\"type\":\"$3e\",\"design_id\":\"3024F\",\"elevation_id\":30,\"community\":\"Lakewood Ranch\",\"address\":\"3413CountryViewCourt\",\"show_disclaimer\":\"off\"}\n`,
  String.raw`4c:[\"exterior\"]\n`,
  String.raw`4d:{\"active\":\"active\",\"type\":\"$4c\",\"design_id\":\"3024F\",\"show_disclaimer\":\"off\"}\n`,
  // The hero, which the page calls an exterior.
  String.raw`4e:{\"public_id\":\"3413CountryViewCourt_gvx8k0\",\"secure_url\":\"https://res.cloudinary.com/perryhomes/image/upload/v1781014072/3413CountryViewCourt_gvx8k0.jpg\",\"width\":2048,\"metadata\":\"$4d\",\"format\":\"jpg\"}\n`,
  // An interior, whose record the page splits across two chunks.
  String.raw`3c:{\"public_id\":\"3413CountryViewCourt-01_zugexk\",\"secure_url\":\"https://res.cloudinary.com/perryhomes/image/upload/v1781014072/3413CountryViewCourt-01_zugexk.jpg\",\"width\":2048,\"height\":1152,\"display_name\":\"3413CountryViewCourt-01\",\"filename\""])</script>`,
  String.raw`<script>self.__next_f.push([1,":\"3413CountryViewCourt-01_zugexk\",\"version\":\"1781014072\",\"metadata\":\"$3d\",\"format\":\"jpg\",\"bytes\":1086016}\n`,
  // One the page labels nothing at all — still a photograph of the home.
  String.raw`50:{\"public_id\":\"3413CountryViewCourt-02_kfctum\",\"secure_url\":\"https://res.cloudinary.com/perryhomes/image/upload/v1781014072/3413CountryViewCourt-02_kfctum.jpg\",\"metadata\":\"$99\"}"])</script>`,
].join("");

const photo = (name: string) =>
  `https://res.cloudinary.com/perryhomes/image/upload/v1781014072/${name}`;

describe("payloadGallery", () => {
  it("finds the pictures a page carries but never draws, in the order it carries them", () => {
    // Perry's 50' section shows a hero and four thumbnails and carries
    // twenty-three photographs; not one of them is in an <img> tag.
    expect(payloadGallery(perry, BASE).map((g) => g.src)).toEqual([
      photo("3413CountryViewCourt_gvx8k0.jpg"),
      photo("3413CountryViewCourt-01_zugexk.jpg"),
      photo("3413CountryViewCourt-02_kfctum.jpg"),
    ]);
  });

  it("marks the outside views the page itself names", () => {
    const got = payloadGallery(perry, BASE);
    expect(got[0].outside).toBe(true);
    expect(got[1].outside).toBe(false);
  });

  it("keeps a picture whose record says nothing, rather than dropping it", () => {
    // Two of the 90' section's eighteen carry no label, and they are
    // photographs of the home like the rest.
    expect(payloadGallery(perry, BASE)[2].outside).toBe(false);
  });

  it("says nothing about a page that keeps no such data", () => {
    expect(payloadGallery(`<html><body><img src="/a.jpg"></body></html>`, BASE)).toEqual([]);
  });

  it("reads a payload that does not escape its quotes", () => {
    const plain =
      String.raw`7:["exterior"]\n8:{"active":"active","type":"$7","design_id":"X"}\n` +
      String.raw`9:{"public_id":"p","secure_url":"https://res.cloudinary.com/x/front.jpg","metadata":"$8"}`;
    expect(payloadGallery(plain, BASE)).toEqual([
      { src: "https://res.cloudinary.com/x/front.jpg", outside: true },
    ]);
  });

  it("shows the same picture once, however often the payload names it", () => {
    expect(payloadGallery(perry + perry, BASE)).toHaveLength(3);
  });

  describe("a plan's own page, whose pictures describe themselves", () => {
    // Perry's 2016F page (read off the live page, 2026-09-23): each
    // elevation carries its description inside it, and the menus above
    // carry pictures of the markets that describe no design.
    const record = (id: string, meta: string) =>
      String.raw`{\"public_id\":\"${id}\",\"secure_url\":\"https://res.cloudinary.com/perryhomes/image/upload/v1/${id}.jpg\",\"width\":2048,\"display_name\":\"${id}\",\"metadata\":{${meta}},\"format\":\"jpg\"}`;
    const page = [
      String.raw`<script>self.__next_f.push([1,"{\"images\":[`,
      record("market_orlando", String.raw`\"representative_disclaimer\":\"Representative Image.\",\"show_design_id\":\"off\"`),
      ",",
      record("2016F_E1_Web", String.raw`\"active\":\"active\",\"design_id\":\"2016F\",\"elevation_id\":1,\"type\":[\"elevation\"]`),
      ",",
      record("2016F_E31_Web", String.raw`\"active\":\"active\",\"design_id\":\"2016F\",\"elevation_id\":31,\"type\":[\"elevation\"]`),
      ",",
      record("2016F_Kitchen", String.raw`\"design_id\":\"2016F\",\"type\":[\"interior\"]`),
      ",",
      record("2420F_E1_Web", String.raw`\"design_id\":\"2420F\",\"type\":[\"elevation\"]`),
      String.raw`]}"])</script>`,
    ].join("");
    const at = (id: string) => `https://res.cloudinary.com/perryhomes/image/upload/v1/${id}.jpg`;

    it("takes the pictures of the plan's own design, in order, and not the menus'", () => {
      expect(payloadGallery(page, BASE, ["Design 2016F"])).toEqual([
        { src: at("2016F_E1_Web"), outside: true },
        { src: at("2016F_E31_Web"), outside: true },
        { src: at("2016F_Kitchen"), outside: false },
      ]);
    });

    it("takes every design's pictures where none is the plan's", () => {
      expect(payloadGallery(page, BASE, ["Somewhere Else"]).map((g) => g.src)).toEqual([
        at("2016F_E1_Web"),
        at("2016F_E31_Web"),
        at("2016F_Kitchen"),
        at("2420F_E1_Web"),
      ]);
    });
  });
});
