import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserMessage } from "./prompts";
import { loadTrainingExamples, loadDraftFeedback } from "./training-loader";
import type { TrainingExample } from "@/lib/supabase/types";
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

export interface DraftInput {
  locationName: string;
  locationId: string | null;
  /** Email address of the sending account (for training example lookup) */
  emailAddress?: string | null;
  conversationThread: string;
  leadInfo?: {
    name?: string;
    budget?: string;
    timeline?: string;
    interests?: string;
    message?: string;
  };
  agentHandoff?: {
    agentName: string;
    agentEmail: string;
    agentGender: "male" | "female" | null;
  };
  /** Override training examples (for simulation) */
  trainingExamples?: TrainingExample[];
}

export interface DraftOutput {
  bodyText: string;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
}

const MODEL = "claude-sonnet-4-20250514";

/**
 * Generate an email draft using Claude.
 */
export async function generateDraft(input: DraftInput): Promise<DraftOutput> {
  const client = getClient();

  // Load training examples unless overridden
  const trainingExamples =
    input.trainingExamples ??
    (await loadTrainingExamples(input.locationId, undefined, input.emailAddress));

  // Load low-rated draft feedback for learning
  const draftFeedback = await loadDraftFeedback();

  const systemPrompt = buildSystemPrompt({
    locationName: input.locationName,
    trainingExamples,
    draftFeedback,
    conversationThread: input.conversationThread,
    leadInfo: input.leadInfo,
    agentHandoff: input.agentHandoff,
  });

  const userMessage = buildUserMessage({
    locationName: input.locationName,
    trainingExamples,
    conversationThread: input.conversationThread,
    leadInfo: input.leadInfo,
    agentHandoff: input.agentHandoff,
  });

  logger.info("Generating email draft", {
    locationName: input.locationName,
    trainingExampleCount: trainingExamples.length,
    hasLeadInfo: !!input.leadInfo,
    hasAgentHandoff: !!input.agentHandoff,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const bodyText = textBlock?.text ?? "";

  logger.info("Draft generated", {
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
    bodyLength: bodyText.length,
  });

  return {
    bodyText,
    modelUsed: MODEL,
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
  };
}
