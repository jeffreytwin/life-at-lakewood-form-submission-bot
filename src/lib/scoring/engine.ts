import type { Agent, ScoringWeights } from "@/lib/supabase/types";
import type { AgentScore, ScoringContext } from "./types";
import { scoreLocationMatch } from "./factors/location-match";
import { scoreCloseRate } from "./factors/close-rate";
import { scoreLeadLoad } from "./factors/lead-load";
import { scoreLeadValue } from "./factors/lead-value";
import { scoreAvailability } from "./factors/availability";
import { scoreOptimalLoad } from "./factors/optimal-load";

export function scoreAgent(agent: Agent, context: ScoringContext): AgentScore {
  const weights = context.weights;

  const factors = {
    location_match: scoreLocationMatch(agent, context),
    close_rate: scoreCloseRate(agent),
    lead_load: scoreLeadLoad(agent, context),
    lead_value: scoreLeadValue(agent, context),
    availability: scoreAvailability(agent, context),
    optimal_load: scoreOptimalLoad(agent, context),
  };

  const totalScore =
    factors.location_match * weights.location_match +
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

export function selectBestAgent(
  agents: Agent[],
  context: ScoringContext,
  excludeAgentIds: string[] = []
): AgentScore | null {
  const eligible = agents.filter(
    (agent) => !excludeAgentIds.includes(agent.id)
  );

  if (eligible.length === 0) return null;

  const scored = scoreAgents(eligible, context);
  return scored[0] ?? null;
}
