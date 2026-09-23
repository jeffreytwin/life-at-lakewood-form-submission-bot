// Generic Claude-extraction engine (extraction_method: fetch_claude).
//
// Fetches a builder's community page, strips it to readable text plus image
// URLs, and has Claude extract the floor plans as structured data via a
// forced tool call. Far more durable against site redesigns than selectors:
// this one engine covers the 24 server-rendered builders.
//
// A community page is a list, so it carries what a list carries: name,
// beds, baths, size, price, one picture. Each plan's own page is read
// after it for what only that page holds — the garages, the builder's
// description, the virtual tour and the interior pictures (Jeff,
// 2026-09-21, Stock Luxury Homes). A plan whose page cannot be read keeps
// what the list gave it.

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/shared/logger";
import { captionedCarousel, documentBase, drawingsNamed, firstGallery, fullSize, imageAddress, lightboxGallery, payloadGallery, pictureKey } from "@/lib/floorplans/extractors/plan-page";
import { classifyRoom, fileNameWords, orderGallery } from "@/lib/floorplans/gallery-order";
import { pageLooksUnrendered } from "@/lib/floorplans/extractors/rendered";
import { asTour } from "@/lib/floorplans/standardize";
import { type GalleryMeta, type NormalizedPlan, type Room, normKey } from "@/lib/floorplans/types";

const MODEL = "claude-sonnet-5";
/**
 * How long a rendering run may spend in the browser. Under the function's
 * own ceiling with room for the reads and the diff that follow, so a slow
 * community finishes with what it has rather than being killed mid-run.
 */
const RENDER_RUN_MS = 190_000;
/**
 * Room for the answer about one listing page. A community with a dozen
 * plans, each with a dozen pictures whose URLs run long, needs more than
 * the 8k this used to have — that ceiling is what cut Ryan's and Pulte's
 * answers in half. The second figure is the retry, for the rare page that
 * needs more still.
 */
const LIST_TOKENS = 16_384;
const LIST_TOKENS_AGAIN = 32_768;
/**
 * How much of a page is read. Pulte's community pages are 7MB and distill
 * to 370,000 characters — the plans start a third of the way in and run
 * most of the rest — so the old 90,000 cut the list in half and handed the
 * model an entry chopped in two (Jeff, 2026-09-22). This holds such a page
 * whole; the model's context is far larger still, and a page that has to
 * be cut at all now says so.
 */
const MAX_CONTENT_CHARS = 400_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** A tool answer with its blanks taken out, so "" and 0 read as the page saying nothing. Exported for tests. */
export function withoutBlanks<T extends object>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== 0 && !(typeof v === "string" && !v.trim()))
  ) as T;
}

export const EXTRACT_TOOL: Anthropic.Tool = {
  name: "report_floor_plans",
  description: "Report every floor plan / home model found on the page.",
  input_schema: {
    type: "object" as const,
    properties: {
      plans: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Plan/model name exactly as shown" },
            price: { type: "number", description: "Base price in dollars; omit if not shown" },
            beds: { type: "string", description: "Bedrooms, e.g. '3' or '3 - 4'" },
            baths: { type: "string", description: "Bathrooms, e.g. '2' or '2.5 - 3'" },
            sqft: { type: "number", description: "Square footage" },
            garages: { type: "string", description: "Garage count, e.g. '2 car'" },
            homeType: { type: "string", description: "e.g. 'Single Family Home', 'Townhome'" },
            quickMoveIn: { type: "boolean", description: "True if this is a quick move-in / inventory home (often has a street address)" },
            relatedPlanName: { type: "string", description: "For a quick move-in: the name of the floor plan it is built from, where the page gives one — an inventory listing usually prints it above the address. Where the page gives a plan both a code and a name (\"Plan B929 The Waterway\"), the name (\"The Waterway\")" },
            sourceUrl: { type: "string", description: "Absolute URL of the plan's detail page if linked" },
            description: { type: "string", description: "The builder's own description of the plan, as written; omit if the page gives none" },
            virtualTourUrl: { type: "string", description: "Absolute URL of a virtual tour / 3D walkthrough for this plan; omit if none" },
            photoImages: { type: "array", items: { type: "string" }, description: "Absolute URLs of photo/rendering images for this plan, in display order" },
            blueprintImages: { type: "array", items: { type: "string" }, description: "Absolute URLs of floor plan DRAWINGS/blueprints for this plan (not photos)" },
          },
          required: ["name"],
        },
      },
    },
    required: ["plans"],
  },
};

/**
 * The same tool held to its schema, for the page whose list came back as
 * one string of text that would not parse — Perry's and KB's did, at
 * both ceilings (2026-09-23). Strict is the second ask, not the first: a
 * strict schema with a dozen optional fields is refused as "too complex",
 * so every field is required and a blank ("" or 0) says the page gave
 * none (withoutBlanks) — and asked that way, Claude left out the plans'
 * own page links that the loose ask gives (Homes by Towne), which is what
 * the rest of the run reads each plan's pictures and facts from.
 */
export const EXTRACT_TOOL_STRICT: Anthropic.Tool = (() => {
  const loose = EXTRACT_TOOL.input_schema as { properties: { plans: { items: { properties: Record<string, { description?: string }> } } } };
  const fields = loose.properties.plans.items.properties;
  const properties = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      { ...field, description: (field.description ?? "").replace(/;?\s*omit if (?:not shown|none|the page gives none)/i, "; 0 or empty if the page gives none") },
    ])
  );
  return {
    ...EXTRACT_TOOL,
    strict: true,
    input_schema: {
      type: "object" as const,
      properties: {
        plans: {
          type: "array",
          items: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
        },
      },
      required: ["plans"],
      additionalProperties: false,
    },
  };
})();

interface ExtractedPlan {
  name: string;
  price?: number;
  beds?: string;
  baths?: string;
  sqft?: number;
  garages?: string;
  homeType?: string;
  quickMoveIn?: boolean;
  relatedPlanName?: string;
  sourceUrl?: string;
  description?: string;
  virtualTourUrl?: string;
  photoImages?: string[];
  blueprintImages?: string[];
}

