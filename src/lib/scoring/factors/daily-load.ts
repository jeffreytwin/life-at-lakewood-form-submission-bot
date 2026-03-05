import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

/**
 * Soft penalty based on how many leads an agent has received today.
 *
 * - Full score (1.0) when the agent has 0 leads today
 * - Linear drop-off toward 0.0 as they approach daily_lead_max
 * - Score floors at 0.0 when at or above daily_lead_max
 * - Agents without a daily_lead_max get a neutral 0.5
 */
export function scoreDailyLoad(agent: Agent, context: ScoringContext): number {
  const max = agent.daily_lead_max;
  if (max <= 0) return 0.5; // No daily cap configured

  const todayCount = context.dailyLeadCounts.get(agent.id) ?? 0;

  if (todayCount >= max) return 0.0;
  if (todayCount === 0) return 1.0;

  return (max - todayCount) / max;
}
