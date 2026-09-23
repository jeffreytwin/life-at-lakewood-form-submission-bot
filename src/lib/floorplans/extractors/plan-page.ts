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

const attr = (tag: string, name: string): string | null =>
  tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;

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

/** A heading's words, with the spans, comments and entities a framework leaves in it. */
function readable(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
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
    const src =
      attr(m[0], "src") ||
      attr(m[0], "data-src") ||
      largestInSrcSet(attr(m[0], "srcset") || attr(m[0], "data-srcset"));
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
  const name = src.split("/").pop() ?? "";
  const sized = name.match(SIZED) ?? name.match(THUMB);
  const plain = (sized ? `${sized[1]}${sized[2]}` : name).replace(/\.(jpe?g|png|webp|avif|gif)$/i, "");
  return src.replace(name, plain);
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

/** `3e:["interior"]` — a word the records point at rather than repeat. */
const PAYLOAD_LABEL = /(?:^|\\n|>)([0-9a-f]{1,4}):\[\\?"([a-z_]+)\\?"\]/gi;
/** A record naming one of those words as its type. */
const PAYLOAD_META = /(?:^|\\n|>)([0-9a-f]{1,4}):(\{[^{}]{0,900}?\\?"type\\?":\\?"\$([0-9a-f]{1,4})\\?"[^{}]{0,900}?\})/gi;
/** A picture: where it lives, and the record describing it. */
const PAYLOAD_PICTURE =
  /\\?"secure_url\\?":\\?"(https?:(?:\\?\/){2}[^"]+?\.(?:jpe?g|png|webp|avif))\\?"[\s\S]{0,600}?\\?"metadata\\?":\\?"\$([0-9a-f]{1,4})\\?"/gi;

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
export function payloadGallery(html: string, pageUrl: string): PayloadImage[] {
  const baseUrl = documentBase(html, pageUrl);
  const labels = new Map<string, string>();
  for (const m of html.matchAll(PAYLOAD_LABEL)) labels.set(m[1], m[2].toLowerCase());
  const outsideOf = new Map<string, boolean>();
  for (const m of html.matchAll(PAYLOAD_META)) {
    outsideOf.set(m[1], OUTSIDE_LABEL.test(labels.get(m[3]) ?? ""));
  }

  const seen = new Set<string>();
  const out: PayloadImage[] = [];
  for (const m of html.matchAll(PAYLOAD_PICTURE)) {
    let src = m[1].replace(/\\\//g, "/").replace(/\\/g, "");
    try {
      src = new URL(src, baseUrl).href;
    } catch {
      continue;
    }
    if (seen.has(src)) continue;
    seen.add(src);
    out.push({ src, outside: outsideOf.get(m[2]) ?? false });
  }
  return out;
}
