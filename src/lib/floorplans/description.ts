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

const MODEL = "claude-opus-5";

/** First-person ownership words, as whole words. "US" the country is not one of them. */
const OWNER_WORDS = /\b(we|we're|we've|we'll|we'd|our|ours|ourselves|us)\b/gi;

/** Whether a description speaks as the plan's owner: "we", "our", "us" and their contractions. */
export function speaksAsOwner(text: string | null | undefined): boolean {
  if (!text) return false;
  return [...text.matchAll(OWNER_WORDS)].some((m) => m[0] !== "US");
}

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
  const response = await getClient().messages.create({
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
  });
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
export async function neutralizeDescriptions(plans: NormalizedPlan[], builderName: string): Promise<NormalizedPlan[]> {
  const out: NormalizedPlan[] = [];
  for (const plan of plans) {
    const text = plan.description?.trim() ?? "";
    if (!text || !speaksAsOwner(text)) {
      out.push(plan);
      continue;
    }
    try {
      const rewritten = await rewordOnce(text, builderName);
      out.push(
        rewritten
          ? { ...plan, description: rewritten, raw: { ...(plan.raw ?? {}), descriptionOriginal: text } }
          : plan
      );
    } catch (error) {
      logger.warn("Description could not be reworded", {
        planKey: plan.planKey,
        error: error instanceof Error ? error.message : String(error),
      });
      out.push(plan);
    }
  }
  return out;
}
