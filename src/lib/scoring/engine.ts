import type { Agent, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_SCORING_PRIORITY, RANK_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore, ScoringContext } from "./types";
import { scoreCloseRate } from "./factors/close-rate";
import { scoreLeadLoad } from "./factors/lead-load";
import { scoreLeadValue } from "./factors/lead-value";
import { scoreAvailability } from "./factors/availability";
import { scoreOptimalLoad } from "./factors/optimal-load";
import { agentMatchesLocation } from "./factors/location-match";

const factorFns: Record<
  ScoringFactorKey,
  (agent: Agent, context: ScoringContext) => number
> = {
  close_rate: (a, c) => scoreCloseRate(a),
  lead_load: scoreLeadLoad,
  lead_value: scoreLeadValue,
  availability: scoreAvailability,
  optimal_load: scoreOptimalLoad,
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
    lead_value: factorFns.lead_value(agent, context),
    availability: factorFns.availability(agent, context),
    optimal_load: factorFns.optimal_load(agent, context),
  };

  const totalScore =
    factors.close_rate * weights.close_rate +
    factors.lead_load * weights.lead_load +
    factors.lead_value * weights.lead_value +
    factors.availability * weights.availability +
    factors.optimal_load * weights.optimal_load;

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
 * Hard-filter agents by location, then score and rank the remaining.
 * Agents whose location_specialties don't match the lead are excluded entirely.
 */
export function selectBestAgent(
  agents: Agent[],
  context: ScoringContext,
  excludeAgentIds: string[] = []
): AgentScore | null {
  const eligible = agents.filter(
    (agent) =>
      !excludeAgentIds.includes(agent.id) &&
      agentMatchesLocation(agent, context)
  );

  if (eligible.length === 0) return null;

  const scored = scoreAgents(eligible, context);
  return scored[0] ?? null;
}
