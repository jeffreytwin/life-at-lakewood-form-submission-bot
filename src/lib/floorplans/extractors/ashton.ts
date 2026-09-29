// Ashton Woods' plan and home pages, read off their own markup (Jeff,
// 2026-09-29: "we are still not grabbing the exteriors properly").
//
// Every page shows its pictures in two places, both opening the same
// photo viewer (#lazy-chp-gallery-modal):
//
//   - a block of tiles above the page's title, `.image-content__image`:
//     on a plan's page the model's photograph and its elevations —
//     Duval's "TAM_OTR50_Duval_ELEV_Day_2", "cms_Duval-P-Scheme-112",
//     "…-Q-Scheme-117", "…-R-Scheme-137" — and a first interior;
//   - "View Photos", `.photo-gallery__photo`: the interiors.
//
// The general reader took "View Photos" for the plan's gallery and so
// never looked above the title, and followed the page's pictures past
// it into the collections, the plan's homes and the community's other
// plans: Duval came through with one elevation of four, and the card of
// the home 9927 Hidden Hammock Loop ("cms_Duval-R-Right_Garage-Scheme_121")
// as a fifth. Here only the two blocks are taken, and, for a plan, the
// still of its 360° tour where that is a photograph of the model. Pure.

import { documentBase, imageAddress, type PageImage } from "@/lib/floorplans/extractors/plan-page";

/** Whether a page is Ashton Woods': their pictures are read by this module, not the general reader. */
export function isAshtonPage(url: string | null | undefined): boolean {
  try {
    return /(^|\.)ashtonwoods\.com$/i.test(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}

export interface AshtonPictures {
  /** The tiles above the title, in the page's order: a plan's outside and a first interior, a home's photos. */
  hero: PageImage[];
  /** "View Photos". A picture may be in both. */
  photos: PageImage[];
  /**
   * The still of the 360° tour, where it is a photograph: Duval's is its
   * kitchen ("TAM_OTR50_Duval_KITCH_2"), Teton's a picture made for the
   * tour ("cms_teton-virutal-tour-image"), and a home's page shows its
   * plan's model, not the home. The caller decides.
   */
  still: PageImage | null;
}

/** How far after a tile's opening its picture may be. */
const TILE_SPAN = 2500;

/**
 * The pictures of an Ashton Woods page: its tiles and its photo gallery,
 * each picture once. Null when the page has neither (not a plan's or a
 * home's page, or a page built another way), for the general reader to
 * read. Exported for tests.
 */
export function ashtonPictures(html: string, pageUrl: string): AshtonPictures | null {
  const base = documentBase(html, pageUrl);
  const absolute = (src: string) => {
    try {
      return new URL(src.replace(/&amp;/gi, "&"), base).href;
    } catch {
      return null;
    }
  };
  const picture = (src: string | null): PageImage | null => {
    const url = src ? absolute(src) : null;
    return url && !/\.svg(?:[?#]|$)/i.test(url) ? { src: url, alt: "" } : null;
  };
  const key = (image: PageImage) => image.src.replace(/[?#].*$/, "");
  const once = (images: PageImage[]) => images.filter((image, i) => images.findIndex((o) => key(o) === key(image)) === i);
  const tiles = (marker: RegExp): PageImage[] => {
    const out: PageImage[] = [];
    for (const m of html.matchAll(marker)) {
      const tag = html.slice(m.index ?? 0, (m.index ?? 0) + TILE_SPAN).match(/<img\b[^>]*>/i)?.[0];
      const image = tag ? picture(imageAddress(tag)) : null;
      if (image) out.push(image);
    }
    return once(out);
  };
  const hero = tiles(/class=["'][^"']*\bimage-content__image["'\s]/gi);
  const gallery = tiles(/class=["'][^"']*\bphoto-gallery__photo\b(?!__|-)/gi);
  if (!hero.length && !gallery.length) return null;
  const still = html.match(/class=["'][^"']*\bvirtual-tour__image\b[^>]*background-image:\s*url\(\s*['"]?([^'")]+)/i)?.[1] ?? null;
  const tour = picture(still);
  return { hero, photos: gallery, still: tour && !/tour/i.test(tour.src.replace(/[?#].*$/, "").replace(/^.*\//, "")) ? tour : null };
}
