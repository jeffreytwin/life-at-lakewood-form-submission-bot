// What a plan page is divided into, and which of its pictures are the
// plan's own.
//
// Claude reads a page's words well and its pictures unreliably: on Stock's
// plan pages it kept the four elevations and a still off a virtual tour and
// left every interior behind — and did it differently on every plan, five
// pictures for one, eleven for the next (Jeff, 2026-09-22). Which pictures
// belong is not a judgement call, though: the page says so with its
// headings. Stock's run "Elevations", "Virtual Tours", then "Galleries"
// with an <h4> naming each gallery, usually for the community or the
// designer who furnished it ("Wild Blue at Waterside — Interior by Dan Rak
// Design") rather than for the plan, which is what made Claude pass them
// over. So the galleries are read off the markup instead: the first one is
// the plan's (Jeff: "if there is more than one gallery, pick the first
// one"), the later ones and the tour stills are not.
//
// A gallery is then followed past what the page draws: Stock shows five
// thumbnails over a "+25 MORE" button while its framework ships all thirty
// in the page's own data (wholeGallery).
//
// Nothing here is Stock-specific: a page with no gallery headings yields no
// gallery, a page that keeps no more than it draws yields what it draws,
// and either way the plan keeps exactly what it had.

import { classifyRoom } from "@/lib/floorplans/gallery-order";

export interface PageImage {
  src: string;
  alt: string;
}

export interface PageSection {
  /** The heading that opens the section; "" for the markup before the first one. */
  heading: string;
  /** 1 to 6 for h1 to h6; 0 for the page's opening. */
  level: number;
  /** The headings this section sits under, outermost first. */
  ancestors: string[];
  /** The images between this heading and the next, in page order. */
  images: PageImage[];
}

/** An attribute's value, in whichever quotes it is written: alt="Owner's Suite" holds an apostrophe. */
const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2] ?? null) : null;
};

/**
 * The largest picture a responsive image offers, out of the set it lists:
 * `photo-400.jpg 400w, photo-1600.jpg 1600w`. A gallery whose pictures
 * carry only a set and no src reads as no pictures at all otherwise.
 * Exported for tests.
 */
export function largestInSrcSet(value: string | null): string | null {
  if (!value) return null;
  let best: { url: string; size: number } | null = null;
  for (const entry of value.split(",")) {
    const [url, measure] = entry.trim().split(/\s+/);
    if (!url) continue;
    const size = measure ? parseFloat(measure) || 0 : 0;
    if (!best || size >= best.size) best = { url, size };
  }
  return best?.url ?? null;
}

/**
 * A picture a page writes as two halves for its script to join rather
 * than as a src: Pulte's carousels give each slide
 * data-dam="//res.cloudinary.com/…/image/fetch/" and
 * data-name="https://pultegroup.picturepark.com/Go/…", with the sizes it
 * draws at in data-size and data-transformations (Daylen at Riversong,
 * 2026-09-23). Joined here at the largest size the page itself asks for,
 * which is an address the site uses. Exported for tests.
 */
export function joinedPicture(tag: string): string | null {
  const dam = attr(tag, "data-dam");
  const name = attr(tag, "data-name");
  if (!dam || !name || !/^https?:\/\//i.test(name)) return null;
  const base = (dam.startsWith("//") ? `https:${dam}` : dam).replace(/\/?$/, "/");
  let sizes: Record<string, string> = {};
  try {
    sizes = JSON.parse((attr(tag, "data-size") ?? "{}").replace(/&quot;/g, '"'));
  } catch {
    // no sizes: the transformations alone
  }
  const widest = Object.keys(sizes)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a)[0];
  const transforms = [widest ? sizes[String(widest)] : null, (attr(tag, "data-transformations") ?? "").replace(/\bw_auto\b/, `w_${widest ?? 1920}`)]
    .filter(Boolean)
    .join(",");
  return `${base}${transforms ? `${transforms}/` : ""}${name}`;
}

/**
 * What a page shows while a picture loads, never a picture of the home:
 * Ashton Woods' "loading-dot-pattern-….gif" (alt "Loading...") stood in a
 * home's gallery (2026-09-23).
 */
