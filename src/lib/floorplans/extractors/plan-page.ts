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
// Nothing here is Stock-specific: a page with no gallery headings yields no
// gallery, and its plan keeps exactly what it had.

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
export function sectionsOf(html: string, baseUrl: string): PageSection[] {
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
    const src = attr(m[0], "src") || attr(m[0], "data-src");
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

/**
 * The plan's own gallery, and the pictures that are somebody else's. A
 * picture that also appears outside a later gallery — the same photograph
 * used as a tour's still and as an elevation, say — is not dropped.
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
  return { first: galleries[0]?.images ?? [], drop };
}

/**
 * The full-size picture beside a thumbnail. Stock's media store keeps the
 * two as "<id>_sm.jpg" and "<id>_lg.jpg" and its galleries draw the small
 * one, so a gallery would reach Wix as thumbnails, and the same photo twice
 * wherever the page shows both sizes. Swapped only when the page itself
 * names the larger file, so the URL is one that is known to exist.
 */
export function fullSize(src: string, html: string): string {
  const name = src.split("/").pop() ?? "";
  const stem = name.match(/^(.+)_sm\.[a-z0-9]+$/i)?.[1];
  if (!stem) return src;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const larger = new RegExp(`${escaped}_lg\\.[a-z0-9]+`, "i").exec(html)?.[0];
  return larger ? src.replace(name, larger) : src;
}
