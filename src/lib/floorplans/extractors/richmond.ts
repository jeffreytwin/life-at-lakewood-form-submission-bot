// Richmond American's plan pages, whose tours are videos (Jeff, 2026-10-10:
// "there are virtual tours - just in video form. I'd like to use the
// Youtube link if provided"). A plan page's gallery has three tabs:
// "Interactive Tours", ML3DS's interactive floor plans
// (secure.ml3ds-cloud.com/#/floorplan/560074), which are not tours;
// "Video", a YouTube walk-through of the model (The Ammolite at Estates at
// River's Edge: youtube.com/embed/PNbfr1zcjlg); and "Renderings". The
// video is drawn only once its tab is pressed, so the browser presses it
// and keeps what it showed (render.ts, keepVideos). A home's page has no
// tabs: its photo gallery ends with its plan's videos (14518 Banks Court,
// a Slate, shows the Slate's two), and the first is its tour, as on the
// plan's page. Every one is a walk-through of the plan ("The Slate Floor
// Plan by Richmond American"). Only Richmond's pages: a YouTube video is
// taken for a tour here and on Medallion's (medallion.ts), nowhere else.
// Pure.

import { youtubeOf } from "@/lib/floorplans/extractors/medallion";

/** Whether a page is Richmond American's. */
export function isRichmondPage(url: string | null | undefined): boolean {
  try {
    return /(^|\.)richmondamerican\.com$/i.test(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}

/** The address an opening tag loads, drawn or kept for the reader (data-src). */
const loads = (tag: string) =>
  [...tag.matchAll(/\b(?:data-)?src=["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/gi, "&").trim());

/**
 * The plan's tour: a tour on a host that serves tours where the page has
 * one (`tour3d`, found by the general reader), failing that the YouTube
 * video its "Video" tab plays, as the browser kept it or as it is drawn.
 * Null where the page shows neither, for the general reader to look.
 * Exported for tests.
 */
export function richmondTour(html: string, tour3d: string | null): { tour: string } | null {
  if (tour3d) return { tour: tour3d };
  const kept = [...html.matchAll(/<div\b[^>]*\bdata-gathered=["']video["'][^>]*>([\s\S]*?)<\/div>/gi)].map((m) => m[1]);
  for (const part of [...kept, html]) {
    for (const frame of part.matchAll(/<iframe\b[^>]*>/gi)) {
      const tour = loads(frame[0]).map(youtubeOf).find(Boolean);
      if (tour) return { tour };
    }
  }
  return null;
}
