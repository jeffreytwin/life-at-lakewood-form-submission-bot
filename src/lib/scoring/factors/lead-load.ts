import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

/**
 * Scores an agent based on how many leads they've received this month
 * relative to their min/max goals.
 *
 * Two-tier design ensures agents below their minimum are ALWAYS
 * prioritized over agents who've already met their minimum:
 *
 *   Below minimum (0 → min):  score 1.0 → 0.5  (highest priority)
 *   Above minimum (min → max): score 0.5 → 0.0  (lower priority)
 *   At or above max:           score 0.0
 *
 * Unlike the previous flat-plateau design, this formula differentiates
 * from the very first lead — there is no range where all agents tie.
 */
export function scoreLeadLoad(agent: Agent, context: ScoringContext): number {
  const currentCount = context.currentMonthLeadCounts.get(agent.id) ?? 0;
  const minGoal = agent.monthly_lead_goal_min;
  const maxGoal = agent.monthly_lead_goal_max;

  if (maxGoal <= 0) return 0.5; // No goal set — neutral

  const effectiveMin = Math.min(minGoal, maxGoal);

  // At or above max: lowest score
  if (currentCount >= maxGoal) return 0.0;

  // Below minimum: score 1.0 (at 0 leads) → 0.5 (at min goal)
  // Every lead matters — no flat plateau
  if (currentCount < effectiveMin) {
    return 0.5 + 0.5 * (1 - currentCount / effectiveMin);
  }

  // Between min and max: score 0.5 (at min) → 0.0 (at max)
  const range = maxGoal - effectiveMin;
  if (range <= 0) return 0.0; // min == max edge case
  return 0.5 * (1 - (currentCount - effectiveMin) / range);
}
