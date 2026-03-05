import type { Agent, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore, ScoringContext } from "./types";
import { scoreCloseRate } from "./factors/close-rate";
import { scoreLeadLoad } from "./factors/lead-load";
import { agentMatchesLocation } from "./factors/location-match";
import { agentMatchesPriceRange } from "./factors/price-range";
import { agentIsAvailable } from "./factors/availability";
import {
  SPECIALTY_BONUS_MULTIPLIER,
  DAILY_CAP_AT_MAX_MULTIPLIER,
  DAILY_CAP_RAMP_START_PCT,
} from "@/lib/shared/constants";

/**
 * Returns a multiplier for location specialty match.
 * Agents with specific matching specialties get a bonus (1.15x).
 * Generalists (no specialties = match all) get 1.0x.
 */
function specialtyMultiplier(agent: Agent, context: ScoringContext): number {
  const specialties = agent.location_specialties;

  // Generalists (no specialties) get no bonus
  if (!specialties || specialties.length === 0) return 1.0;

  // Agent has specialties and passed the hard filter, so they match — give bonus
  return SPECIALTY_BONUS_MULTIPLIER;
}

/**
 * Returns a multiplier based on how close the agent is to their daily cap.
 * - Well under cap: 1.0 (no penalty)
 * - Approaching cap: gentle ramp down
 * - At/over cap: DAILY_CAP_AT_MAX_MULTIPLIER (e.g. 0.3)
 *
 * Agents with daily_lead_max <= 0 have no cap (always 1.0).
 */
function dailyCapMultiplier(agent: Agent, context: ScoringContext): number {
  if (agent.daily_lead_max <= 0) return 1.0;

  const todayCount = context.dailyLeadCounts.get(agent.id) ?? 0;
  const max = agent.daily_lead_max;

  if (todayCount >= max) return DAILY_CAP_AT_MAX_MULTIPLIER;

  const rampStart = Math.floor(max * DAILY_CAP_RAMP_START_PCT);
  if (todayCount <= rampStart) return 1.0;

  // Linear ramp from 1.0 down to DAILY_CAP_AT_MAX_MULTIPLIER
  const progress = (todayCount - rampStart) / (max - rampStart);
  return 1.0 - progress * (1.0 - DAILY_CAP_AT_MAX_MULTIPLIER);
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

  const baseScore =
    factors.close_rate * (w.close_rate / norm) +
    factors.lead_load * (w.lead_load / norm);

  // Apply specialty bonus and daily cap penalty
  const specBonus = specialtyMultiplier(agent, context);
  const capPenalty = dailyCapMultiplier(agent, context);
  const totalScore = baseScore * specBonus * capPenalty;

  return {
    agentId: agent.id,
    agentName: agent.name,
    totalScore,
    factors,
    specialtyBonus: specBonus,
    dailyCapMultiplier: capPenalty,
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
 * then score and rank. Daily cap is now a soft penalty in scoring
 * (agents at/over cap get a 0.3x multiplier but are NOT excluded).
 * Specialty bonus gives a 1.15x multiplier to area specialists.
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
