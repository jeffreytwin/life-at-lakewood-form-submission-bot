import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/shared/logger";

export interface ReconcilerAgent {
  id: string;
  name: string;
  email: string | null;
  gender: "male" | "female" | null;
}

const HANDOFF_PHRASE_REGEX =
  /\b(cc(?:'?ing|'?d|ed)?|copying|connecting you|introduc(?:ing|e) you|putting you in touch|reach(?:ing)? out to you)\b/i;

export function detectHandoffIntent(body: string): boolean {
  return HANDOFF_PHRASE_REGEX.test(body);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan a draft body for any agent from the roster. Prefers full-name match;
 * falls back to first-name only when that first name is unique on the roster,
 * to avoid false positives when two teammates share a first name.
 */
export function findNamedAgent(
  body: string,
  roster: ReconcilerAgent[]
): ReconcilerAgent | null {
  const lower = body.toLowerCase();

  for (const agent of roster) {
    if (lower.includes(agent.name.toLowerCase())) return agent;
  }

  const firstNameCounts = new Map<string, number>();
  for (const agent of roster) {
    const first = agent.name.split(/\s+/)[0]?.toLowerCase();
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  }

  for (const agent of roster) {
    const first = agent.name.split(/\s+/)[0];
    if (!first) continue;
    if ((firstNameCounts.get(first.toLowerCase()) ?? 0) !== 1) continue;
    const re = new RegExp(`\\b${escapeRegex(first)}\\b`, "i");
    if (re.test(body)) return agent;
  }

  return null;
}

function pronounPhrase(gender: ReconcilerAgent["gender"]): string {
  switch (gender) {
    case "male":
      return "he/him/his";
    case "female":
      return "she/her/hers";
    default:
      return "they/them/their";
  }
}

const REWRITE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Rewrite a draft's handoff references to use `toAgent` instead of `fromAgent`,
 * adjusting gendered pronouns that describe the teammate. Pronouns referring
 * to the lead or anyone else are left alone.
 */
export async function rewriteHandoffBody(params: {
  body: string;
  fromAgent: ReconcilerAgent | null;
  toAgent: ReconcilerAgent;
}): Promise<string> {
  const { body, fromAgent, toAgent } = params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
  const client = new Anthropic({ apiKey });

  const toFirst = toAgent.name.split(/\s+/)[0] ?? toAgent.name;
  const toPronouns = pronounPhrase(toAgent.gender);

  const instruction = fromAgent
    ? `This draft was supposed to hand off to ${toAgent.name}, but it names ${fromAgent.name} instead. Replace every reference to ${fromAgent.name} — including the short form "${fromAgent.name.split(/\s+/)[0]}" when used to address them — with ${toAgent.name} (and "${toFirst}" where the first name alone is used). Adjust any pronouns that describe ${fromAgent.name} to ${toPronouns} for ${toAgent.name}. Leave pronouns that refer to the lead or anyone else UNCHANGED.`
    : `This draft hands off to a teammate, but the teammate named isn't on our roster. Rewrite the handoff so it names ${toAgent.name} by full name and addresses them by their first name "${toFirst}" where appropriate. Use ${toPronouns} for them.`;

  const system = `You are editing an email draft. Make ONLY the change described in the user's instruction. Preserve every other word, line break, and piece of punctuation exactly as given. Return ONLY the updated email body — no preamble, no commentary, no quote marks, no markdown fences.`;

  const user = `${instruction}

--- DRAFT START ---
${body}
--- DRAFT END ---`;

  const response = await client.messages.create({
    model: REWRITE_MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  let text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  text = text.replace(/^---\s*DRAFT\s+START\s*---\n?/i, "");
  text = text.replace(/\n?---\s*DRAFT\s+END\s*---\s*$/i, "");
  text = text.trim();

  if (!text) throw new Error("Handoff rewrite returned empty body");

  logger.info("Handoff body rewritten", {
    model: REWRITE_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    from: fromAgent?.name ?? "unknown",
    to: toAgent.name,
  });

  return text;
}
