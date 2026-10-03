import { describe, expect, it } from "vitest";
import { isMedallionPage, medallionTour, youtubeOf } from "@/lib/floorplans/extractors/medallion";

// Medallion's pages as they are served (2026-10-03).
const threeD = (id: string) =>
  `<div class="cfh-tour container"> <iframe  loading="lazy" allowfullscren="1" frameborder="0" class="aspect-2/3 md:aspect-video mx-auto lazyload" data-src="https://my.matterport.com/show/?m=${id}"></iframe></div>`;
const video = (src: string) =>
  `<section id="virtual-tour" class="bf-video"><div id="modal-virtual-tour-video" aria-hidden="true" class="modal bf-video__modal"><div class="modal__content">` +
  `<div class="video__embed&#x20;video__embed--inline&#x20;bf-video__embed&#x20;js-embed&#x20;js-embed--video" data-src="${src}" data-poster="https&#x3A;&#x2F;&#x2F;medallionhome.com&#x2F;wp-content&#x2F;uploads&#x2F;2026&#x2F;05&#x2F;Watercolor-Place.jpg" data-controls="1"></div></div></div></section>`;
const encoded = (url: string) => url.replace(/[:/?=&]/g, (c) => `&#x${c.charCodeAt(0).toString(16).toUpperCase()};`);
const footer = `<a class="SiteFooter__social-link" href="https://www.youtube.com/user/MedallionHomeFL" target="_blank">Youtube</a>`;

describe("Medallion's own tour", () => {
  it("is the 3D Tour's Matterport where the page has one, over its video (Boca Grande 2)", () => {
    const page = video(encoded("https://youtube.com/watch?v=Zy0EC8Nl5cw")) + threeD("9jPoUjsCaFU") + footer;
    expect(medallionTour(page)).toEqual({ tour: "https://my.matterport.com/show/?m=9jPoUjsCaFU" });
  });

  it("is the Virtual Tour's YouTube video where there is no Matterport (4324 Sea Marsh Place)", () => {
    const page = video(encoded("https://www.youtube.com/watch?v=Z5BqQj8_zms")) + footer;
    expect(medallionTour(page)).toEqual({ tour: "https://www.youtube.com/watch?v=Z5BqQj8_zms" });
  });

  it("is the video once its player is drawn", () => {
    const page = `<div id="modal-virtual-tour-video" class="modal"><div class="modal__content"><iframe src="https://www.youtube.com/embed/Z5BqQj8_zms?autoplay=1"></iframe></div></div>`;
    expect(medallionTour(page)).toEqual({ tour: "https://www.youtube.com/watch?v=Z5BqQj8_zms" });
  });

  it("is not a video that is only a file or another player (12422 Stonegate Trail, 12418 Stonegate Trail)", () => {
    expect(medallionTour(video(encoded("https://medallionhome.com/wp-content/uploads/2026/06/12422-Stonegate-Trl_compressed.mp4")))).toBeNull();
    expect(medallionTour(video(encoded("https://web-player.walkly.app/E5Pa1J75s6GSaxXkafrV/NrRMJ2vJrot9xalS9tfI/ww/logos")))).toBeNull();
  });

  it("is none where the page shows neither, and never the footer's channel (Barbados 2)", () => {
    expect(medallionTour(`<h1>Barbados 2</h1>${footer}`)).toBeNull();
  });
});

describe("a YouTube address", () => {
  it("is given one way however Medallion writes it", () => {
    for (const url of [
      "https://youtube.com/watch?v=Zy0EC8Nl5cw",
      "https://www.youtube.com/watch?v=Zy0EC8Nl5cw&t=3s",
      "https://youtu.be/Zy0EC8Nl5cw?si=Wb1gvyO-sliVvtw0",
      "https://youtube.com/watch?v=Zy0EC8Nl5cw?si=aRe1R0abvD0ffZJ6",
      "https://www.youtube.com/embed/Zy0EC8Nl5cw?autoplay=1",
    ]) {
      expect(youtubeOf(url)).toBe("https://www.youtube.com/watch?v=Zy0EC8Nl5cw");
    }
  });

  it("is not a channel or another host's", () => {
    expect(youtubeOf("https://www.youtube.com/user/MedallionHomeFL")).toBeNull();
    expect(youtubeOf("https://vimeo.com/123456789")).toBeNull();
  });
});

describe("Medallion's pages", () => {
  it("are medallionhome.com's alone", () => {
    expect(isMedallionPage("https://medallionhome.com/communities/the-laurels/plans/boca-grande-2/")).toBe(true);
    expect(isMedallionPage("https://www.medallionhome.com/community/the-laurels")).toBe(true);
    expect(isMedallionPage("https://www.ashtonwoods.com/tampa/oakfield-trails")).toBe(false);
    expect(isMedallionPage(null)).toBe(false);
  });
});