/** Strip HTML to visible text; keep img/link URLs as annotations. */
/**
 * The model answers with a list, all but always. When it does not — a
 * string, an object, a half-written answer that ran out of room — a spread
 * or a .filter turns into a crash a page further on, and the run's error
 * reads like a bug in the Hub rather than a page that could not be read.
 * So every list off a tool call comes through here.
 */
/**
 * A list, including one the model handed back as text. Asked for an array
 * it occasionally returns the array serialised — Pulte's community page
 * did it twice running, at both ceilings, so it is the answer the page
 * draws rather than an answer cut short. The list is what matters, not how
 * it was spelled; anything that will not parse into one is still nothing.
 */
export function asList<T>(value: unknown): T[] | null {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function listOf<T>(value: unknown): T[] {
  return asList<T>(value) ?? [];
}

/**
 * The picture addresses in a list Claude gave, and nothing else. Asked for
 * the pictures of a page whose images carry their names but not yet their
 * addresses, Claude handed back the names — "Exterior CO2", "Elevation
 * FM1" — as if they were pictures (Pulte, 2026-09-23), and a name is not
 * something a site can show. Only an absolute web address is kept.
 * Exported for tests.
 */
export function pictureAddresses(value: unknown): string[] {
  return listOf<unknown>(value).filter(
    (u): u is string => typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u.trim())
  ).map((u) => u.trim());
}

/**
 * How a page is got. Everything after this point is the same whichever it
 * is — the same distillation, the same reads, the same diff — so a builder
 * whose pages are empty without a browser differs from the rest in one
 * line (render.ts).
 *
 * A reader may also be asked to press something before it reads: a page
 * that keeps its homes for sale behind a tab rather than on an address of
 * its own has to be opened there first (Richmond American, Jeff
 * 2026-09-22). Only a browser can press anything, so a plain fetch
 * ignores the ask and says it pressed nothing, and the caller leaves that
 * page alone.
 */
export interface ReadOptions {
  /** Labels of the control to press, the first one the page has. */
  press?: readonly string[];
}

export type PageReader = (
  url: string,
  opts?: ReadOptions
) => Promise<{ url: string; html: string; pressed?: string | null }>;

const fetchPage: PageReader = async (url) => {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return { url: res.url || url, html: await res.text() };
};

/**
 * A tag, read whole: a quoted attribute may hold a ">" of its own. Homes by
 * Towne's pages keep their data as JSON in an attribute, and a stripper
 * that ended every tag at the first ">" left three million characters of
 * that JSON in the text Claude read — every plan came back the same size
 * (2026-09-23). A "<" that does not open a tag name is text.
 */
const TAG_BODY = `(?:"[^"]*"|'[^']*'|[^'">])*`;
const ANY_TAG = new RegExp(`<[/!]?[a-zA-Z][^\\s/>]*${TAG_BODY}>`, "g");
const IMG_TAG = new RegExp(`<img\\b${TAG_BODY}>`, "gi");
const A_TAG = new RegExp(`<a\\b${TAG_BODY}>`, "gi");

function attrOf(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((v) => v != null)?.trim() || null;
}

/**
 * The address a picture shows: its own, or the one a lazy page keeps in
 * data-src behind a placeholder, or the largest of the sizes it offers.
 */
function pictureOf(tag: string): string | null {
  const offered = [attrOf(tag, "data-src"), attrOf(tag, "data-lazy-src"), attrOf(tag, "data-lazy"), attrOf(tag, "src"), imageAddress(tag)];
  return offered.find((u): u is string => Boolean(u) && !/^data:/i.test(u!)) ?? null;
}

