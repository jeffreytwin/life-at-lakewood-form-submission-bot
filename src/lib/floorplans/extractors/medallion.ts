// Medallion Home's plan and home pages, whose tours are read off their own
// markup (Jeff, 2026-10-03). A page may show two: a "3D Tour" tab, a
// Matterport in a lazily loaded iframe (`.cfh-tour`), and a "Virtual Tour"
// video that opens in a modal (`.js-embed--video`, data-src a YouTube
// address). The Matterport is the better tour and is taken when there is
// one; a page with only the video is given the video, as 4324 Sea Marsh
// Place's "Harbour #226" walk-through. Only Medallion's pages: a YouTube
// video is not taken for a tour anywhere else. Pure.

/** Whether a page is Medallion Home's: its tours are read by this module, not the general reader. */
export function isMedallionPage(url: string | null | undefined): boolean {
  try {
    return /(^|\.)medallionhome\.com$/i.test(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}

const decoded = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/gi, "&")
    .trim();

/** The addresses an element's opening tag loads, drawn or still waiting (data-src). */
const loads = (tag: string) =>
  [...tag.matchAll(/\b(?:data-)?src=["']([^"']+)["']/gi)].map((m) => decoded(m[1]));

/** A Matterport's address as it is shown, or null. */
function matterportOf(url: string): string | null {
  const id = url.match(/^https?:\/\/my\.matterport\.com\/show\/?\?(?:[^#]*&)?m=([A-Za-z0-9]+)/i)?.[1];
  return id ? `https://my.matterport.com/show/?m=${id}` : null;
}

/**
 * A YouTube video's address as the site's other tours are given, or null.
 * Medallion writes them every way: "youtube.com/watch?v=Zy0EC8Nl5cw",
 * "youtu.be/Timu3LsZfdk?si=…", "watch?v=E2RDJdcogII?si=…", and once the
 * modal is opened, an embed.
 */
export function youtubeOf(url: string): string | null {
  const id =
    url.match(/^https?:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/i)?.[1] ??
    url.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/i)?.[1];
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/**
 * The page's own tour: the Matterport its "3D Tour" tab loads, failing
 * that the YouTube video its "Virtual Tour" plays. Null where the page
 * shows neither, for the general reader to look. Exported for tests.
 */
export function medallionTour(html: string): { tour: string } | null {
  // The 3D Tour tab: an iframe in `.cfh-tour`, its address in data-src until drawn.
  for (const block of html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bcfh-tour\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    for (const frame of block[1].matchAll(/<iframe\b[^>]*>/gi)) {
      const tour = loads(frame[0]).map(matterportOf).find(Boolean);
      if (tour) return { tour };
    }
  }
  // The Virtual Tour video: the modal's embed, or the player drawn in its place.
  for (const tag of html.matchAll(/<(?:div|iframe)\b[^>]*\b(?:js-embed--video|bf-video__embed|video__embed)\b[^>]*>/gi)) {
    const tour = loads(tag[0]).map(youtubeOf).find(Boolean);
    if (tour) return { tour };
  }
  for (const modal of html.matchAll(/<div\b[^>]*\bid=["']modal-virtual-tour-video["'][^>]*>([\s\S]*?)<\/iframe>/gi)) {
    const tour = [...modal[1].matchAll(/<iframe\b[^>]*>/gi)].flatMap((f) => loads(f[0])).map(youtubeOf).find(Boolean);
    if (tour) return { tour };
  }
  return null;
}
