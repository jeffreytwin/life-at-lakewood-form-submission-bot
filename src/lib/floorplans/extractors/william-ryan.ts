// William Ryan Homes' plan and home pages, read off the page's own data
// (Jeff, 2026-10-06: "it's only pulling in one picture per floor plan").
//
// A plan's page draws its gallery as a carousel that its scripts fill in:
// the markup carries no <img> of the plan at all, so the general reader
// kept only the picture on the community's card. Every picture is in the
// page's Next.js payload, though, as records like
//
//   {"id":1160464,"url":"https://storage.googleapis.com/william-ryan-homes-com-media/floorplan/24777/image/interior-1160464.jpg","seq":1}
//
// the carousel's first (elevations, then interiors), then the "Elevation
// Styles" block's elevations again. The address says whose picture it is
// and what of: floorplan/24777 is the plan at floor-plans/24777, qmi/19051
// the home at quick-move-ins/19051, and elevation-… an outside view. Only
// the page's own are taken: the division's and the community's banners
// (division/3/…, community/1325/…) and the brochure are not. Pure.

import type { PayloadImage } from "@/lib/floorplans/extractors/plan-page";

/** Whether a page is William Ryan's: its pictures are read by this module, not the general reader. */
export function isWilliamRyanPage(url: string | null | undefined): boolean {
  try {
    return /(^|\.)williamryanhomes\.com$/i.test(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}

/** A page's own folder in William Ryan's media: floor-plans/24777 → floorplan/24777. */
const PAGE_FOLDER: Record<string, string> = { "floor-plans": "floorplan", "quick-move-ins": "qmi" };

/** A picture in William Ryan's media, escaped as the payload writes it or not. */
const PICTURE =
  /https?:(?:\\?\/){2}storage\.googleapis\.com(?:\\?\/)william-ryan-homes-com-media(?:\\?\/)([a-z]+)(?:\\?\/)(\d+)(?:\\?\/)image(?:\\?\/)([a-z]+)-\d+\.(?:jpe?g|png|webp|avif)/gi;

/**
 * The pictures of a William Ryan plan's or home's page, in the order the
 * page carries them, each once, its elevations marked as outside views.
 * Empty for a page that is not a plan's or a home's. Exported for tests.
 */
export function williamRyanPictures(html: string, pageUrl: string): PayloadImage[] {
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    return [];
  }
  const page = path.match(/\/(floor-plans|quick-move-ins)\/(\d+)\/?$/i);
  if (!page) return [];
  const folder = PAGE_FOLDER[page[1].toLowerCase()];
  const id = page[2];

  const seen = new Set<string>();
  const out: PayloadImage[] = [];
  for (const m of html.matchAll(PICTURE)) {
    if (m[1].toLowerCase() !== folder || m[2] !== id) continue;
    const src = m[0].replace(/\\\//g, "/");
    if (seen.has(src)) continue;
    seen.add(src);
    out.push({ src, outside: m[3].toLowerCase() === "elevation" });
  }
  return out;
}
