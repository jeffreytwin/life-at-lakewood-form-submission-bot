// A builder's description of a plan often speaks as its owner ("our Lori
// plan", "we designed", "contact us"). On the sites that reads as if Life
// at Lakewood owned the plan (Jeff, 2026-09-20), so a description that
// speaks that way is reworded in the third person, keeping every fact, by
// Claude, once per distinct text (fp_description_rewrites, migration 070).
// A description that cannot be reworded is left as it is, and the queue
// holds the plan back until a person fixes it (approval.ts).

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import type { NormalizedPlan } from "@/lib/floorplans/types";
import { speaksAsOwner } from "@/lib/floorplans/owner-words";
import { fullAndHalfBaths } from "@/lib/floorplans/standardize";

const MODEL = "claude-opus-5";
/** Descriptions reworded at once, and the longest one rewording is allowed. */
const REWORD_AT_ONCE = 8;
const REWORD_MS = 40_000;

export { speaksAsOwner };

/** The cache key for a rewrite: the builder and the exact text. */
export function rewriteKey(builderName: string, text: string): string {
  return createHash("sha256").update(`${builderName}\n${text}`).digest("hex");
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    client = new Anthropic({ apiKey });
  }
  return client;
}

const REWRITE_TOOL: Anthropic.Tool = {
  name: "report_rewritten_description",
  description: "Report the description reworded in the third person.",
  input_schema: {
    type: "object",
    properties: {
      description: { type: "string", description: "The reworded description, and nothing else." },
    },
    required: ["description"],
  },
};

/**
 * The description reworded so it no longer speaks as the builder: the
 * builder named where the text said "we" or "our", or neutral wording, with
 * every fact, feature and the length kept. Null when Claude declines or
 * answers with nothing usable.
 */
export async function rewriteAsThirdParty(text: string, builderName: string): Promise<string | null> {
  const response = await getClient().messages.create(
    {
      model: MODEL,
      max_tokens: 2048,
      tools: [REWRITE_TOOL],
      tool_choice: { type: "tool", name: REWRITE_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `This is a home builder's description of one of its floor plans, to be shown on a community website that does not belong to the builder. ` +
            `Reword it so it no longer speaks in the builder's first person: replace "we", "our", "us" and the like by naming the builder (${builderName}) or with neutral third-person wording, whichever reads better. ` +
            `Keep every fact, feature, number and the overall length and tone; change nothing else; do not add anything. Report only the reworded description.\n\n` +
            `Builder: ${builderName}\n\nDescription:\n${text}`,
        },
      ],
    },
    { timeout: REWORD_MS, maxRetries: 1 }
  );
  if (response.stop_reason === "refusal") return null;
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const rewritten = (toolUse?.input as { description?: unknown } | undefined)?.description;
  if (typeof rewritten !== "string" || !rewritten.trim() || speaksAsOwner(rewritten)) return null;
  return rewritten.trim();
}

/** The remembered rewrite of a text, or a fresh one that is then remembered; null when none can be had. */
async function rewordOnce(text: string, builderName: string): Promise<string | null> {
  const key = rewriteKey(builderName, text);
  const { data: cached } = await supabase.from("fp_description_rewrites").select("rewritten").eq("key", key).maybeSingle();
  if (cached?.rewritten) return cached.rewritten;
  const rewritten = await rewriteAsThirdParty(text, builderName);
  if (!rewritten) return null;
  const { error } = await supabase
    .from("fp_description_rewrites")
    .upsert({ key, builder: builderName, original: text, rewritten }, { onConflict: "key" });
  if (error) logger.warn("Description rewrite could not be remembered", { key, error: error.message });
  return rewritten;
}

/**
 * Every plan whose description speaks as the builder gets it reworded; the
 * original is kept in raw. A plan whose description cannot be reworded is
 * left as it is, for the queue to hold back.
 */
