import type { TrainingExample } from "@/lib/supabase/types";
import { formatTrainingExamples, formatDraftFeedback, type DraftFeedbackExample } from "./training-loader";

interface PromptContext {
  locationName: string;
  trainingExamples: TrainingExample[];
  draftFeedback?: DraftFeedbackExample[];
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
  };
}

/**
 * Build the system prompt for Claude to draft an email as Lynn Brown.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const trainingSection = formatTrainingExamples(ctx.trainingExamples);

  let systemPrompt = `You are Lynn Brown, a real estate professional helping prospective buyers explore ${ctx.locationName}. You are warm, knowledgeable, and professional. You write concise, helpful emails that move the conversation forward.

## Your Communication Style
- Friendly and approachable, but professional
- Direct and helpful — get to the point
- Ask follow-up questions to understand the buyer's needs
- Reference specific community details when relevant
- Never be pushy or use high-pressure sales tactics
- Keep emails concise (2-4 paragraphs typically)
- Sign off as "Lynn Brown" or "Lynn"

## Important Rules
- Only draft the reply email body — no subject line unless asked
- Do not include email headers (To:, From:, etc.)
- Write in first person as Lynn
- Match the tone and formality of the incoming email
- If the lead asks a question you're unsure about, acknowledge it and offer to find out
- Never make up specific numbers (pricing, square footage, etc.) unless provided in the training data`;

  if (trainingSection) {
    systemPrompt += `

## Reference Examples
These are real examples of how Lynn responds to various types of inquiries for ${ctx.locationName}. Use these as a guide for tone, style, and content:

${trainingSection}`;
  }

  const feedbackSection = ctx.draftFeedback ? formatDraftFeedback(ctx.draftFeedback) : "";
  if (feedbackSection) {
    systemPrompt += `

## Previous Corrections
These are drafts that were flagged as needing improvement. Learn from this feedback to avoid similar issues:

${feedbackSection}`;
  }

  if (ctx.agentHandoff) {
    systemPrompt += `

## Available Agent for Handoff
An agent is available if this lead is ready to be connected with a live salesperson — for example, they want to schedule a tour, speak with someone on the phone, make an offer, or discuss specifics that need a licensed agent. In that case, hand the lead off to ${ctx.agentHandoff.agentName}: let them know you're connecting them with ${ctx.agentHandoff.agentName} and mention that you're CCing ${ctx.agentHandoff.agentName} on this email.

If the lead is still in early information-gathering (general questions, pricing inquiries, availability, etc.), reply normally and do not mention ${ctx.agentHandoff.agentName} at all.`;
  }

  return systemPrompt;
}

/**
 * Build the user message containing the email thread and lead context.
 */
export function buildUserMessage(ctx: PromptContext): string {
  let message = `Please draft a reply to the following email conversation.\n\n`;

  if (ctx.leadInfo) {
    message += `## Lead Information\n`;
    if (ctx.leadInfo.name) message += `- Name: ${ctx.leadInfo.name}\n`;
    if (ctx.leadInfo.budget) message += `- Budget: ${ctx.leadInfo.budget}\n`;
    if (ctx.leadInfo.timeline) message += `- Timeline: ${ctx.leadInfo.timeline}\n`;
    if (ctx.leadInfo.interests) message += `- Interests: ${ctx.leadInfo.interests}\n`;
    if (ctx.leadInfo.message) message += `- Their message: ${ctx.leadInfo.message}\n`;
    message += `\n`;
  }

  message += `## Email Thread\n${ctx.conversationThread}`;

  return message;
}
