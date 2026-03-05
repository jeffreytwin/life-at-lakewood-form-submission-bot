import type { Agent, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore, ScoringContext } from "./types";
import { scoreCloseRate } from "./factors/close-rate";
import { scoreLeadLoad } from "./factors/lead-load";
import { agentMatchesLocation } from "./factors/location-match";
import { agentMatchesPriceRange } from "./factors/price-range";
import { agentIsAvailable } from "./factors/availability";

/**
 * Returns true if agent is under their daily lead cap.
 * Agents with daily_lead_max <= 0 have no cap (always under).
 */
function agentUnderDailyCap(agent: Agent, context: ScoringContext): boolean {
  if (agent.daily_lead_max <= 0) return true;
  const todayCount = context.dailyLeadCounts.get(agent.id) ?? 0;
  return todayCount < agent.daily_lead_max;
}

export function scoreAgent(
  agent: Agent,
  context: ScoringContext,
  weights?: Record<ScoringFactorKey, number>
): AgentScore {
  const w = weights ?? DEFAULT_GLOBAL_WEIGHTS;
  const total = w.close_rate + w.lead_load;

  // Normalize weights so they sum to 1.0
  const norm = total > 0 ? total : 1;

  const factors = {
    close_rate: scoreCloseRate(agent),
    lead_load: scoreLeadLoad(agent, context),
  };

  const totalScore =
    factors.close_rate * (w.close_rate / norm) +
    factors.lead_load * (w.lead_load / norm);

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
 * then score and rank. Daily cap is a soft-hard filter: prefer agents
 * under their cap, but if ALL eligible agents have hit their cap,
 * allow overflow to the highest-scored agent anyway.
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

  // Prefer agents under their daily cap
  const underCap = eligible.filter((a) => agentUnderDailyCap(a, context));

  // If at least one agent is under cap, only score those.
  // If ALL are at/over cap, allow overflow to any eligible agent.
  const pool = underCap.length > 0 ? underCap : eligible;

  const scored = scoreAgents(pool, context, weights);
  return scored[0] ?? null;
}