/** A page as Claude is given it: its text, with its pictures and links as markers. Exported for the connection check. */
export function distill(html: string, pageUrl: string): string {
  const baseUrl = documentBase(html, pageUrl);
  const abs = (u: string) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  // A picture written into the page itself ("data:image/png;base64,...")
  // is not an address anyone can use, and one of them can be longer than
  // the rest of the page: Homes by Towne's plan pages distilled to 3.4
  // million characters and every read was cut at the ceiling (2026-09-23).
  const marker = (kind: string, url: string) => (/^data:/i.test(url) ? " " : ` [${kind} ${abs(url)}] `);
  // A menu or footer is dropped unless it carries what a list of homes
  // does — a price, a size, a bed or bath count — or links to pages
  // beneath this one: Kolter keeps Woodland Preserve's plans in a <nav>
  // of names and pictures, and they came back as none once menus went
  // (2026-09-23).
  const beneath = (() => {
    try {
      const u = new URL(pageUrl);
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}/`;
    } catch {
      return null;
    }
  })();
  const chromeOnly = (block: string): string => {
    const words = block.replace(/<[^>]+>/g, " ");
    if (/\$\s?\d{2,3}(?:,\d{3}|k\b)|\bsq\.?\s?ft\b|square feet|\b\d\s*(?:beds?|bedrooms?|baths?|bathrooms?)\b/i.test(words)) return block;
    const linksBeneath = [...block.matchAll(A_TAG)].some((m) => {
      const href = attrOf(m[0], "href");
      const to = href ? abs(href) : "";
      return Boolean(beneath) && to.startsWith(beneath!) && to.length > beneath!.length;
    });
    return linksBeneath ? block : " ";
  };
  const withImgs = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    // The site's own menus and footer say nothing about a community, and on
    // a big builder's page they are much of what there is to read. Only
    // those that say nothing about homes, though: Kolter's plans came back
    // as none once its menus went (Woodland Preserve, 2026-09-23).
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, chromeOnly)
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, chromeOnly)
    .replace(IMG_TAG, (tag) => {
      const src = pictureOf(tag);
      return src ? marker("IMG", src) : " ";
    })
    .replace(A_TAG, (tag) => {
      const href = attrOf(tag, "href");
      return href && !href.startsWith("#") ? marker("LINK", href) : " ";
    });
  const text = withImgs
    .replace(ANY_TAG, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MAX_CONTENT_CHARS) {
    logger.warn("Page too long to read whole", {
      url: baseUrl,
      chars: text.length,
      read: MAX_CONTENT_CHARS,
    });
  }
  return text.slice(0, MAX_CONTENT_CHARS);
}

const money = (n: number | undefined) =>
  typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US") : null;

/**
 * The tour hosts builders use. Stock keeps its Matterport links in the
 * page's React payload rather than in a link or an iframe, and every
 * script goes out with distillation, so the raw HTML is searched for one.
 */
// A slash as a payload writes it: bare, or escaped as part of a JSON
// string inside a script ("https:\\/\\/my.matterport.com\\/show").
const SLASH = "\\\\?/";
const TOUR_URL = new RegExp(
  `https?:${SLASH}${SLASH}(?:my\\.matterport\\.com${SLASH}show${SLASH}\\?m=[A-Za-z0-9]+` +
    `|(?:www\\.)?zillow\\.com${SLASH}view-imx${SLASH}[A-Za-z0-9-]+` +
    `|(?:www\\.)?(?:(?:insidemaps|cloudpano|eyespy360|truplace)\\.com|kuula\\.co)(?:${SLASH}(?:[^\\s"'<>\\\\]|\\\\/)+)?)`,
  "i"
);

/** The first virtual tour a page offers, wherever it hides. Exported for tests. */
export function tourUrlIn(html: string): string | null {
  const found = html.match(TOUR_URL)?.[0];
  return found ? found.replace(/\\/g, "") : null;
}

const IS_TOUR_URL = new RegExp(`^${TOUR_URL.source}`, "i");

/**
 * Whether an address is a tour itself rather than a page that shows one.
 * Ryan wraps its Matterports in a page of its own — ".../mayport/virtual
 * -tour/31336" — and that page is not what a visitor should be handed
 * (Jeff, 2026-09-22). Exported for tests.
 */
export function isTourUrl(url: string): boolean {
  return IS_TOUR_URL.test(url);
}

/**
 * The tour behind a builder's own tour page. One read, and a page that
 * cannot be read or holds no tour leaves the address as it was.
 */
function bestTour(found: (string | null | undefined)[]): string | null {
  const offered = found.filter((u): u is string => Boolean(u));
  return offered.find(isTourUrl) ?? offered[0] ?? null;
}

async function tourBehind(url: string, read: PageReader): Promise<string | null> {
  try {
    return tourUrlIn((await read(url)).html);
  } catch (error) {
    logger.warn("Virtual tour page could not be read", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** What a builder calls the link to a tour of the home. */
const TOUR_LABEL = /\b(virtual tour|3-? ?d tour|3-? ?d home|take a tour|tour this home|video tour|matterport)\b/i;

/**
 * The link a page labels as its tour, whatever it points at: SimplyDwell's
 * is a Zillow 3D Home behind "Take a Virtual Tour!" (Jeff, 2026-09-22), and
 * a host list will always be a step behind the builders. Exported for tests.
 */
export function tourLinkIn(html: string): string | null {
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!TOUR_LABEL.test(label)) continue;
    const href = decodeEntities(m[1]);
    if (/^https?:\/\//i.test(href)) return href;
  }
  return null;
}

/** The ampersands and quotes a page writes as entities inside an attribute ("&#038;" for "&"). */
function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|#0*38);/gi, "&")
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:apos|#0*39);/gi, "'");
}

const PLAN_PAGE_TOOL: Anthropic.Tool = {
  name: "report_plan_page",
  description: "Report what this one floor plan's own page says about it.",
  input_schema: {
    type: "object" as const,
    properties: {
      price: { type: "number", description: "The plan's price in dollars as the page shows it, e.g. 'Priced $353,999' or 'From $410,900'; omit if the page shows none" },
      garages: { type: "string", description: "Garage count as the page gives it, e.g. '3 car' or 'Two 2-Car Garage'" },
      beds: { type: "string", description: "Bedrooms, if the page gives them" },
      baths: { type: "string", description: "Bathrooms, if the page gives them" },
      sqft: { type: "number", description: "Living square footage, if the page gives it" },
      description: { type: "string", description: "The builder's own prose about the plan — sentences. Omit it if the page only prints a spec line of rooms and counts" },
      virtualTourUrl: { type: "string", description: "Absolute URL of a virtual tour, if one is linked" },
      photoImages: {
        type: "array",
        items: { type: "string" },
        description: "Absolute URLs of photographs and renderings of this home: its exterior elevations first, then the pictures of the page's first photo gallery. A gallery titled for the community or for the designer who furnished it is still this plan's gallery",
      },
      blueprintImages: { type: "array", items: { type: "string" }, description: "Absolute URLs of the floor plan DRAWINGS on this page (not photos)" },
    },
    required: [],
  },
};

interface ExtractedPlanPage {
  price?: number;
  garages?: string;
  beds?: string;
  baths?: string;
  sqft?: number;
  description?: string;
  virtualTourUrl?: string;
  photoImages?: string[];
  blueprintImages?: string[];
}

/** A media store's own id, which says nothing about the picture: "6e8cfe1d-66ee-4b88-b752-30e7579fd4bf_lg.jpg". */
/** What a page says about a picture of its outside, in the shape the gallery keeps. */
const OUTSIDE_META = { caption: null, room: "exterior" as const, kind: "exterior" as const };

const OPAQUE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The plan's photos in the order the sites show them (gallery-order.ts):
 * the front of the house leads, the rooms follow, the alternative
 * elevations go last. The first picture is the hero the list chose, so it
 * leads whatever its file name says, and every other picture whose name
 * calls itself an elevation is an alternative — SimplyDwell prints three
 * per plan and all three were landing in front of the interiors (Jeff,
 * 2026-09-22). A file named for nothing but an id is read as nothing, so a
 * UUID that happens to spell a room does not move the picture.
 * Exported for tests.
 */
export function orderPhotos(srcs: string[], said: Record<string, GalleryMeta> = {}) {
  // What each picture shows: what the page said outright, else what its
  // file name says, else what the page titled it. A file named for
  // nothing but a store's id says nothing, so a UUID that happens to
  // spell a room does not move the picture.
  const roomOf = (src: string): Room | null => {
    const known = said[src];
    if (known?.room) return known.room;
    const name = src.split("/").pop() ?? "";
    const fromName = OPAQUE_NAME.test(name) ? null : classifyRoom(fileNameWords(src));
    return fromName ?? (known?.caption ? classifyRoom(known.caption) : null);
  };
  const rooms = new Map(srcs.map((src) => [src, roomOf(src)] as const));
  // The lead is the first picture the page itself does not call an outside
  // view: a page that opens on the front of the house still shows a room
  // first, because exteriors go last (gallery-order.ts). A file name that
  // calls itself an elevation does not disqualify the hero — the first
  // picture is the one the list chose, and only the later ones named for
  // an elevation are the alternatives (SimplyDwell, Jeff 2026-09-22).
  const lead = srcs.find((src) => said[src]?.room !== "exterior");
  return orderGallery(
    srcs.map((src) => {
      const caption = said[src]?.caption ?? null;
      const room = rooms.get(src) ?? null;
      if (said[src]?.room === "exterior") return { src, kind: "exterior" as const, caption };
      if (src === lead) return { src, kind: "primary" as const, caption };
      if (room === "exterior") return { src, kind: "exterior" as const, caption };
      return { src, room, caption };
    })
  );
}

/**
 * The floor plan drawings Claude gave, with the pictures of the outside of
 * the house taken back out: asked for a plan's drawings, it has handed
 * back its elevation renderings too — SimplyDwell's
 * "Jasmine-30-2413_Elevation-A-2-scaled-1.webp", Pulte's elevations
 * (2026-09-23). A file named for an elevation, an exterior or a rendering,
 * and not for a plan, is a view of the house and goes with the photos.
 * Exported for tests.
 */
export function sortDrawings(urls: string[]): { drawings: string[]; views: string[] } {
  const drawings: string[] = [];
  const views: string[] = [];
  for (const url of urls) {
    const name = fileNameWords(url).toLowerCase();
    const namesPlan = /\b(fp|floor ?plans?|floorplans?|plan|plans|layout|blueprint)\b/.test(name);
    // A view names itself, its architectural style (Dream Finders'
    // "Arlington-Traditional-With-Bonus", 2026-09-23) or its colour scheme
    // (Ashton Woods' "Griffin-U-Scheme"), or sits in a folder of them
    // (KB's ".../elevations/1511_a_sch14.jpg").
    const namesView =
      /\b(elevation|elevations|exterior|exteriors|rendering|renderings|rend|front|rear|facade|streetscape|scheme|schemes|sch|traditional|transitional|craftsman|coastal|colonial|farmhouse|mediterranean|contemporary|modern|prairie|tuscan|spanish)\b/.test(name) ||
      /\b(elevations?|exteriors?|renderings?)\b/.test(folderWords(url));
    (namesView && !namesPlan ? views : drawings).push(url);
  }
  return { drawings, views };
}

/** The words of the folders a file sits in: ".../30ft-kb-2020-series/elevations/1511_a.jpg" gives "... series elevations". */
function folderWords(url: string): string {
  try {
    const parts = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);
    return parts.slice(0, -1).join(" ").replace(/[^a-zA-Z]+/g, " ").toLowerCase();
  } catch {
    return "";
  }
}

/** Runs `fn` over the items a few at a time, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * The plan with what its own page adds: the garages, the description, the
 * tour and the pictures the list had no room for. The list's picture stays
 * in front, so the hero the community page chose still leads, and a field
 * the list already filled is not overwritten — only the blanks are.
 *
 * The pictures are read off the page's headings rather than left to Claude
 * (plan-page.ts): the first gallery's are added whether or not Claude
 * noticed them, and a picture that belongs only to a later gallery or to
 * the virtual tours is taken back out.
 */
export async function readPlanPageWithClaude(
  plan: NormalizedPlan,
  read: PageReader = fetchPage
): Promise<NormalizedPlan> {
  if (!plan.sourceUrl) return plan;
  const page_ = await read(plan.sourceUrl);
  const html = page_.html;
  const content = distill(html, page_.url);
  if (content.length < 500) return plan;

  const response = await getClient().messages.create(
    {
      model: MODEL,
      max_tokens: 4096,
      tools: [PLAN_PAGE_TOOL],
      tool_choice: { type: "tool", name: "report_plan_page" },
      messages: [
        {
          role: "user",
          content: `This is the page of one ${plan.quickMoveIn ? `home for sale, "${plan.name}"` : `floor plan, "${plan.name}"`}. Report only what the page itself says about it — never invent a fact. Image URLs appear as [IMG url] markers and links as [LINK url] markers. Where the page shows several galleries, take the pictures of the first one only.\n\nPage URL: ${plan.sourceUrl}\n\nPAGE CONTENT:\n${content}`,
        },
      ],
    },
    // One page's read may not hold up the run: past this it is left unread.
    { timeout: 45_000, maxRetries: 1 }
  );
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const page = withoutBlanks((toolUse?.input ?? {}) as ExtractedPlanPage);

  // Read off the page's gallery headings, or failing those its first
  // carousel of captioned slides (Pulte).
  const headed = firstGallery(html, page_.url);
  const lightbox = headed.first.length ? null : lightboxGallery(html, page_.url);
  const carousel = headed.first.length || lightbox?.first.length ? null : captionedCarousel(html, page_.url);
  const gallery = lightbox?.first.length
    ? { first: lightbox.first, drop: headed.drop }
    : carousel
      ? { first: carousel.first, drop: new Set([...headed.drop, ...carousel.drop]) }
      : headed;
  // A page whose galleries cannot be read off its headings may still be
  // carrying them: Perry draws a hero and four thumbnails and keeps
  // twenty-three photographs in its payload (Jeff, 2026-09-22). Only
  // where the headings gave nothing, so a plan never inherits the
  // community's other pictures.
  const carried = gallery.first.length ? [] : payloadGallery(html, page_.url);
  // One photograph once, whichever of its spellings came first: the list's
  // picture and the gallery's are often the same file in two formats.
  const kept = new Set<string>();
  const photos = [
    ...plan.galleryImages,
    ...pictureAddresses(page.photoImages),
    ...gallery.first.map((i) => i.src),
    ...carried.map((i) => i.src),
  ]
    .filter((src) => src && !gallery.drop.has(src))
    .map((src) => fullSize(src, html))
    .filter((src) => {
      const key = pictureKey(src);
      if (kept.has(key)) return false;
      kept.add(key);
      return true;
    });
  // What the page said about its own pictures, kept for the ordering.
  // Richmond American titles every picture in a gallery — "Bedroom of the
  // Slate floor plan", "Elevation M of the Slate floor plan" — and names
  // the files media-161663.webp, which says nothing at all (Jeff,
  // 2026-09-22). Perry instead labels its payload, which is `carried`.
  const said: Record<string, GalleryMeta> = {};
  for (const image of gallery.first) {
    const caption = image.alt.trim();
    if (!caption) continue;
    said[fullSize(image.src, html)] = { caption, room: classifyRoom(caption), kind: "photo" };
  }
  const outside = Object.fromEntries(
    carried.filter((i) => i.outside).map((i) => [fullSize(i.src, html), OUTSIDE_META])
  );
  // The drawings Claude reported, and any the page names for this plan
  // that it passed over (a "Floor Plan" tab's picture, drawingsNamed); a
  // home is named for its address, so its plan's name is looked for too.
  const blueprints = [
    ...plan.blueprintImages,
    ...pictureAddresses(page.blueprintImages),
    ...drawingsNamed(html, page_.url, [plan.name, plan.relatedPlanName, typeof plan.raw?.relatedPlan === "string" ? plan.raw.relatedPlan : null]),
    ...(lightbox?.drawings ?? []),
  ].filter((src, i, all) => src && all.indexOf(src) === i);
  // A list gives the plans it prices; the rest carry their price on their
  // own page, in a band under the title (Jeff, 2026-09-22, SimplyDwell).
  const price = plan.price ?? (typeof page.price === "number" && page.price > 0 ? page.price : null);
  return {
    ...plan,
    price,
    priceDisplay: plan.priceDisplay ?? money(price ?? undefined),
    beds: plan.beds || (page.beds ?? ""),
    baths: plan.baths || (page.baths ?? ""),
    sqft: plan.sqft ?? page.sqft ?? null,
    garages: plan.garages ?? page.garages ?? null,
    description: plan.description ?? page.description?.trim() ?? null,
    // A tour on a host that serves tours wins outright, wherever it was
    // found: the list read may have picked up the builder's own page about
    // the tour, and that is not the tour (Jeff, 2026-09-22). Failing that,
    // the link the page labels as its tour, then one hidden in its own
    // scripts, then one Claude read off the text.
    virtualTourUrl: bestTour([
      plan.virtualTourUrl,
      tourLinkIn(html),
      tourUrlIn(html),
      page.virtualTourUrl?.trim(),
    ]),
    galleryImages: photos,
    blueprintImages: blueprints,
    galleryMeta: { ...plan.galleryMeta, ...said, ...outside },
  };
}

/**
 * What one listing page holds, read the same way whichever page it is.
 * The address it answered from comes back with the plans: a list that
 * redirects is still a list, and must not be read again as a plan page.
 */
async function listPage(
  url: string,
  opts: { hint?: string; quickMoveIns?: boolean; press?: readonly string[]; read?: PageReader }
): Promise<{ url: string; plans: NormalizedPlan[]; pressed?: string | null; homesPage?: string | null }> {
  const page = await (opts.read ?? fetchPage)(url, opts.press ? { press: opts.press } : undefined);
  // Asked to open a tab and the page has no such tab: there is nothing
  // behind it to read, and nothing to pay a model to read.
  if (opts.press && !page.pressed) return { url: page.url || url, plans: [], pressed: null };
  const content = distill(page.html, page.url);
  if (content.length < 500) {
    throw new Error("page produced almost no text (JS-rendered? use render_claude)");
  }

  // A page of nothing but quick move-ins is told so: every entry is a house
  // standing on a lot, named by its address, and the plan it is built from
  // is what ties it to one (Jeff, 2026-09-22, Stock's inventory page).
  const what = opts.quickMoveIns
    ? `Extract every quick move-in (inventory) home from this page. Every entry is a quick move-in, so set quickMoveIn=true on all of them. Name each one by its street address, and put the floor plan it is built from in relatedPlanName — an inventory listing usually prints the plan's name above the address.`
    : `Extract every floor plan / home model from this new-home community page. A home the page marks with a move-in date — "December Move-in", "Ready Nov 2026", "Move-in Ready" — is a quick move-in however the page words it: set quickMoveIn=true, name it by its street address where the page gives one and by its plan and the date where it does not, and put the plan or design it is built from in relatedPlanName ("DESIGN 3741F E-31" means the plan is 3741F). Where a page shows a price beside a crossed-out one, the crossed-out price is the old one — report the price being asked now.`;

  const ask = `${what} Only report data actually present on the page — never invent prices or specs. Image URLs appear as [IMG url] markers; page links as [LINK url] markers; associate them with the nearest plan. Distinguish photos/renderings from floor plan drawings (blueprints).${opts.hint ? ` Hint: ${opts.hint}` : ""}\n\nPage URL: ${url}\n\nPAGE CONTENT:\n${content}`;

  // Streamed, not because anything reads the stream, but because the SDK
  // refuses a plain request whose ceiling could take it past ten minutes —
  // which is what the room this read needs amounts to (Jeff, 2026-09-22:
  // Ryan and Pulte both came back "Streaming is required").
  const readList = async (maxTokens: number, tool: Anthropic.Tool = EXTRACT_TOOL) => {
    const response = await getClient().messages
      .stream({
        model: MODEL,
        max_tokens: maxTokens,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: ask }],
      })
      .finalMessage();
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return {
      answered: Boolean(toolUse),
      reported: (toolUse?.input as { plans?: unknown } | undefined)?.plans,
      stop: response.stop_reason,
    };
  };

  // An answer that runs out of room comes back half-written, and a
  // half-written list is not a list — which is how Ryan Homes and Pulte
  // both failed (Jeff, 2026-09-22): one more go with room to spare. An
  // answer that finished but wrote its list as text is asked again held
  // to the schema (EXTRACT_TOOL_STRICT).
  let answer = await readList(LIST_TOKENS);
  if (answer.reported !== undefined && !asList(answer.reported)) {
    const cutShort = answer.stop === "max_tokens";
    logger.warn(cutShort ? "Plan list came back half-written; asking again with more room" : "Plan list came back as text; asking again held to the schema", {
      url,
      stop: answer.stop,
      got: typeof answer.reported,
    });
    answer = await readList(LIST_TOKENS_AGAIN, cutShort ? EXTRACT_TOOL : EXTRACT_TOOL_STRICT);
  }
  if (!answer.answered) throw new Error("Claude returned no extraction tool call");
  const reported = answer.reported === undefined ? [] : asList<ExtractedPlan>(answer.reported);
  if (!reported) {
    throw new Error(
      answer.stop === "max_tokens"
        ? "the page's plans did not fit in one answer, even with room to spare"
        : `plans came back as ${typeof answer.reported}, not a list — the page may not be readable without its scripts`
    );
  }
  const plans = reported.filter((p) => p?.name?.trim()).map(withoutBlanks);
  if (plans.length === 0 && pageLooksUnrendered(content)) {
    throw new Error(
      "the page carries no prices or sizes without its scripts — it draws its plans after loading, which a fetch cannot see (this builder needs a rendering engine)"
    );
  }

  const listed = plans.map((p) => {
    const quickMoveIn = opts.quickMoveIns || p.quickMoveIn === true;
    const name = planName(p.name);
    return {
      planKey: normKey(name),
      name,
      price: p.price ?? null,
      priceDisplay: money(p.price),
      beds: p.beds ?? "",
      baths: p.baths ?? "",
      sqft: p.sqft ?? null,
      garages: p.garages ?? null,
      homeType: p.homeType ?? null,
      quickMoveIn,
      // Only a home stands on a plan; a plan named as its own base plan is
      // Claude reading the field too eagerly, and means nothing downstream.
      relatedPlanName: (quickMoveIn ? p.relatedPlanName?.trim() : "") || null,
      comingSoon: false,
      sourceUrl: p.sourceUrl ?? page.url ?? url,
      description: p.description?.trim() || null,
      virtualTourUrl: p.virtualTourUrl?.trim() || null,
      galleryImages: pictureAddresses(p.photoImages),
      blueprintImages: pictureAddresses(p.blueprintImages),
    };
  });
  return { url: page.url || url, plans: listed, pressed: page.pressed ?? null, homesPage: homesPageIn(page.html, page.url || url) };
}

/** What a community calls the page of its homes for sale, as the last part of its address. */
const HOMES_PAGE = /^(move-?in-?ready(-homes)?|quick-?move-?ins?(-homes)?|available-homes|homes-ready-soon|ready-now(-homes)?|inventory(-homes)?|spec-homes|qmis?)$/i;

/**
 * The community's own page of homes for sale, where it keeps one beneath
 * its own address: Kolter's Woodland Preserve lists its plans on the
 * community page and its homes at ".../woodland-preserve/move-in-ready/",
 * and a run that did not know to read it came back with no homes at all
 * (2026-09-23). Only a page beneath the community's — the builder's page
 * of every home it has for sale anywhere is not this community's.
 * Exported for tests.
 */
export function homesPageIn(html: string, pageUrl: string): string | null {
  const baseUrl = documentBase(html, pageUrl);
  let community: URL;
  try {
    community = new URL(pageUrl);
  } catch {
    return null;
  }
  const beneath = community.pathname.replace(/\/+$/, "") + "/";
  for (const tag of html.match(A_TAG) ?? []) {
    const href = attrOf(tag, "href");
    if (!href || href.startsWith("#")) continue;
    let link: URL;
    try {
      link = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (link.host !== community.host || !link.pathname.startsWith(beneath)) continue;
    const last = link.pathname.split("/").filter(Boolean).pop() ?? "";
    if (HOMES_PAGE.test(last)) {
      link.hash = "";
      return link.href;
    }
  }
  return null;
}

/**
 * A plan's name as the builder files it, without the word a page puts in
 * front of a plan's code: Perry lists the same design as "3368F" on one
 * lot width's page and "Design 3368F" on the next (2026-09-23), and the
 * two would be taken for different plans. Only "Design" in front of a
 * numbered code goes — "Plan 2016" may be what a builder and the site
 * both call a plan, and "The Design House" is a name.
 * Exported for tests.
 */
export function planName(name: string): string {
  return name.trim().replace(/^design\s+(?=\d{3,5}[a-z]{0,2}\b)/i, "");
}

/**
 * A key no base plan already has. A quick move-in named for the plan it is
 * built from would otherwise take that plan's key and the two would be read
 * as one; the id in its own page's address keeps them apart, and is the
 * same from one run to the next.
 */
export function distinctKey(plan: NormalizedPlan, taken: Set<string>): string {
  if (!taken.has(plan.planKey)) return plan.planKey;
  const tail = (plan.sourceUrl ?? "").split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "";
  const suffix = normKey(tail);
  let key = suffix ? `${plan.planKey}-${suffix}` : plan.planKey;
  for (let n = 2; taken.has(key); n++) key = `${plan.planKey}-${suffix || "home"}-${n}`;
  return key;
}

/**
 * One plan listed twice in a community — under two of its series. Perry
 * sells 3220F on its 75' lots and its 90' lots, at two prices and with a
 * half bath more on the larger lot, and the site carries one 3220F
 * (2026-09-23); a second row of the same name would be a duplicate there.
 * So the two are one plan: the lower price ("from"), the larger bed and
 * bath counts (the site shows the larger end of a range, standardize.ts),
 * and both listings' pictures, the first listing's leading. Pure;
 * exported for tests.
 */
export function mergeRepeatedPlan(first: NormalizedPlan, again: NormalizedPlan): NormalizedPlan {
  const priced = [first, again].filter((p) => typeof p.price === "number" && p.price > 0);
  const cheapest = priced.sort((a, b) => (a.price as number) - (b.price as number))[0];
  const larger = (a: string, b: string) => ((parseFloat(b) || 0) > (parseFloat(a) || 0) ? b : a);
  const union = (a: string[], b: string[]) => [...a, ...b.filter((u) => !a.includes(u))];
  return {
    ...first,
    price: cheapest?.price ?? first.price,
    priceDisplay: cheapest?.priceDisplay ?? money(cheapest?.price ?? undefined) ?? first.priceDisplay,
    beds: larger(first.beds, again.beds),
    baths: larger(first.baths, again.baths),
    sqft: first.sqft ?? again.sqft,
    garages: first.garages ?? again.garages,
    homeType: first.homeType ?? again.homeType,
    description: first.description ?? again.description,
    virtualTourUrl: first.virtualTourUrl ?? again.virtualTourUrl,
    comingSoon: first.comingSoon && again.comingSoon,
    galleryImages: union(first.galleryImages, again.galleryImages),
    galleryMeta: { ...again.galleryMeta, ...first.galleryMeta },
    blueprintImages: union(first.blueprintImages, again.blueprintImages),
  };
}

export interface ClaudeExtractParams {
  url?: string;
  /**
   * The pages the plans are listed on, where that is not the community
   * page itself. Perry splits a community by lot width and lists the
   * homes under each — four pages, one community (Jeff, 2026-09-22).
   * When set, these are read instead of `url`, which stays the
   * community's own address.
   */
  listUrls?: string[];
  /** A second page, where the builder lists its quick move-ins away from its plans. */
  quickMoveInUrl?: string;
  hint?: string;
  /** When the run stops opening pages (sync.ts, RUN_READ_MS); pages not started by then are left unread. */
  runDeadline?: number;
}

/**
 * The longest one plan's page takes: a fetch or a render, and Claude's
 * read. A page is not started with less than this left before the run's
 * deadline.
 */
const PAGE_READ_MS = 35_000;

/**
 * What a community calls the tab its homes for sale sit behind. Richmond
 * American's is a button that changes nothing in the address bar, so
 * there is no page to point the connection at — the tab has to be
 * pressed (Jeff, 2026-09-22).
 */
const HOMES_TAB = [
  "move-in ready",
  "move-in ready homes",
  "quick move-in",
  "quick move-ins",
  "quick move-in homes",
  "available homes",
  "homes for sale",
  "inventory homes",
] as const;

/** The generic engine. Reads every page the same way; only the reader differs. */
async function extractPages(
  params: ClaudeExtractParams,
  read: PageReader,
  atOnce: number,
  can: { press?: boolean; readPlanPage?: PageReader } = {}
): Promise<NormalizedPlan[]> {
  // The pages the plans are listed on: the community page, unless the
  // connection names others (a builder that splits a community by lot
  // width lists its homes under each).
  const planPages = (params.listUrls ?? []).map((u) => u.trim()).filter(Boolean);
  if (!planPages.length && params?.url) planPages.push(params.url);
  if (!planPages.length) throw new Error("this extractor requires extractor_params.url");

  const listPages = new Set<string>(planPages);
  const taken = new Set<string>();
  const listed: NormalizedPlan[] = [];
  const refused: string[] = [];
  const readPages: string[] = [];
  // The list pages at once, not one after another: Perry's Star Farms is
  // four rendered pages, each a long answer, and read in turn they took
  // most of a run before a single plan page was opened (2026-09-23). The
  // plans are still taken in the pages' order, so keys come out the same.
  const lists = await mapLimit(planPages, 4, async (pageUrl) => {
    try {
      return { pageUrl, page: await listPage(pageUrl, { hint: params.hint, read }) };
    } catch (error) {
      return { pageUrl, error: error instanceof Error ? error.message : String(error) };
    }
  });
  for (const { pageUrl, page, error } of lists) {
    if (!page) {
      // One page of four going down should cost the run that page, not the
      // other three — but a run that read nothing at all has failed, and
      // says which page said what.
      logger.warn("Plan list page could not be read", { url: pageUrl, error });
      refused.push(`${pageUrl}: ${error}`);
      continue;
    }
    listPages.add(page.url);
    readPages.push(page.url || pageUrl);
    for (const plan of page.plans) {
      // A base plan another of the community's pages already listed is
      // that plan again, not a second one (mergeRepeatedPlan).
      const twin = plan.quickMoveIn ? -1 : listed.findIndex((p) => !p.quickMoveIn && p.planKey === plan.planKey);
      if (twin >= 0) {
        listed[twin] = mergeRepeatedPlan(listed[twin], plan);
        continue;
      }
      const planKey = distinctKey(plan, taken);
      taken.add(planKey);
      listed.push({ ...plan, planKey });
    }
  }
  if (refused.length === planPages.length) throw new Error(refused.join("; "));

  // The builder's own page of homes for sale, where it keeps one away from
  // its plans (Stock's /inventory/, Jeff 2026-09-22). A page that cannot be
  // read costs the run its homes, never its plans.
  // Named in the connection, or linked from beneath the community's own page.
  const homesUrl = params.quickMoveInUrl?.trim() || lists.map((l) => l.page?.homesPage).find(Boolean) || undefined;
  if (homesUrl && !listPages.has(homesUrl)) {
    try {
      const homesPage = await listPage(homesUrl, { hint: params.hint, quickMoveIns: true, read });
      listPages.add(homesUrl).add(homesPage.url);
      // A home named for the plan it is built from would take that plan's key.
      for (const home of homesPage.plans) {
        const planKey = distinctKey(home, taken);
        taken.add(planKey);
        listed.push({ ...home, planKey });
      }
    } catch (error) {
      logger.warn("Quick move-in page could not be read", {
        url: homesUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // And the community that keeps its homes for sale behind a tab instead
  // of on a page of its own. There is no address to point at, so the tab
  // is pressed and the same page read again — which only a browser can
  // do, and which costs one read and no model call where the page has no
  // such tab (Richmond American, Jeff 2026-09-22).
  if (can.press) {
    for (const pageUrl of readPages) {
      try {
        const homes = await listPage(pageUrl, {
          hint: params.hint,
          quickMoveIns: true,
          press: HOMES_TAB,
          read,
        });
        if (!homes.pressed) continue;
        logger.info("Read a community's homes from behind its own tab", {
          url: pageUrl,
          tab: homes.pressed,
          homes: homes.plans.length,
        });
        for (const home of homes.plans) {
          const planKey = distinctKey(home, taken);
          taken.add(planKey);
          listed.push({ ...home, planKey });
        }
      } catch (error) {
        logger.warn("A community's homes tab could not be read", {
          url: pageUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Every page read and not one plan on any: a page fetched without its
  // scripts often lists nothing its visitors see — Homes by WestBay's
  // Crosswind Ranch shows nineteen floor plans and fetches as seventeen
  // thousand characters without a price (2026-09-23). Said plainly, so
  // the fix is in the message rather than in a guess.
  if (!listed.length && !can.press) {
    throw new Error(
      `no plans on ${readPages.join(", ")} as fetched — if the builder's page shows plans, it draws them after loading: switch this builder to Render + Claude`
    );
  }

  // Each plan's own page, where the list linked one of its own. A page
  // that cannot be read costs that plan its extras, never the run.
  // Base plans first: where a community has more pages than a run has
  // time for, it is the homes' pages that go unread, not the plans'.
  const byPlansFirst = [...listed.keys()].sort((a, b) => Number(listed[a].quickMoveIn) - Number(listed[b].quickMoveIn) || a - b);
  const deadline = params.runDeadline ?? Infinity;
  const readInOrder = await mapLimit(byPlansFirst, atOnce, async (i) => {
    const plan = listed[i];
    if (!plan.sourceUrl || listPages.has(plan.sourceUrl)) return plan;
    // Out of time: this page is left for the next run, and what an earlier
    // run found on it stays (diff.ts).
    if (Date.now() + PAGE_READ_MS > deadline) return { ...plan, pageUnread: true };
    try {
      return await readPlanPageWithClaude(plan, can.readPlanPage ?? read);
    } catch (error) {
      logger.warn("Plan page could not be read", {
        planKey: plan.planKey,
        url: plan.sourceUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      // What that page holds is unknown this run, not gone (diff.ts).
      return { ...plan, pageUnread: true };
    }
  });
  const pages: NormalizedPlan[] = new Array(listed.length);
  byPlansFirst.forEach((i, n) => (pages[i] = readInOrder[n]));

  // What remains pointing at a builder's own page about a tour is followed
  // to the tour it shows. Only those: a plan that already has a real tour,
  // or none at all, costs nothing.
  const toured = await mapLimit(pages, atOnce, async (plan) => {
    // Not one a builder only calls a tour: Perry's "3D Tour" is an
    // interactive drawing, and there is nothing behind it to follow
    // (standardize.ts, which drops it either way).
    const tour = asTour(plan.virtualTourUrl);
    if (!tour || isTourUrl(tour) || Date.now() + PAGE_READ_MS > deadline) return plan;
    const deeper = await tourBehind(tour, read);
    return deeper ? { ...plan, virtualTourUrl: deeper } : plan;
  });

  return toured.map((plan) => {
    const { drawings, views } = sortDrawings(plan.blueprintImages);
    const outside = Object.fromEntries(views.map((u) => [u, OUTSIDE_META]));
    const photos = [...plan.galleryImages, ...views.filter((u) => !plan.galleryImages.includes(u))];
    const ordered = orderPhotos(photos, { ...outside, ...plan.galleryMeta });
    return { ...plan, blueprintImages: drawings, galleryImages: ordered.urls, galleryMeta: ordered.meta };
  });
}

/** Builders whose pages carry their plans in the HTML: a plain fetch. */
export async function extractWithClaude(params: ClaudeExtractParams): Promise<NormalizedPlan[]> {
  // Six at a time: a community of two dozen plans, each page a read and a
  // question, took 267 of its 300 seconds four at a time (Neal's Palm Grove,
  // 2026-09-23).
  return extractPages(params, fetchPage, 6);
}

/**
 * Builders whose pages are empty without a browser (Richmond American's
 * Blazor site, Jeff 2026-09-22). A browser is rented for the run and
 * given back at the end of it, whether or not the run went well; fewer
 * pages at a time, since each one is a tab rather than a request.
 *
 * Three at a time rather than two: one Richmond community is eight plans
 * and eleven homes, and every one of them has a page of its own to open
 * (Jeff, 2026-09-22). A page the budget cannot reach is not a loss of
 * what it holds — the plan says its page went unread and the diff leaves
 * that plan's gallery alone (diff.ts).
 */
export async function extractWithRender(params: ClaudeExtractParams): Promise<NormalizedPlan[]> {
  const { withRenderer } = await import("@/lib/floorplans/extractors/render");
  // The browser's budget ends with the run's reading time, whichever comes first.
  const budget = Math.max(0, Math.min(RENDER_RUN_MS, (params.runDeadline ?? Infinity) - Date.now()));
  return withRenderer(budget, (renderPage) => {
    // A plan's own page is fetched first and rendered only if the fetch
    // shows no facts: Perry's community has thirty-nine plans and twenty
    // homes, and rendering every one of their pages took the whole budget
    // and more — fifty-nine pages went unread (2026-09-23). A page that
    // needs a browser, like Richmond's, still gets one.
    const fetchThenRender: PageReader = async (url, opts) => {
      try {
        const fetched = await fetchPage(url, opts);
        if (!pageLooksUnrendered(distill(fetched.html, fetched.url))) return fetched;
      } catch {
        // a page that will not fetch may still render
      }
      return renderPage(url, opts);
    };
    return extractPages(params, renderPage, 5, { press: true, readPlanPage: fetchThenRender });
  });
}
