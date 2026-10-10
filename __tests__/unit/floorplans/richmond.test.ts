import { describe, expect, it } from "vitest";
import { isRichmondPage, richmondTour } from "@/lib/floorplans/extractors/richmond";

// The Ammolite's gallery at Estates at River's Edge, as the browser draws it (2026-10-10).
const tabs =
  `<ul><li><button type="button" class="u-btn-clear nowrap "><span>Interactive Tours (2)</span></button></li>` +
  `<li><button type="button" class="u-btn-clear nowrap "><span>Video (1)</span></button></li>` +
  `<li><button type="button" class="u-btn-clear nowrap "><span>Renderings (2)</span></button></li></ul>`;
const interactive =
  `<div class="media__card__grid"><div class="media__card flex-column"><div class="video-container"><div class="u-absolute u-width-100 u-height-100 media__grid__overlay">Floor plan - layout 1</div>` +
  `<iframe frameborder="0" src="https://secure.ml3ds-cloud.com/#/floorplan/560074" title="The Ammolite - Spec 1" class="u-width-100 u-height-100" scroll-autoplay=""></iframe></div><small class="mt-3 mb-3">The Ammolite - Spec 1</small></div></div>`;
const videoShown =
  `<div class="media__card__grid"><div class="media__card flex-column"><div class="video-container">` +
  `<iframe frameborder="0" src="https://www.youtube.com/embed/PNbfr1zcjlg" title="The Ammolite" class="u-width-100 u-height-100" scroll-autoplay=""></iframe></div><small class="mt-3 mb-3">The Ammolite</small></div></div>`;
// What the browser keeps of the Video tab once another tab is showing (render.ts, keepVideos).
const videoKept = `<div data-gathered="video"><iframe data-src="https://www.youtube.com/embed/PNbfr1zcjlg" title="The Ammolite"></iframe></div>`;
const footer = `<a href="http://youtube.com/RAHomes" target="_blank">YouTube</a>`;

describe("Richmond's own tour", () => {
  it("is the Video tab's YouTube walk-through, as the browser kept it (The Ammolite)", () => {
    expect(richmondTour(`<h2>Gallery</h2>${tabs}${interactive}${videoKept}${footer}`, null)).toEqual({
      tour: "https://www.youtube.com/watch?v=PNbfr1zcjlg",
    });
  });

  it("is the video while its tab is the one showing", () => {
    expect(richmondTour(`<h2>Gallery</h2>${tabs}${videoShown}${footer}`, null)).toEqual({
      tour: "https://www.youtube.com/watch?v=PNbfr1zcjlg",
    });
  });

  it("is a tour on a host that serves tours where the page has one, over the video", () => {
    expect(richmondTour(`${tabs}${videoKept}`, "https://my.matterport.com/show/?m=abc123")).toEqual({
      tour: "https://my.matterport.com/show/?m=abc123",
    });
  });

  it("is the first of its plan's videos at the end of a home's gallery (14518 Banks Court, a Slate)", () => {
    const card = (id: string) =>
      `<div class="media__card flex-column"><div class="video-container"><iframe frameborder="0" src="https://www.youtube.com/embed/${id}" title="The Slate" class="u-width-100 u-height-100" scroll-autoplay=""></iframe></div><small class="mt-3 mb-3">The Slate</small></div>`;
    const photo = `<div class="media__card flex-column"><picture><img class="u-fit-cover" src="https://www.richmondamerican.com/content/plans/media-161674.webp" alt="Bedroom of the Slate floor plan" title="Bedroom"></picture><small>Bedroom</small></div>`;
    expect(richmondTour(`<div class="media__card__grid">${photo}${card("zzWRFz-O8-Q")}${card("bpogUSZtTpQ")}</div>${footer}`, null)).toEqual({
      tour: "https://www.youtube.com/watch?v=zzWRFz-O8-Q",
    });
  });

  it("is never the interactive floor plan, nor the footer's channel", () => {
    expect(richmondTour(`<h2>Gallery</h2>${tabs}${interactive}${footer}`, null)).toBeNull();
  });
});

describe("Richmond's pages", () => {
  it("are richmondamerican.com's alone", () => {
    expect(isRichmondPage("https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/ammolite/")).toBe(true);
    expect(isRichmondPage("https://medallionhome.com/communities/the-laurels/plans/boca-grande-2/")).toBe(false);
    expect(isRichmondPage(null)).toBe(false);
  });
});