const PLACEHOLDER = /(?:^|[/_-])(?:loading|loader|spinner|placeholder|lazy-?load|blank|transparent|spacer)(?:[._-][^/]*)?\.(?:gif|svg|png)(?:[?#]|$)/i;

/**
 * The address an <img> shows, however it is written: its src, or where a
 * lazy page keeps it until it scrolls into view (data-src, Kolter's
 * data-lazy-src, D.R. Horton's data-lazy, data-original), or the largest
 * of the sizes it offers, or two halves for a script to join (Pulte).
 */
export function imageAddress(tag: string, opts: { joined?: boolean } = {}): string | null {
  const plain = [attr(tag, "src"), attr(tag, "data-src"), attr(tag, "data-lazy-src"), attr(tag, "data-lazy"), attr(tag, "data-original")].find(
    (u): u is string => Boolean(u) && !/^data:/i.test(u!) && !PLACEHOLDER.test(u!)
  );
  return (
    plain ||
    largestInSrcSet(attr(tag, "srcset") || attr(tag, "data-srcset") || attr(tag, "data-lazy-srcset")) ||
    (opts.joined === false ? null : joinedPicture(tag))
  );
}

/**
 * The pictures a page opens in a lightbox, which marks them as a gallery
 * outright: Fancybox's data-fancybox="<group>", each with the full-size
 * picture in data-src (or href) and its caption in data-caption. Kolter's
 * plan pages keep every model photo this way — "Entry", "Dining room",
 * "Kitchen" — under no heading at all, and the run kept one picture of
 * thirty (Woodland Preserve, 2026-09-23). The first group of three or more
 * is the plan's, and a group named for elevations, exteriors or floor plans
 * is too; a picture captioned or named as a floor plan is a drawing.
 * Pure; exported for tests.
 */
export function lightboxGallery(html: string, pageUrl: string): { first: PageImage[]; drawings: string[] } {
  const baseUrl = documentBase(html, pageUrl);
  const groups = new Map<string, PageImage[]>();
  for (const m of html.matchAll(/<[a-z][a-z0-9]*\b[^>]*\sdata-fancybox\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
    const address = attr(m[0], "data-src") || attr(m[0], "href");
    if (!address || !/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(address.replace(/%2E/gi, "."))) continue;
    let src: string;
    try {
      src = new URL(address, baseUrl).href;
    } catch {
      continue;
    }
    const caption = readable(attr(m[0], "data-caption") ?? attr(m[0], "title") ?? "");
    const group = groups.get(m[1]) ?? [];
    group.push({ src, alt: caption });
    groups.set(m[1], group);
  }
  const named = /elev|exterior|floor|plan/i;
  const firstName = [...groups.entries()].find(([, images]) => images.length >= 3)?.[0];
  const seen = new Set<string>();
  const first: PageImage[] = [];
  const drawings: string[] = [];
  for (const [name, images] of groups) {
    if (name !== firstName && !named.test(name)) continue;
    for (const image of images) {
      const key = pictureKey(image.src);
      if (seen.has(key)) continue;
      seen.add(key);
      if (/\bfloor ?plans?\b/i.test(image.alt) || /floor[\s_-]?plan|[_-]fp[_.-]/i.test(decodeURIComponent(image.src))) drawings.push(image.src);
      else first.push(image);
    }
  }
  return { first, drawings };
}

/** A heading's words, with the spans, comments and entities a framework leaves in it. */
function readable(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&#x0*27;|&apos;|&rsquo;|&#8217;|’/gi, "'")
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The page as its headings divide it. Each section holds the images drawn
 * between its heading and the next, and remembers the headings it sits
 * under, so a gallery named for its designer is still known to be a
 * gallery.
 */
/**
 * The address a page's relative links are relative to: its own, unless it
 * names another in a <base> tag. Richmond American's Blazor pages declare
 * <base href="/"> and write "florida/tampa-new-homes/…/fraser/", and read
 * against the page's own address every plan's link came out doubled —
 * ".../estates-at-rivers-edge/florida/tampa-new-homes/...", a page that
 * says "Not found" — so no plan page was ever read (2026-09-23).
 */
export function documentBase(html: string, pageUrl: string): string {
  const href = html.match(/<base\b[^>]*?\shref\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!href) return pageUrl;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return pageUrl;
  }
}

export function sectionsOf(html: string, pageUrl: string): PageSection[] {
  const baseUrl = documentBase(html, pageUrl);
  const absolute = (url: string) => {
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  };
  interface Mark {
    at: number;
    heading?: { level: number; text: string };
    image?: PageImage;
  }
  const marks: Mark[] = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    marks.push({ at: m.index ?? 0, heading: { level: Number(m[1]), text: readable(m[2]) } });
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = imageAddress(m[0]);
    if (!src || src.startsWith("data:")) continue;
    marks.push({ at: m.index ?? 0, image: { src: absolute(src), alt: attr(m[0], "alt") ?? "" } });
  }
  marks.sort((a, b) => a.at - b.at);

  const sections: PageSection[] = [{ heading: "", level: 0, ancestors: [], images: [] }];
  const open: { level: number; text: string }[] = [];
  for (const mark of marks) {
    if (mark.heading) {
      while (open.length && open[open.length - 1].level >= mark.heading.level) open.pop();
      sections.push({
        heading: mark.heading.text,
        level: mark.heading.level,
        ancestors: open.map((h) => h.text),
        images: [],
      });
      open.push(mark.heading);
    } else if (mark.image) {
      sections[sections.length - 1].images.push(mark.image);
    }
  }
  return sections;
}

/** Headings that open a plan's photo galleries. */
const GALLERY_HEADING = /\b(galler(?:y|ies)|photos?|images)\b/i;

/** Headings whose pictures are the still on a link, not photographs of the home. */
const TOUR_HEADING = /\b(virtual tours?|tours?|3-?d|walk-?throughs?|videos?|matterport)\b/i;

const names = (section: PageSection) => [section.heading, ...section.ancestors];
const isTour = (section: PageSection) => names(section).some((h) => TOUR_HEADING.test(h));
const isGallery = (section: PageSection) => names(section).some((h) => GALLERY_HEADING.test(h));

/**
 * The pictures under a heading that names the house's outside —
 * "Elevations", "Exteriors" — which a page keeps apart from its gallery:
 * Stock's plan pages run Elevations, Virtual Tours, then Galleries
 * (2026-09-22). Read here so they are kept whether or not Claude lists
 * them. Pure; exported for tests.
 */
export function elevationPictures(html: string, pageUrl: string): PageImage[] {
  const seen = new Set<string>();
  const out: PageImage[] = [];
  for (const section of sectionsOf(html, pageUrl)) {
    // A heading for the section, "Elevations" or "Exteriors" — not one
    // slide's caption: Pulte captions each slide "Elevation FM1", and what
    // followed those captions down the page was the community's pictures
    // (Riversong, 2026-09-23).
    if (isTour(section) || !names(section).some((h) => /\b(elevations|exteriors)\b|^\s*(elevation|exterior)s?\s*$/i.test(h))) continue;
    for (const image of section.images) {
      const key = pictureKey(image.src);
      if (seen.has(key) || /\.svg(?:[?#]|$)/i.test(image.src)) continue;
      seen.add(key);
      out.push(image);
    }
  }
  return out;
}

export interface PlanPageGallery {
  /** The first gallery's pictures, in the order the page shows them. Empty when the page has no gallery. */
  first: PageImage[];
  /** Pictures that appear only in a later gallery or among the virtual tours. */
  drop: Set<string>;
}

/** A picture URL as a page writes it: bare, or with the slashes a script payload escapes. */
const PICTURE_URL = /https?:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+?\.(?:jpe?g|png|webp|avif|gif)(?![a-z0-9])/gi;

/**
 * The rest of a gallery, from where the page keeps it rather than draws it.
 * Stock draws five thumbnails over a "+25 MORE" button, so a gallery of
 * thirty arrived as five (Jeff, 2026-09-22) — but its framework ships the
 * whole gallery in the page's own data, one run of picture URLs per
 * gallery, in the order the gallery shows them — each picture listed at
 * every size it keeps, which is one picture, not several.
 *
 * So the run that opens with the gallery's first picture is followed as
 * far as it goes, and the longest such run wins: the drawn thumbnails are
 * a run of five, the data holds the run of thirty. It ends at the first
 * picture the page draws somewhere else — the next gallery, an elevation,
 * the floor plan drawing — or at anything that is not a picture of this
 * builder's, which is what separates one gallery's run from the next.
 */
function wholeGallery(html: string, first: PageImage[], elsewhere: Set<string>): PageImage[] {
  if (!first.length) return first;
  const anchor = first[0].src;
  let origin: string;
  try {
    origin = new URL(anchor).origin;
  } catch {
    return first;
  }

  const urls = [...html.matchAll(PICTURE_URL)].map((m) => m[0].replace(/\\/g, ""));
  let longest: string[] = [];
  for (let start = 0; start < urls.length; start++) {
    if (pictureKey(urls[start]) !== pictureKey(anchor)) continue;
    const run: string[] = [];
    const seen = new Set<string>();
    for (let i = start; i < urls.length; i++) {
      const url = urls[i];
      const key = pictureKey(url);
      if (!url.startsWith(origin) || elsewhere.has(key)) break;
      if (!seen.has(key)) {
        seen.add(key);
        run.push(url);
      }
    }
    if (run.length > longest.length) longest = run;
  }
  if (longest.length <= first.length) return first;

  const drawn = new Map(first.map((image) => [pictureKey(image.src), image] as const));
  return longest.map((src) => drawn.get(pictureKey(src)) ?? { src, alt: "" });
}

/**
 * The plan's own gallery, whole, and the pictures that are somebody
 * else's. A picture that also appears outside a later gallery — the same
 * photograph used as a tour's still and as an elevation, say — is not
 * dropped.
 */
export function firstGallery(html: string, baseUrl: string): PlanPageGallery {
  const sections = sectionsOf(html, baseUrl);
  const galleries = sections.filter((s) => s.images.length && isGallery(s) && !isTour(s));
  const later = new Set(galleries.slice(1));
  const kept = new Set<string>();
  const drop = new Set<string>();
  for (const section of sections) {
    const unwanted = isTour(section) || later.has(section);
    for (const image of section.images) (unwanted ? drop : kept).add(image.src);
  }
  for (const src of kept) drop.delete(src);

  const drawn = galleries[0]?.images ?? [];
  // Everything the page draws that is not this gallery's: where the run ends.
  const mine = new Set(drawn.map((image) => pictureKey(image.src)));
  const elsewhere = new Set<string>();
  for (const section of sections) {
    for (const image of section.images) {
      const key = pictureKey(image.src);
      if (!mine.has(key)) elsewhere.add(key);
    }
  }
  return { first: wholeGallery(html, drawn, elsewhere), drop };
}

/**
 * The plan's photos where a page shows them as a carousel of captioned
 * slides instead of under a gallery heading: each picture followed by a
 * heading that repeats its alt text. Pulte's plan pages are built this way
 * (Daylen at Riversong, 2026-09-23): twenty-two slides, "Daylen Exterior",
 * "Designer Kitchen", "Owner's Bath", "Elevation FM1", under no heading
 * that says gallery — and the same page carries every other plan's
 * carousel further down, so only the first carousel is the plan's.
 *
 * A row of cards for other plans is built the same way (a picture, then a
 * heading with the plan's name), so a carousel counts only when most of
 * its captions name a room or a view of the house. A slide a carousel
 * repeats to loop is one picture. Pure; exported for tests.
 */
export function captionedCarousel(html: string, pageUrl: string, planName?: string): PlanPageGallery {
  const baseUrl = documentBase(html, pageUrl);
  const absolute = (url: string) => {
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  };
  type Mark = { at: number; heading?: string; image?: PageImage };
  const marks: Mark[] = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) marks.push({ at: m.index ?? 0, heading: readable(m[2]) });
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = imageAddress(m[0]);
    if (!src || src.startsWith("data:")) continue;
    marks.push({ at: m.index ?? 0, image: { src: absolute(src), alt: readable(attr(m[0], "alt") ?? "") } });
  }
  marks.sort((a, b) => a.at - b.at);

  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const runs: PageImage[][] = [];
  let run: PageImage[] = [];
  for (let i = 0; i < marks.length; i++) {
    const image = marks[i].image;
    const caption = marks[i + 1]?.heading;
    if (image && image.alt && caption !== undefined && same(caption, image.alt)) {
      run.push(image);
      i++; // the caption
    } else if (image || (marks[i].heading !== undefined && run.length)) {
      if (run.length) runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);

  const carousels = runs
    .map((candidate) => {
      const seen = new Set<string>();
      return candidate.filter((image) => {
        const key = pictureKey(image.src);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })
    .filter((slides) => slides.length >= 4 && slides.filter((image) => classifyRoom(image.alt)).length * 2 >= slides.length);
  // The plan's own carousel names the plan ("Daylen Exterior"); a carousel
  // of the community's amenities, which a page can carry first, does not
  // (Pulte's Riversong, 2026-09-23).
  const named = planName ? new RegExp(`\\b${planName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : null;
  const first = (named && carousels.find((slides) => slides.some((image) => named.test(image.alt)))) || carousels[0] || [];
  // The other carousels' pictures are other plans': not to be taken from
  // anyone else's reading of the page either.
  const mine = new Set(first.map((image) => pictureKey(image.src)));
  const drop = new Set<string>();
  if (first.length) {
    for (const other of runs) for (const image of other) if (!mine.has(pictureKey(image.src))) drop.add(image.src);
  }
  return { first, drop };
}

/** A drawing's address, bare or with a payload's escaped slashes; floor plans are often vectors. */
const DRAWING_URL = /https?:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+?\.(?:jpe?g|png|webp|avif|gif|svg)(?![a-z0-9])/gi;

/** A name's words: "Grand Sabal" is grand, sabal; "hbt-fl-fp-mooring" is hbt, fl, fp, mooring. */
const wordsOf = (text: string) =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Words a plan's name carries that no file would: "Plan 1272" is 1272. */
const GENERIC_NAME_WORD = /^(plan|the|model|home|homes|design|series|residence)$/;
const DRAWING_WORD = /^(fp|floorplans?|flrpln|blueprints?)$/;

/**
 * The pictures of the first block the page names a gallery ("model-gallery",
 * "plan-gallery", "photo-gallery") that holds three or more, in order. Dream
 * Finders titles its plan gallery "Floor Plan Gallery" in a <div>, not a
 * heading, and captions each slide "Slide 1", "Slide 2" — nothing the other
 * readers can place — and the run kept five of Haven's twenty-four (Bungalow
 * Walk, 2026-09-23). A block named for the community, its amenities or the
 * area is not the plan's. Pure; exported for tests.
 */
export function namedGallery(html: string, pageUrl: string): PageImage[] {
  const baseUrl = documentBase(html, pageUrl);
  for (const open of html.matchAll(/<(div|section|ul)\b[^>]*\b(?:id|class)\s*=\s*["']([^"']*\bgallery\b[^"']*|[^"']*[-_]gallery\b[^"']*|[^"']*\bgallery[-_][^"']*)["'][^>]*>/gi)) {
    if (/communit|amenit|lifestyle|neighbou?rhood|footer|\bnav\b/i.test(open[2])) continue;
    const tag = open[1].toLowerCase();
    const start = (open.index ?? 0) + open[0].length;
    // The block runs to the tag that closes it.
    const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    pattern.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        end = m.index;
        break;
      }
    }
    const seen = new Set<string>();
    const images: PageImage[] = [];
    for (const m of html.slice(start, end).matchAll(/<img\b[^>]*>/gi)) {
      const src = imageAddress(m[0]);
      if (!src || src.startsWith("data:")) continue;
      let url: string;
      try {
        url = new URL(src.replace(/&amp;/gi, "&"), baseUrl).href;
      } catch {
        continue;
      }
      if (seen.has(pictureKey(url))) continue;
      seen.add(pictureKey(url));
      images.push({ src: url, alt: readable(attr(m[0], "alt") ?? "") });
    }
    if (images.length >= 3) return images;
  }
  return [];
}

/** A heading that is only "Floor Plan(s)", as a plan's page heads its drawing (Stock). */
const DRAWING_HEADING = /^\s*(?:the\s+)?floor\s*-?\s*plans?\s*$/i;
/** A class that says what it holds is the floor plan: "sd-ov__floorplan", "sd-ov__fp-img" (SimplyDwell). */
const DRAWING_CLASS = /floor[-_]?plan|(?:^|[_-])fp[-_]?(?:img|image|drawing)\b/i;
/** …but not a list of other plans ("related-floorplans", "floorplan-card"). */
const OTHER_PLANS_CLASS = /related|other|similar|more|card|list|grid|carousel|slider|nav|menu/i;

/** A page's own furniture beside a drawing: Kolter puts ".../images/svg/sketch.svg" in its floor plan box (2026-09-23). */
const UI_PICTURE = /\/(?:icons?|svg|sprites?)\/|(?:^|[\/_-])(?:icon|sketch|logo|sprite|arrow|close|zoom|expand|play|download|print)[^\/]*\.(?:svg|png|gif)(?:[?#]|$)/i;
/** A picture drawn smaller than a drawing could be read at. */
const tiny = (tag: string) => [attr(tag, "width"), attr(tag, "height")].some((v) => v != null && /^\d+$/.test(v) && Number(v) < 80);

/**
 * The floor plan drawings a plan's page marks as such in its markup: the
 * pictures under a heading that is only "Floor Plan" (Stock: "<h2>Floor
 * Plan</h2>" over "Covington III floor plan"), or a picture whose own
 * class or its box's says it is the floor plan (SimplyDwell: "sd-ov__fp-img"
 * in "sd-ov__floorplan"). Read off the markup, they are the same every
 * run; Claude, reading the page's words, reported Stock's for some plans
 * one night and others the next (2026-09-23). Pure; exported for tests.
 */
export function drawingsMarked(html: string, pageUrl: string): string[] {
  const baseUrl = documentBase(html, pageUrl);
  const found: string[] = [];
  const take = (tag: string) => {
    const src = imageAddress(tag);
    if (!src || src.startsWith("data:") || found.length >= 6 || UI_PICTURE.test(src) || tiny(tag)) return;
    try {
      const url = new URL(src.replace(/&amp;/gi, "&"), baseUrl).href;
      if (!found.includes(url)) found.push(url);
    } catch {
      // not an address
    }
  };
  // Under a heading that is only "Floor Plan", to the next heading.
  for (const m of html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    if (!DRAWING_HEADING.test(readable(m[2].replace(/<[^>]+>/g, " ")))) continue;
    const from = (m.index ?? 0) + m[0].length;
    const next = html.slice(from).search(/<h[1-4]\b/i);
    const block = html.slice(from, next < 0 ? from + 20_000 : from + Math.min(next, 20_000));
    for (const img of block.matchAll(/<img\b[^>]*>/gi)) take(img[0]);
  }
  // A picture its own class, or its box's, calls the floor plan.
  const marked = (classes: string | null) =>
    (classes ?? "").split(/\s+/).some((c) => DRAWING_CLASS.test(c) && !OTHER_PLANS_CLASS.test(c));
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const before = html.slice(Math.max(0, (m.index ?? 0) - 300), m.index ?? 0);
    const box = [...before.matchAll(/<(?:div|figure|picture|a|button|span)\b[^>]*\bclass=["']([^"']*)["'][^>]*>/gi)].pop()?.[1] ?? null;
    if (marked(attr(m[0], "class")) || marked(box)) take(m[0]);
  }
  return found;
}

/**
 * The floor plan drawings a page carries for this plan, found by their
 * names: a file or folder that says it is a floor plan ("fp", "floorplan",
 * "floor-plan") and a file named for the plan. Homes by Towne keeps each
 * plan's drawing at ".../uploads/floorplan/hbt-fl-shellstone-waterside-fp-
 * mooring.jpg" behind a "Floor Plan" tab, and Claude, reading the page's
 * words, reported it for three plans of seventeen (2026-09-23). A drawing
 * named for another plan is never taken, and neither is one named for
 * none. Pure; exported for tests.
 */
export function drawingsNamed(html: string, pageUrl: string, planNames: (string | null | undefined)[]): string[] {
  const names = planNames
    .map((name) => wordsOf(name ?? "").filter((w) => !GENERIC_NAME_WORD.test(w)))
    .filter((words) => words.join("").length >= 3);
  if (!names.length) return [];
  const baseUrl = documentBase(html, pageUrl);
  const found = new Map<string, string>();
  for (const m of html.matchAll(DRAWING_URL)) {
    let url: string;
    let parts: string[];
    try {
      url = new URL(m[0].replace(/\\\//g, "/").replace(/\\/g, ""), baseUrl).href;
      parts = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);
    } catch {
      continue;
    }
    const file = wordsOf((parts.pop() ?? "").replace(/\.[a-z0-9]+$/i, ""));
    const said = [...file, ...parts.flatMap(wordsOf)];
    const saysDrawing = said.some((w, i) => DRAWING_WORD.test(w) || (w === "floor" && /^plans?$/.test(said[i + 1] ?? "")));
    if (!saysDrawing) continue;
    const forThisPlan = names.some((words) => words.every((w) => file.includes(w)) || file.includes(words.join("")));
    if (!forThisPlan) continue;
    const key = pictureKey(fullSize(url, html));
    if (!found.has(key)) found.set(key, fullSize(url, html));
  }
  return [...found.values()];
}

/**
 * The photographs a page names for this plan: pictures whose address
 * carries the plan's name as a word of its own. Perry draws a plan's
 * elevations only once the page has run its scripts, each a picture
 * captioned into its own address — ".../l_text:…DESIGN 2016F E-31…" — with
 * an alt text that names only the community (2026-09-23). A floor plan
 * drawing is left to the drawings. Pure; exported for tests.
 */
export function picturesNamedFor(html: string, pageUrl: string, planNames: (string | null | undefined)[]): string[] {
  const names = planNames
    .map((name) => wordsOf(name ?? "").filter((w) => !GENERIC_NAME_WORD.test(w)))
    .filter((words) => words.join("").length >= 3);
  if (!names.length) return [];
  const found = new Map<string, string>();
  for (const section of sectionsOf(html, pageUrl)) {
    for (const image of section.images) {
      let said: string[];
      try {
        said = wordsOf(decodeURIComponent(new URL(image.src).pathname));
      } catch {
        continue;
      }
      if (said.some((w) => DRAWING_WORD.test(w)) || /\.svg(?:[?#]|$)/i.test(image.src)) continue;
      if (!names.some((words) => words.every((w) => said.includes(w)))) continue;
      const key = pictureKey(image.src);
      if (!found.has(key)) found.set(key, image.src);
    }
  }
  return [...found.values()];
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The sizes a media store keeps one picture at, largest first. */
const SIZES = ["lg", "md", "sm"] as const;
const SIZED = /^(.+)_(?:sm|md|lg)(\.[a-z0-9]+)$/i;
/** The other spelling: "media-161663-thumbnail.webp" beside "media-161663.webp" (Richmond American). */
const THUMB = /^(.+)-thumbnail(\.[a-z0-9]+)$/i;

/**
 * One photograph, however a site spells it. Stock's data lists every
 * gallery picture as both "<id>_sm.jpg" and "<id>_md.jpg"; Richmond puts
 * "media-180528.jpg" at the top of a plan's page and
 * "media-180528.webp" in its gallery, and that is the same elevation
 * twice — once at the front of the gallery and once at the end of it
 * (Jeff, 2026-09-22). So the size, the thumbnail mark and the format all
 * come off.
 */
export function pictureKey(src: string): string {
  // A picture an image service fetches and resizes is the picture it
  // fetches, whatever size it is asked for: Pulte's are
  // res.cloudinary.com/…/image/fetch/ar_1.5,c_fill,w_768/https://pultegroup.picturepark.com/….
  const fetched = src.match(/\/image\/fetch\/(?:[^/]*\/)*?(https?:\/\/?[^/].*)$/i)?.[1];
  if (fetched) return pictureKey(fetched.replace(/^(https?:)\/(?!\/)/i, "$1//"));
  // And a picture uploaded to one is its public id (cloudinaryUpload).
  const uploaded = cloudinaryUpload(src);
  if (uploaded) return uploaded;
  // And so is one whose address it carries written in base64: Adams draws
  // a plan's front at ".../adamshomes.com/aHR0cHM6Ly9zMy…/exact/w1200"
  // and again at ".../<the same>/webp/30" (2026-09-23).
  const carried = src.match(/\/(aHR0c[A-Za-z0-9+_-]*={0,2})(?=\/|$)/)?.[1];
  if (carried) {
    const decoded = Buffer.from(carried.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    if (/^https?:\/\/[^\s]+$/.test(decoded)) return pictureKey(decoded);
  }
  // A file the address names is that file whatever size its query asks
  // for: Dream Finders draws each slide at "…Pemberly-A-Gen3.jpg?width=1000"
  // and again as its thumbnail at "?width=100" (2026-09-23).
  // Highland writes one file as "Parker-A1.jpg" and as "Parker%2DA1%2Ejpg".
  const path = src.replace(/[?#].*$/, "");
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  let file = path.slice(folder.length);
  // A WordPress upload served from a store of its own is that upload,
  // whichever of the site's hosts serves it and whichever copy of it:
  // Neal gives one floor plan as images.nealcommunities.com/…/uploads/2023/02/29100902/…-floorplan.png,
  // as img.nealcommunities.com/… and again with a query, and the queue
  // showed it three times; and a photograph whose copy is in
  // …/uploads/2026/05/23101259/ is named once more as …/uploads/2026/05/,
  // an address that shows nothing (Jeff, 2026-09-24). The folder of eight
  // digits is the time the copy was made, and the site keeps its name.
  const upload = folder.match(/^https?:\/\/(?:[^/]*\.)?([^./]+\.[^./]+)(\/(?:[^/]+\/)*?wp-content\/uploads\/\d{4}\/\d{2}\/)(?:\d{8}\/)?$/i);
  const place = upload ? `${upload[1].toLowerCase()}${upload[2]}` : folder;
  try {
    file = decodeURIComponent(file);
  } catch {
    // left as written
  }
  const name = IMAGE_FILE.test(file) ? file : src.slice(folder.length);
  const sized = name.match(SIZED) ?? name.match(THUMB);
  const plain = (sized ? `${sized[1]}${sized[2]}` : name).replace(IMAGE_FILE, "");
  return place + plain;
}

const IMAGE_FILE = /\.(jpe?g|png|webp|avif|gif)$/i;

/** A segment of a Cloudinary address that says how to draw the picture: "f_auto,c_limit,w_2048", "l_text:Arial_700_bold_24:…". */
const CLOUDINARY_STEP =
  /^(?:\$|(?:a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_)/;

/**
 * A picture uploaded to Cloudinary as its public id, whatever it is drawn
 * as and whichever upload of it: Perry gives a plan's front as
 * ".../upload/f_auto,c_limit,w_2048,q_auto/…/l_text:…DESIGN 2016F E-1…/2016F_E1_Web_xl0q1t"
 * with its label drawn on, and again as ".../upload/v1753884838/2016F_E1_Web_xl0q1t.jpg"
 * and ".../upload/v1733169041/2016F_E1_Web_xl0q1t.jpg", and the gallery
 * showed it three times (Jeff, 2026-09-23). The steps, the version and the
 * format come off; the folders stay. Null for any other address.
 */
function cloudinaryUpload(src: string): string | null {
  const m = src.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload)\/([^?#]*)/i);
  if (!m) return null;
  const kept = m[2]
    .split("/")
    .filter((part) => part && !/^v\d+$/.test(part) && !part.split(",").every((step) => CLOUDINARY_STEP.test(step)));
  if (!kept.length) return null;
  kept[kept.length - 1] = kept[kept.length - 1].replace(/\.[a-z0-9]+$/i, "");
  return `${m[1].toLowerCase()}/${kept.join("/")}`;
}

/**
 * The size a picture's address asks for, the larger of its width and its
 * height ("?width=1000", "&w=900", "?h=800" — David Weekley's list asks
 * for its fronts 400 wide and its galleries 800 high), or 0 where it asks
 * for none. Exported for tests.
 */
export function askedSize(src: string): number {
  return Math.max(0, ...[...src.matchAll(/[?&](?:width|w|height|h)=(\d+)/gi)].map((m) => Number(m[1])));
}

/**
 * One photograph once, in the place its first spelling came: a list's
 * picture and a gallery's are often the same file in two formats. Where a
 * later spelling asks for it larger, that one takes the place — Dream
 * Finders' list draws a plan's front 400 wide and its gallery 1,000 — and
 * `enlarged` says which address it replaced. Pure; exported for tests.
 */
export function onePerPicture(sources: string[]): { photos: string[]; enlarged: Map<string, string> } {
  const at = new Map<string, number>();
  const enlarged = new Map<string, string>();
  const photos: string[] = [];
  for (const src of sources) {
    const key = pictureKey(src);
    const n = at.get(key);
    if (n === undefined) {
      at.set(key, photos.length);
      photos.push(src);
    } else if (askedSize(photos[n]) && askedSize(src) > askedSize(photos[n])) {
      enlarged.set(photos[n], src);
      photos[n] = src;
    }
  }
  return { photos, enlarged };
}

/**
 * The full-size picture beside a thumbnail, in the two shapes the builders'
 * media stores use: Stock keeps "<id>_sm.jpg" beside "<id>_lg.jpg" and its
 * galleries draw the small one, and WordPress keeps a resized
 * "...-1024x614.webp" beside the original. Left alone unless the page
 * itself names the larger file, so the URL is one that is known to exist.
 * Without this a gallery reaches Wix as thumbnails, and carries the same
 * photo twice wherever a page shows both sizes.
 */
export function fullSize(src: string, html: string): string {
  const name = src.split("/").pop() ?? "";

  // Richmond American writes a gallery's picture at two sizes and picks
  // between them by window width, so the thumbnail is what a narrow
  // window takes (Jeff, 2026-09-22).
  const thumb = name.match(THUMB);
  if (thumb) {
    const original = `${thumb[1]}${thumb[2]}`;
    if (html.includes(original)) return src.replace(name, original);
    return src;
  }

  const stem = name.match(SIZED)?.[1];
  if (stem) {
    for (const size of SIZES) {
      const larger = new RegExp(`${escapeRe(stem)}_${size}\\.[a-z0-9]+`, "i").exec(html)?.[0];
      if (larger) return src.replace(name, larger);
    }
    return src;
  }

  const resized = name.match(/^(.+)-\d{2,5}x\d{2,5}(\.[a-z0-9]+)$/i);
  if (resized) {
    const original = `${resized[1]}${resized[2]}`;
    if (html.includes(original)) return src.replace(name, original);
  }

  return src;
}

/**
 * A picture a page carries but never draws, with what the page says it is.
 */
export interface PayloadImage {
  src: string;
  /** True where the page itself calls it an outside view. */
  outside: boolean;
}

// A page can hold its whole gallery in its framework's own data and draw
// almost none of it. Perry Homes is the case this was written for (Jeff,
// 2026-09-22): its section pages show a hero and four thumbnails, and
// carry twenty-three photographs in the Next.js payload — every interior
// of the model home — as media-library records that no <img> ever names.
// Better still, each record says what it is:
//
//   3e:["interior"]
//   3d:{"active":"active","type":"$3e","design_id":"3024F", ...}
//   3c:{"public_id":"…","secure_url":"https://…jpg","metadata":"$3d", …}
//
// so the outside views can be told from the rooms without looking at them.
// A record's fields are split across script chunks mid-object, hence the
// gaps the patterns allow; and a payload may or may not be escaped, hence
// the optional backslashes.
//
// A plan's own page writes the same records whole, the description inside
// the picture rather than pointed at (Perry 2016F, 2026-09-23):
//
//   {"public_id":"2016F_E31_Web_hvttov","secure_url":"https://…jpg", …,
//    "metadata":{"design_id":"2016F","elevation_id":31,"type":["elevation"]}}
//
// and its menus carry pictures of their own — the markets, the building
// process — whose descriptions name no design. Only a picture described
// as one of the designs is taken from such a page.

/** `3e:["interior"]` — a word the records point at rather than repeat. */
const PAYLOAD_LABEL = /(?:^|\\n|>)([0-9a-f]{1,4}):\[\\?"([a-z_]+)\\?"\]/gi;
/** A record naming one of those words as its type. */
const PAYLOAD_META = /(?:^|\\n|>)([0-9a-f]{1,4}):(\{[^{}]{0,900}?\\?"type\\?":\\?"\$([0-9a-f]{1,4})\\?"[^{}]{0,900}?\})/gi;
/** A picture: where it lives, and the record describing it. */
const PAYLOAD_PICTURE =
  /\\?"secure_url\\?":\\?"(https?:(?:\\?\/){2}[^"]+?\.(?:jpe?g|png|webp|avif))\\?"[\s\S]{0,600}?\\?"metadata\\?":\\?"\$([0-9a-f]{1,4})\\?"/gi;

/** A picture whose description is written inside it; the gap may not run into the next picture. */
const PAYLOAD_PICTURE_INLINE =
  /\\?"secure_url\\?":\\?"(https?:(?:\\?\/){2}[^"]+?\.(?:jpe?g|png|webp|avif))\\?"(?:(?!secure_url)[\s\S]){0,600}?\\?"metadata\\?":\{([^{}]{0,1500})\}/gi;
const INLINE_DESIGN = /\\?"design_id\\?":\\?"([^"\\]+)\\?"/i;
const INLINE_TYPE = /\\?"type\\?":\[\\?"([a-z_]+)/i;

/** The words a page uses for a picture of the outside rather than a room. */
const OUTSIDE_LABEL = /^(exterior|elevation|aerial|amenity|community|front)$/i;

/**
 * Every picture the page's own data carries, in the order it carries
 * them, with the outside views marked. Empty for a page that keeps no
 * such data — which is most of them, and costs nothing to ask.
 *
 * This is a last resort, for a page whose galleries cannot be read off
 * its headings: a page that draws its gallery is read from what it draws
 * (firstGallery), which keeps a plan from inheriting the community's
 * other pictures. Pure.
 */
export function payloadGallery(html: string, pageUrl: string, names: (string | null | undefined)[] = []): PayloadImage[] {
  const baseUrl = documentBase(html, pageUrl);
  const labels = new Map<string, string>();
  for (const m of html.matchAll(PAYLOAD_LABEL)) labels.set(m[1], m[2].toLowerCase());
  const outsideOf = new Map<string, boolean>();
  for (const m of html.matchAll(PAYLOAD_META)) {
    outsideOf.set(m[1], OUTSIDE_LABEL.test(labels.get(m[3]) ?? ""));
  }

  const found: { at: number; src: string; outside: boolean; design?: string }[] = [];
  for (const m of html.matchAll(PAYLOAD_PICTURE)) {
    found.push({ at: m.index ?? 0, src: m[1], outside: outsideOf.get(m[2]) ?? false });
  }
  for (const m of html.matchAll(PAYLOAD_PICTURE_INLINE)) {
    const design = m[2].match(INLINE_DESIGN)?.[1];
    if (!design) continue;
    found.push({ at: m.index ?? 0, src: m[1], outside: OUTSIDE_LABEL.test(m[2].match(INLINE_TYPE)?.[1] ?? ""), design });
  }
  found.sort((a, b) => a.at - b.at);
  // A plan's page may show its neighbours too: where the pictures name the
  // plan's own design, only those are its.
  const wanted = new Set(names.filter((n): n is string => Boolean(n)).map(designKey));
  const own = found.filter((f) => f.design && wanted.has(designKey(f.design)));
  const chosen = own.length ? own : found;

  const seen = new Set<string>();
  const out: PayloadImage[] = [];
  for (const f of chosen) {
    let src = f.src.replace(/\\\//g, "/").replace(/\\/g, "");
    try {
      src = new URL(src, baseUrl).href;
    } catch {
      continue;
    }
    if (seen.has(src)) continue;
    seen.add(src);
    out.push({ src, outside: f.outside });
  }
  return out;
}

/** "Design 2016F", "2016F" and "2016 F" as one design. */
const designKey = (name: string) => name.toLowerCase().replace(/\b(?:design|plan|the)\b/g, "").replace(/[^a-z0-9]/g, "");
