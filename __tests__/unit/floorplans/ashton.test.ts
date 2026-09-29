import { describe, expect, it } from "vitest";
import { ashtonPictures, isAshtonPage } from "@/lib/floorplans/extractors/ashton";

// Duval in Oakfield Trails Signature, as its page draws it (2026-09-29).
const widen = (path: string, size = "w=1000&amp;h=760&amp;crop=yes&amp;quality=80") => `https://awh.widen.net/content/${path}?${size}`;
const tile = (path: string) => `
  <div> <button class="image-content__image-gallery-toggle" type="button" data-bs-target="#lazy-chp-gallery-modal" data-carousel-slide="0"></button>
  <div> <div class="image-content__image"> <picture>
    <source media="(max-width: 768px)" srcset="${widen(path, "w=570&amp;h=280")}">
    <source media="(min-width: 769px)" srcset="${widen(path)}">
    <img src="${widen(path)}" alt="" />
  </picture> </div> </div> </div>`;
const photo = (n: number, path: string) => `
  <a class="photo-gallery__photo photo-gallery__photo--item-${n}" href="#" data-bs-target="#lazy-chp-gallery-modal" data-carousel-slide="${n - 1}">
    <picture><img src="${widen(path, "w=1024&amp;h=768&amp;crop=yes")}" alt="" /></picture></a>`;

const page = `
  <img src="https://www.ashtonwoods.com/assets/nebocms_ashton/icons/garage-primary-0f73.svg" alt="icon">
  ${tile("12r0stvyo9/jpeg/TAM_OTR50_Duval_ELEV_Day_2.jpg")}
  ${tile("3xbvr9dfb9/webp/cms_Duval-P-Scheme-112.jpg_gk8azNM.jpg")}
  ${tile("gchdkmp73g/webp/cms_Duval-Q-Scheme-117.jpg_o0XGb26.jpg")}
  ${tile("qyjxjvsp20/webp/cms_Duval-R-Scheme-137.jpg_12G0z2P.jpg")}
  ${tile("ujmba0cs37/jpeg/TAM_OTR50_Duval_KITCH_1.jpg")}
  <h1>Duval in Oakfield Trails Signature</h1>
  <img src="${widen("bvpzwnbzxa/web/cms_Newsweek_US-Trustworthy_2026_Hor-1.png_89zbXJ5.png")}" alt="Misc Image">
  <div class="virtual-tour__image js-iframe-url__trigger" style="background-image: url('${widen("xptxuiagfs/jpeg/TAM_OTR50_Duval_KITCH_2.jpg")}');"></div>
  <section class="module photo-gallery"><h3 class="photo-gallery__title">View Photos</h3>
  <div class="photo-gallery__photos">
    ${photo(1, "ujmba0cs37/jpeg/TAM_OTR50_Duval_KITCH_1.jpg")}
    ${photo(2, "oxibylypmk/jpeg/TAM_OTR50_Duval_FAM_2.jpg")}
    ${photo(3, "mkmweghjpk/jpeg/TAM_OTR50_Duval_LOFT.jpg")}
  </div></section>
  <h3>Oakfield Trails Signature Duval Quick Move-Ins</h3>
  <img src="${widen("ordowkn22d/jpeg/cms_Duval-R-Right_Garage-Scheme_121.jpg_6P1eXWY.jpg")}" alt="">
  <h3>View More Home Plans in Oakfield Trails Signature</h3>
  <img src="${widen("1l5y0ghfrm/webp/cms_Plant-Q-Scheme-128.jpg_7PmyJZD.jpg")}" alt="">`;

const file = (url: string) => url.replace(/^.*\//, "").replace(/\?.*$/, "");

describe("an Ashton Woods page's pictures (Duval, Jeff 2026-09-29)", () => {
  const got = ashtonPictures(page, "https://www.ashtonwoods.com/tampa/oakfield-trails-signature/signature-duval")!;

  it("takes the tiles above the title: the model's photograph and every elevation", () => {
    expect(got.hero.map((i) => file(i.src))).toEqual([
      "TAM_OTR50_Duval_ELEV_Day_2.jpg",
      "cms_Duval-P-Scheme-112.jpg_gk8azNM.jpg",
      "cms_Duval-Q-Scheme-117.jpg_o0XGb26.jpg",
      "cms_Duval-R-Scheme-137.jpg_12G0z2P.jpg",
      "TAM_OTR50_Duval_KITCH_1.jpg",
    ]);
    expect(got.hero[1].src).toBe("https://awh.widen.net/content/3xbvr9dfb9/webp/cms_Duval-P-Scheme-112.jpg_gk8azNM.jpg?w=1000&h=760&crop=yes&quality=80");
  });

  it("takes View Photos and the tour's still, and nothing of the homes, the other plans, the badge or the icons", () => {
    expect(got.photos.map((i) => file(i.src))).toEqual(["TAM_OTR50_Duval_KITCH_1.jpg", "TAM_OTR50_Duval_FAM_2.jpg", "TAM_OTR50_Duval_LOFT.jpg"]);
    expect(file(got.still!.src)).toBe("TAM_OTR50_Duval_KITCH_2.jpg");
  });

  it("does not take a still made for the tour (Teton)", () => {
    const teton = `${tile("nbsfyrujod/webp/cms_Teton-R-Scheme-136.jpg_ZD9K1W5.jpg")}
      <div class="virtual-tour__image" style="background-image: url('${widen("iiavudnrfl/webp/cms_teton-virutal-tour-image.png_12eKLJL.png")}');"></div>`;
    const read = ashtonPictures(teton, "https://www.ashtonwoods.com/tampa/oakfield-trails-signature/signature-teton")!;
    expect(read.hero.map((i) => file(i.src))).toEqual(["cms_Teton-R-Scheme-136.jpg_ZD9K1W5.jpg"]);
    expect(read.photos).toEqual([]);
    expect(read.still).toBeNull();
  });

  it("leaves a page built another way to the general reader", () => {
    expect(ashtonPictures(`<h2>Gallery</h2><img src="https://example.com/a.jpg">`, "https://www.ashtonwoods.com/x")).toBeNull();
  });

  it("knows Ashton Woods' pages by their address", () => {
    expect(isAshtonPage("https://www.ashtonwoods.com/tampa/oakfield-trails-traditional/duval")).toBe(true);
    expect(isAshtonPage("https://www.kolterhomes.com/ashtonwoods.com")).toBe(false);
    expect(isAshtonPage(null)).toBe(false);
  });
});
