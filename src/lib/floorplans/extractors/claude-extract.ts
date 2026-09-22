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
import { firstGallery, fullSize, payloadGallery } from "@/lib/floorplans/extractors/plan-page";
import { classifyRoom, fileNameWords, orderGallery } from "@/lib/floorplans/gallery-order";
import { pageLooksUnrendered } from "@/lib/floorplans/extractors/rendered";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const MODEL = "claude-sonnet-5";
/**
 * How long a rendering run may spend in the browser. Under the function's
 * own ceiling with room for the reads and the diff that follow, so a slow
 * community finishes with what it has rather than being killed mid-run.
 */
const RENDER_RUN_MS = 170_000;
/**
 * Room for the answer about one listing page. A community with a dozen
 * plans, each with a dozen pictures whose URLs run long, needs more than
 * the 8k this used to have — that ceiling is what cut Ryan's and Pulte's
 * answers in half. The second figure is the retry, for the rare page that
 * needs more still.
 */
const LIST_TOKENS = 16_384;
const LIST_TOKENS_AGAIN = 32_768;
const MAX_CONTENT_CHARS = 90_000;
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

const EXTRACT_TOOL: Anthropic.Tool = {
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
            relatedPlanName: { type: "string", description: "For a quick move-in: the name of the floor plan it is built from, where the page gives one — an inventory listing usually prints it above the address" },
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
function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * How a page is got. Everything after this point is the same whichever it
 * is — the same distillation, the same reads, the same diff — so a builder
 * whose pages are empty without a browser differs from the rest in one
 * line (render.ts).
 */
export type PageReader = (url: string) => Promise<{ url: string; html: string }>;

const fetchPage: PageReader = async (url) => {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return { url: res.url || url, html: await res.text() };
};

function distill(html: string, baseUrl: string): string {
  const abs = (u: string) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  const withImgs = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<img\b[^>]*?src=["']([^"']+)["'][^>]*>/gi, (_, src) => ` [IMG ${abs(src)}] `)
    .replace(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>/gi, (_, href) => ` [LINK ${abs(href)}] `);
  const text = withImgs
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
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
    `|(?:www\\.)?(?:insidemaps|kuula|cloudpano|eyespy360|truplace)\\.com(?:${SLASH}(?:[^\\s"'<>\\\\]|\\\\/)+)?)`,
  "i"
);

/** The first virtual tour a page offers, wherever it hides. Exported for tests. */
export function tourUrlIn(html: string): string | null {
  const found = html.match(TOUR_URL)?.[0];
  return found ? found.replace(/\\/g, "") : null;
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
export function orderPhotos(srcs: string[], outside: ReadonlySet<string> = new Set()) {
  // The lead is the first picture that is not an outside view: a page that
  // opens on the front of the house still shows a room first, because
  // exteriors go last (gallery-order.ts).
  const lead = srcs.find((src) => !outside.has(src));
  return orderGallery(
    srcs.map((src) => {
      if (outside.has(src)) return { src, kind: "exterior" as const };
      if (src === lead) return { src, kind: "primary" as const };
      const name = src.split("/").pop() ?? "";
      const room = OPAQUE_NAME.test(name) ? null : classifyRoom(fileNameWords(src));
      return room === "exterior" ? { src, kind: "exterior" as const } : { src, room };
    })
  );
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

  const response = await getClient().messages.create({
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
  });
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const page = (toolUse?.input ?? {}) as ExtractedPlanPage;

  const gallery = firstGallery(html, page_.url);
  // A page whose galleries cannot be read off its headings may still be
  // carrying them: Perry draws a hero and four thumbnails and keeps
  // twenty-three photographs in its payload (Jeff, 2026-09-22). Only
  // where the headings gave nothing, so a plan never inherits the
  // community's other pictures.
  const carried = gallery.first.length ? [] : payloadGallery(html, page_.url);
  const photos = [
    ...plan.galleryImages,
    ...listOf<string>(page.photoImages),
    ...gallery.first.map((i) => i.src),
    ...carried.map((i) => i.src),
  ]
    .filter((src) => src && !gallery.drop.has(src))
    .map((src) => fullSize(src, html))
    .filter((src, i, all) => all.indexOf(src) === i);
  // What the page said about its own pictures, kept for the ordering.
  const outside = Object.fromEntries(
    carried.filter((i) => i.outside).map((i) => [fullSize(i.src, html), OUTSIDE_META])
  );
  const blueprints = [...plan.blueprintImages, ...listOf<string>(page.blueprintImages)].filter(
    (src, i, all) => src && all.indexOf(src) === i
  );
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
    // A link the page labels as its tour first, then one hidden in its own
    // scripts; both beat one Claude read off the text.
    virtualTourUrl:
      plan.virtualTourUrl ?? tourLinkIn(html) ?? tourUrlIn(html) ?? page.virtualTourUrl?.trim() ?? null,
    galleryImages: photos,
    blueprintImages: blueprints,
    galleryMeta: { ...plan.galleryMeta, ...outside },
  };
}

