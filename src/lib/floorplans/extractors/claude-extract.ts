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
import { firstGallery, fullSize } from "@/lib/floorplans/extractors/plan-page";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const MODEL = "claude-sonnet-5";
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
  sourceUrl?: string;
  description?: string;
  virtualTourUrl?: string;
  photoImages?: string[];
  blueprintImages?: string[];
}

/** Strip HTML to visible text; keep img/link URLs as annotations. */
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
    `|(?:www\\.)?(?:insidemaps|kuula|cloudpano|eyespy360|truplace)\\.com(?:${SLASH}(?:[^\\s"'<>\\\\]|\\\\/)+)?)`,
  "i"
);

/** The first virtual tour a page offers, wherever it hides. Exported for tests. */
export function tourUrlIn(html: string): string | null {
  const found = html.match(TOUR_URL)?.[0];
  return found ? found.replace(/\\/g, "") : null;
}

const PLAN_PAGE_TOOL: Anthropic.Tool = {
  name: "report_plan_page",
  description: "Report what this one floor plan's own page says about it.",
  input_schema: {
    type: "object" as const,
    properties: {
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
  garages?: string;
  beds?: string;
  baths?: string;
  sqft?: number;
  description?: string;
  virtualTourUrl?: string;
  photoImages?: string[];
  blueprintImages?: string[];
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
export async function readPlanPageWithClaude(plan: NormalizedPlan): Promise<NormalizedPlan> {
  if (!plan.sourceUrl) return plan;
  const res = await fetch(plan.sourceUrl, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${plan.sourceUrl}: ${res.status}`);
  const html = await res.text();
  const content = distill(html, res.url);
  if (content.length < 500) return plan;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [PLAN_PAGE_TOOL],
    tool_choice: { type: "tool", name: "report_plan_page" },
    messages: [
      {
        role: "user",
        content: `This is the page of one floor plan, "${plan.name}". Report only what the page itself says about that plan — never invent a fact. Image URLs appear as [IMG url] markers and links as [LINK url] markers. Where the page shows several galleries, take the pictures of the first one only.\n\nPage URL: ${plan.sourceUrl}\n\nPAGE CONTENT:\n${content}`,
      },
    ],
  });
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const page = (toolUse?.input ?? {}) as ExtractedPlanPage;

  const gallery = firstGallery(html, res.url);
  const photos = [...plan.galleryImages, ...(page.photoImages ?? []), ...gallery.first.map((i) => i.src)]
    .filter((src) => src && !gallery.drop.has(src))
    .map((src) => fullSize(src, html))
    .filter((src, i, all) => all.indexOf(src) === i);
  const blueprints = [...plan.blueprintImages, ...(page.blueprintImages ?? [])].filter(
    (src, i, all) => src && all.indexOf(src) === i
  );
  return {
    ...plan,
    beds: plan.beds || (page.beds ?? ""),
    baths: plan.baths || (page.baths ?? ""),
    sqft: plan.sqft ?? page.sqft ?? null,
    garages: plan.garages ?? page.garages ?? null,
    description: plan.description ?? page.description?.trim() ?? null,
    // A tour hidden in the page's own scripts beats one Claude read off the text.
    virtualTourUrl: plan.virtualTourUrl ?? tourUrlIn(html) ?? page.virtualTourUrl?.trim() ?? null,
    galleryImages: photos,
    blueprintImages: blueprints,
  };
}

export async function extractWithClaude(params: {
  url?: string;
  hint?: string;
}): Promise<NormalizedPlan[]> {
  if (!params?.url) throw new Error("fetch_claude extractor requires extractor_params.url");
  const res = await fetch(params.url, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${params.url}: ${res.status}`);
  const content = distill(await res.text(), res.url);
  if (content.length < 500) {
    throw new Error("page produced almost no text (JS-rendered? use render_claude)");
  }

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8192,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "report_floor_plans" },
    messages: [
      {
        role: "user",
        content: `Extract every floor plan / home model from this new-home community page. Include quick move-in (inventory) homes as separate entries with quickMoveIn=true. Only report data actually present on the page — never invent prices or specs. Image URLs appear as [IMG url] markers; page links as [LINK url] markers; associate them with the nearest plan. Distinguish photos/renderings from floor plan drawings (blueprints).${params.hint ? ` Hint: ${params.hint}` : ""}\n\nPage URL: ${params.url}\n\nPAGE CONTENT:\n${content}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("Claude returned no extraction tool call");
  const plans = ((toolUse.input as { plans?: ExtractedPlan[] }).plans ?? []).filter(
    (p) => p.name?.trim()
  );

  const listed = plans.map((p) => ({
    planKey: normKey(p.name),
    name: p.name.trim(),
    price: p.price ?? null,
    priceDisplay: money(p.price),
    beds: p.beds ?? "",
    baths: p.baths ?? "",
    sqft: p.sqft ?? null,
    garages: p.garages ?? null,
    homeType: p.homeType ?? null,
    quickMoveIn: p.quickMoveIn === true,
    comingSoon: false,
    sourceUrl: p.sourceUrl ?? params.url ?? null,
    description: p.description?.trim() || null,
    virtualTourUrl: p.virtualTourUrl?.trim() || null,
    galleryImages: p.photoImages ?? [],
    blueprintImages: p.blueprintImages ?? [],
  }));

  // Each plan's own page, where the list linked one of its own. A page
  // that cannot be read costs that plan its extras, never the run.
  return mapLimit(listed, 4, async (plan) => {
    if (!plan.sourceUrl || plan.sourceUrl === params.url || plan.sourceUrl === res.url) return plan;
    try {
      return await readPlanPageWithClaude(plan);
    } catch (error) {
      logger.warn("Plan page could not be read", {
        planKey: plan.planKey,
        url: plan.sourceUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return plan;
    }
  });
}
