import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/shared/logger";

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

export interface ClassifyHandoffInput {
  conversationThread: string;
  locationName: string;
}

export interface HandoffClassification {
  isHandoff: boolean;
  reason: string;
}

/**
 * Decide whether a reply to this email thread should be an agent handoff
 * — i.e. Lynn should introduce a human agent who will take over.
 *
 * Signals for handoff: lead asks to speak with an agent, schedule a tour,
 * get a call, make an offer, discuss specifics that require a licensed
 * agent (contracts, negotiation), or has otherwise indicated they're
 * ready to move beyond the introductory back-and-forth.
 *
 * Uses Haiku so the cost/latency is negligible compared to the main draft.
 */
export async function classifyHandoff(
  input: ClassifyHandoffInput
): Promise<HandoffClassification> {
  const client = getClient();

  const systemPrompt = `You classify real-estate email threads for ${input.locationName}.

Return JSON: {"isHandoff": boolean, "reason": "<one short sentence>"}.

Set isHandoff=true only when the lead is ready to be connected with a live sales agent:
- asks to speak with / be called by an agent
- wants to schedule a tour, showing, or visit
- is ready to make an offer, put down a deposit, or discuss contract terms
- explicitly asks for a handoff or to be put in touch with someone who can help further
- is past the information-gathering stage and clearly wants human follow-up

Set isHandoff=false for general questions, pricing queries, availability questions,
follow-ups that can be answered via email, or early-stage information gathering.

Output ONLY the JSON object — no prose, no code fences.`;

  try {
    const response = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 150,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Classify this thread:\n\n${input.conversationThread}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.text?.trim() ?? "";

    // Strip optional code fences defensively.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    return {
      isHandoff: Boolean(parsed.isHandoff),
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (err) {
    // If the classifier fails, default to non-handoff — safer to generate
    // a normal draft than to mis-CC an agent on something they shouldn't be on.
    logger.error("Handoff classification failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { isHandoff: false, reason: "classifier error" };
  }
}