/**
 * What one listing page holds, read the same way whichever page it is.
 * The address it answered from comes back with the plans: a list that
 * redirects is still a list, and must not be read again as a plan page.
 */
async function listPage(
  url: string,
  opts: { hint?: string; quickMoveIns?: boolean; read?: PageReader }
): Promise<{ url: string; plans: NormalizedPlan[] }> {
  const page = await (opts.read ?? fetchPage)(url);
  const content = distill(page.html, page.url);
  if (content.length < 500) {
    throw new Error("page produced almost no text (JS-rendered? use render_claude)");
  }

  // A page of nothing but quick move-ins is told so: every entry is a house
  // standing on a lot, named by its address, and the plan it is built from
  // is what ties it to one (Jeff, 2026-09-22, Stock's inventory page).
  const what = opts.quickMoveIns
    ? `Extract every quick move-in (inventory) home from this page. Every entry is a quick move-in, so set quickMoveIn=true on all of them. Name each one by its street address, and put the floor plan it is built from in relatedPlanName — an inventory listing usually prints the plan's name above the address.`
    : `Extract every floor plan / home model from this new-home community page. Include quick move-in (inventory) homes as separate entries with quickMoveIn=true, named by their street address, with the plan they are built from in relatedPlanName.`;

  const ask = `${what} Only report data actually present on the page — never invent prices or specs. Image URLs appear as [IMG url] markers; page links as [LINK url] markers; associate them with the nearest plan. Distinguish photos/renderings from floor plan drawings (blueprints).${opts.hint ? ` Hint: ${opts.hint}` : ""}\n\nPage URL: ${url}\n\nPAGE CONTENT:\n${content}`;

  // Streamed, not because anything reads the stream, but because the SDK
  // refuses a plain request whose ceiling could take it past ten minutes —
  // which is what the room this read needs amounts to (Jeff, 2026-09-22:
  // Ryan and Pulte both came back "Streaming is required").
  const readList = async (maxTokens: number) => {
    const response = await getClient().messages
      .stream({
        model: MODEL,
        max_tokens: maxTokens,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "tool", name: "report_floor_plans" },
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
  // both failed (Jeff, 2026-09-22). One more go with room to spare fixes
  // it; a page too big even for that says so rather than crashing.
  let answer = await readList(LIST_TOKENS);
  if (answer.reported !== undefined && !Array.isArray(answer.reported)) {
    logger.warn("Plan list came back half-written; asking again with more room", {
      url,
      stop: answer.stop,
      got: typeof answer.reported,
    });
    answer = await readList(LIST_TOKENS_AGAIN);
  }
  if (!answer.answered) throw new Error("Claude returned no extraction tool call");
  if (answer.reported !== undefined && !Array.isArray(answer.reported)) {
    throw new Error(
      answer.stop === "max_tokens"
        ? "the page's plans did not fit in one answer, even with room to spare"
        : `plans came back as ${typeof answer.reported}, not a list — the page may not be readable without its scripts`
    );
  }
  const plans = listOf<ExtractedPlan>(answer.reported).filter((p) => p?.name?.trim());
  if (plans.length === 0 && pageLooksUnrendered(content)) {
    throw new Error(
      "the page carries no prices or sizes without its scripts — it draws its plans after loading, which a fetch cannot see (this builder needs a rendering engine)"
    );
  }

  const listed = plans.map((p) => {
    const quickMoveIn = opts.quickMoveIns || p.quickMoveIn === true;
    return {
      planKey: normKey(p.name),
      name: p.name.trim(),
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
      galleryImages: listOf<string>(p.photoImages),
      blueprintImages: listOf<string>(p.blueprintImages),
    };
  });
  return { url: page.url || url, plans: listed };
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

export interface ClaudeExtractParams {
  url?: string;
  /** A second page, where the builder lists its quick move-ins away from its plans. */
  quickMoveInUrl?: string;
  hint?: string;
}

/** The generic engine. Reads every page the same way; only the reader differs. */
async function extractPages(
  params: ClaudeExtractParams,
  read: PageReader,
  atOnce: number
): Promise<NormalizedPlan[]> {
  if (!params?.url) throw new Error("this extractor requires extractor_params.url");
  const plansPage = await listPage(params.url, { hint: params.hint, read });
  const listPages = new Set([params.url, plansPage.url]);

  // The builder's own page of homes for sale, where it keeps one away from
  // its plans (Stock's /inventory/, Jeff 2026-09-22). A page that cannot be
  // read costs the run its homes, never its plans.
  let homes: NormalizedPlan[] = [];
  const homesUrl = params.quickMoveInUrl?.trim();
  if (homesUrl && homesUrl !== params.url) {
    try {
      const homesPage = await listPage(homesUrl, { hint: params.hint, quickMoveIns: true, read });
      homes = homesPage.plans;
      listPages.add(homesUrl).add(homesPage.url);
    } catch (error) {
      logger.warn("Quick move-in page could not be read", {
        url: homesUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // A home named for the plan it is built from would take that plan's key.
  const taken = new Set(plansPage.plans.map((p) => p.planKey));
  const listed = [...plansPage.plans];
  for (const home of homes) {
    const planKey = distinctKey(home, taken);
    taken.add(planKey);
    listed.push({ ...home, planKey });
  }

  // Each plan's own page, where the list linked one of its own. A page
  // that cannot be read costs that plan its extras, never the run.
  const pages = await mapLimit(listed, atOnce, async (plan) => {
    if (!plan.sourceUrl || listPages.has(plan.sourceUrl)) return plan;
    try {
      return await readPlanPageWithClaude(plan, read);
    } catch (error) {
      logger.warn("Plan page could not be read", {
        planKey: plan.planKey,
        url: plan.sourceUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return plan;
    }
  });

  return pages.map((plan) => {
    const outside = new Set(
      Object.entries(plan.galleryMeta ?? {})
        .filter(([, meta]) => meta.room === "exterior")
        .map(([src]) => src)
    );
    const ordered = orderPhotos(plan.galleryImages, outside);
    return { ...plan, galleryImages: ordered.urls, galleryMeta: ordered.meta };
  });
}

/** Builders whose pages carry their plans in the HTML: a plain fetch. */
export async function extractWithClaude(params: ClaudeExtractParams): Promise<NormalizedPlan[]> {
  return extractPages(params, fetchPage, 4);
}

/**
 * Builders whose pages are empty without a browser (Richmond American's
 * Blazor site, Jeff 2026-09-22). A browser is rented for the run and
 * given back at the end of it, whether or not the run went well; fewer
 * pages at a time, since each one is a tab rather than a request.
 */
export async function extractWithRender(params: ClaudeExtractParams): Promise<NormalizedPlan[]> {
  const { renderPage, closeRenderer, renderBudget } = await import("@/lib/floorplans/extractors/render");
  renderBudget(RENDER_RUN_MS);
  try {
    return await extractPages(params, renderPage, 2);
  } finally {
    await closeRenderer();
  }
}
