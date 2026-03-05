import type { Agent, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore, ScoringContext } from "./types";
import { scoreCloseRate } from "./factors/close-rate";
import { scoreLeadLoad } from "./factors/lead-load";
import { scoreDailyLoad } from "./factors/daily-load";
import { agentMatchesLocation } from "./factors/location-match";
import { agentMatchesPriceRange } from "./factors/price-range";
import { agentIsAvailable } from "./factors/availability";

export function scoreAgent(
  agent: Agent,
  context: ScoringContext,
  weights?: Record<ScoringFactorKey, number>
): AgentScore {
  const w = weights ?? DEFAULT_GLOBAL_WEIGHTS;
  const total = w.close_rate + w.lead_load + w.daily_load;

  // Normalize weights so they sum to 1.0
  const norm = total > 0 ? total : 1;

  const factors = {
    close_rate: scoreCloseRate(agent),
    lead_load: scoreLeadLoad(agent, context),
    daily_load: scoreDailyLoad(agent, context),
  };

  const totalScore =
    factors.close_rate * (w.close_rate / norm) +
    factors.lead_load * (w.lead_load / norm) +
    factors.daily_load * (w.daily_load / norm);

  return {
    agentId: agent.id,
    agentName: agent.name,
    totalScore,
    factors,
  };
}

export function scoreAgents(
  agents: Agent[],
  context: ScoringContext,
  weights?: Record<ScoringFactorKey, number>
): AgentScore[] {
  return agents
    .map((agent) => scoreAgent(agent, context, weights))
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Hard-filter agents by location, price range, and availability,
 * then score and rank.
 */
export function selectBestAgent(
  agents: Agent[],
  context: ScoringContext,
  excludeAgentIds: string[] = [],
  weights?: Record<ScoringFactorKey, number>
): AgentScore | null {
  const eligible = agents.filter(
    (agent) =>
      !excludeAgentIds.includes(agent.id) &&
      agentMatchesLocation(agent, context) &&
      agentMatchesPriceRange(agent, context) &&
      agentIsAvailable(agent, context)
  );

  if (eligible.length === 0) return null;

  const scored = scoreAgents(eligible, context, weights);
  return scored[0] ?? null;
}
