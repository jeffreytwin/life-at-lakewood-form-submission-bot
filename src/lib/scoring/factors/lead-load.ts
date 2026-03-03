import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";
import {
  LEAD_LOAD_FULL_SCORE_PCT,
  LEAD_LOAD_ZERO_SCORE_PCT,
} from "@/lib/shared/constants";

export function scoreLeadLoad(agent: Agent, context: ScoringContext): number {
  const currentCount = context.currentMonthLeadCounts.get(agent.id) ?? 0;
  const minGoal = agent.monthly_lead_goal_min;
  const maxGoal = agent.monthly_lead_goal_max;

  if (maxGoal <= 0) return 0.5; // No goal set

  const fullScoreAt = minGoal * LEAD_LOAD_FULL_SCORE_PCT;
  const zeroScoreAt = maxGoal * LEAD_LOAD_ZERO_SCORE_PCT;

  if (currentCount <= fullScoreAt) return 1.0;
  if (currentCount >= zeroScoreAt) return 0.0;

  // Linear interpolation between full and zero
  return (zeroScoreAt - currentCount) / (zeroScoreAt - fullScoreAt);
}
