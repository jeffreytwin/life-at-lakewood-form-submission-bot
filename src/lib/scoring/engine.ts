import type { Agent, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_SCORING_PRIORITY, RANK_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore, ScoringContext } from "./types";
import { scoreCloseRate } from "./factors/close-rate";
import { scoreLeadLoad } from "./factors/lead-load";
import { scoreAvailability } from "./factors/availability";
import { agentMatchesLocation } from "./factors/location-match";
import { agentMatchesPriceRange } from "./factors/price-range";

const factorFns: Record<
  ScoringFactorKey,
  (agent: Agent, context: ScoringContext) => number
> = {
  close_rate: (a) => scoreCloseRate(a),
  lead_load: scoreLeadLoad,
  availability: scoreAvailability,
};

function getWeightsFromPriority(
  priority: ScoringFactorKey[]
): Record<ScoringFactorKey, number> {
  const weights: Record<string, number> = {};
  for (let i = 0; i < priority.length; i++) {
    weights[priority[i]] = RANK_WEIGHTS[i];
  }
  return weights as Record<ScoringFactorKey, number>;
}

export function scoreAgent(agent: Agent, context: ScoringContext): AgentScore {
  const priority = agent.scoring_priority ?? DEFAULT_SCORING_PRIORITY;
  const weights = getWeightsFromPriority(priority);

  const factors = {
    close_rate: factorFns.close_rate(agent, context),
    lead_load: factorFns.lead_load(agent, context),
    availability: factorFns.availability(agent, context),
  };

  const totalScore =
    factors.close_rate * weights.close_rate +
    factors.lead_load * weights.lead_load +
    factors.availability * weights.availability;

  return {
    agentId: agent.id,
    agentName: agent.name,
    totalScore,
    factors,
  };
}

export function scoreAgents(
  agents: Agent[],
  context: ScoringContext
): AgentScore[] {
  return agents
    .map((agent) => scoreAgent(agent, context))
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Hard-filter agents by location and price range, then score and rank.
 */
export function selectBestAgent(
  agents: Agent[],
  context: ScoringContext,
  excludeAgentIds: string[] = []
): AgentScore | null {
  const eligible = agents.filter(
    (agent) =>
      !excludeAgentIds.includes(agent.id) &&
      agentMatchesLocation(agent, context) &&
      agentMatchesPriceRange(agent, context)
  );

  if (eligible.length === 0) return null;

  const scored = scoreAgents(eligible, context);
  return scored[0] ?? null;
}
