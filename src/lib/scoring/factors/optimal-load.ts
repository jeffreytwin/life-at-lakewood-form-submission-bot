import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

export function scoreOptimalLoad(agent: Agent, context: ScoringContext): number {
  const factor = agent.optimal_load_factor;

  // Normal agents (1.0) always score full here
  if (factor >= 1.0) return 1.0;

  const currentCount = context.currentMonthLeadCounts.get(agent.id) ?? 0;
  const adjustedCap = agent.monthly_lead_goal_max * factor;

  if (adjustedCap <= 0) return 0.0;
  if (currentCount >= adjustedCap) return 0.0;

  // Linear: 1.0 when empty, 0.0 at adjusted cap
  return (adjustedCap - currentCount) / adjustedCap;
}
