// Generic Claude-extraction engine (extraction_method: fetch_claude).
//
// Fetches a builder's community page, strips it to readable text plus image
// URLs, and has Claude extract the floor plans as structured data via a
// forced tool call. Far more durable against site redesigns than selectors:
// this one engine covers the 24 server-rendered builders.

import Anthropic from "@anthropic-ai/sdk";
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

  return plans.map((p) => ({
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
    galleryImages: p.photoImages ?? [],
    blueprintImages: p.blueprintImages ?? [],
  }));
}
