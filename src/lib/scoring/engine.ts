import type { Agent } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore, ScoringContext } from "./types";
import { scoreCloseRate } from "./factors/close-rate";
import { scoreLeadLoad } from "./factors/lead-load";
import { agentMatchesLocation } from "./factors/location-match";
import { agentMatchesPriceRange } from "./factors/price-range";
import { agentIsAvailable } from "./factors/availability";

export function scoreAgent(agent: Agent, context: ScoringContext): AgentScore {
  const weights = DEFAULT_GLOBAL_WEIGHTS;

  const factors = {
    close_rate: scoreCloseRate(agent),
    lead_load: scoreLeadLoad(agent, context),
  };

  const totalScore =
    factors.close_rate * weights.close_rate +
    factors.lead_load * weights.lead_load;

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
 * Hard-filter agents by location, price range, and availability,
 * then score and rank.
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
      agentMatchesPriceRange(agent, context) &&
      agentIsAvailable(agent, context)
  );

  if (eligible.length === 0) return null;

  const scored = scoreAgents(eligible, context);
  return scored[0] ?? null;
}