export async function neutralizeDescriptions(
  plans: NormalizedPlan[],
  builderName: string,
  deadline = Infinity
): Promise<NormalizedPlan[]> {
  // Several at once, and none started past the run's deadline: one after
  // another, a first run of a community of thirty-odd plans spent minutes
  // here and was cut off before anything was queued (2026-09-23). What is
  // not reworded this run is held back by the queue and reworded by the
  // next one.
  return mapLimit(plans, REWORD_AT_ONCE, async (plan) => {
    const text = plan.description?.trim() ?? "";
    if (!text || !speaksAsOwner(text)) return plan;
    if (Date.now() + REWORD_MS > deadline) return plan;
    try {
      const rewritten = await rewordOnce(text, builderName);
      return rewritten
        ? { ...plan, description: rewritten, raw: { ...(plan.raw ?? {}), descriptionOriginal: text } }
        : plan;
    } catch (error) {
      logger.warn("Description could not be reworded", {
        planKey: plan.planKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return plan;
    }
  });
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
 * The neighborhood as a sentence names it: the part after the site's area
 * where a community carries one ("Waterside - Wild Blue" is Wild Blue),
 * the whole name otherwise ("Esplanade at Wellen Park", "Broadleaf").
 */
export function neighborhoodName(communityName: string): string {
  const parts = communityName.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : communityName.trim();
}

/**
 * What a plan says for itself when its builder says nothing (Jeff,
 * 2026-09-21: Stock Luxury Homes writes no descriptions at all). Built
 * from the plan's own standardized fields, so it reads the way the rest of
 * the row does. A clause whose field the builder left blank is left out
 * rather than written as a blank, and a plan with none of the three says
 * only where it can be built.
 *
 * Base plans only: a quick move-in is a house standing on a lot, not a
 * plan "available to be built".
 */
export function describePlan(plan: NormalizedPlan, communityName: string): string {
  const features: string[] = [];
  if (plan.beds.trim()) features.push(`${plan.beds.trim()} Bedrooms`);
  if (plan.baths.trim()) features.push(`${plan.baths.trim()} Baths`);
  const cars = plan.garages?.match(/\d+(?:\.\d+)?/)?.[0];
  if (cars) features.push(`a ${cars} car garage`);
  const sentences = [
    `The ${plan.name} is available to be built in ${neighborhoodName(communityName)}.`,
    "The price shown is the base price.",
  ];
  if (features.length) {
    const listed =
      features.length > 1 ? `${features.slice(0, -1).join(", ")} and ${features[features.length - 1]}` : features[0];
    sentences.push(`This plan features ${listed}.`);
  }
  return sentences.join(" ");
}

/** A word of a line of facts: a number, or a word of the areas builders measure. */
const FACT_WORD = /^(?:\$?\d[\d,.]*\+?|sq\.?|ft\.?|sqft|sf|total|living|area|heated|under|air)$/i;

/**
 * Whether a "description" is the line of facts a card prints — Kolter's
 * "Key Collection 2,383 Total Sq. Ft. 1,675 Living Area Sq. Ft." — which a
 * run read once where the plan's description belongs, and the queue
 * proposed it over the plan's own (Jeff, 2026-09-26). Short, and mostly
 * numbers and the words of an area. Exported for tests.
 */
export function looksLikeFactsLine(text: string | null | undefined): boolean {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 30) return false;
  return words.filter((w) => FACT_WORD.test(w)).length / words.length >= 0.4;
}

/**
 * Whether a "description" is really the spec line a page prints under the
 * plan name — "Four Bedroom (Opt. Bonus Room), Four Full and 1/2 Bath,
 * Great Room, Dining Room, Two 2-Car Garage". It reads as a list, not
 * prose: nothing ends it as a sentence, and every comma-separated piece is
 * a short capitalized fragment. Stock has no descriptions at all (Jeff,
 * 2026-09-21), so its plans were coming through with this line where a
 * description belongs, which left no room for one of their own.
 */
export function looksLikeSpecList(text: string | null | undefined): boolean {
  const s = (text ?? "").trim();
  if (looksLikeFactsLine(s)) return true;
  if (!s || /[.!?]["')\]]?$/.test(s)) return false;
  const pieces = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (pieces.length < 3) return false;
  return pieces.every((piece) => /^[A-Z0-9(]/.test(piece) && piece.split(/\s+/).length <= 6);
}

/**
 * Gives every base plan the builder left without a description one of its
 * own (describePlan). A spec line counts as no description: it is dropped,
 * and the plan gets a written one, or none at all where a quick move-in
 * cannot have one. No IO.
 */
export function withDescriptions(plans: NormalizedPlan[], communityName: string): NormalizedPlan[] {
  return plans.map((plan) => {
    const own = plan.description?.trim() ?? "";
    if (own && !looksLikeSpecList(own)) return plan;
    const raw = own ? { ...(plan.raw ?? {}), featuresLine: own } : plan.raw;
    // The line says the baths in words ("3 Full and 1 Half Bath"), and the
    // words decide (standardize.ts, fullAndHalfBaths).
    const baths = fullAndHalfBaths(own);
    const counted = baths ? { ...plan, baths } : plan;
    if (plan.quickMoveIn) return own ? { ...counted, description: null, raw } : plan;
    // Marked, so it never replaces a description the builder wrote (diff.ts).
    return { ...counted, description: describePlan(counted, communityName), raw: { ...(raw ?? {}), descriptionGenerated: true } };
  });
}
