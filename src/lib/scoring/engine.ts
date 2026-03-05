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
  MONTHLY_OVER_CAP_MULTIPLIER,
} from "@/lib/shared/constants";

/**
 * Returns true if agent is under their daily lead cap.
 * Agents with daily_lead_max <= 0 have no cap (always under).
 */
function agentUnderDailyCap(agent: Agent, context: ScoringContext): boolean {
  if (agent.daily_lead_max <= 0) return true;
  const todayCount = context.dailyLeadCounts.get(agent.id) ?? 0;
  return todayCount < agent.daily_lead_max;
}

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
 * Returns a multiplier based on how far the agent is past their monthly max goal.
 * - Under max goal: 1.0 (no penalty)
 * - At max goal: MONTHLY_OVER_CAP_MULTIPLIER (e.g. 0.4)
 * - Further over: ramps down to floor of 0.1
 *
 * This is NOT a hard stop — agents over their monthly max can still receive
 * leads, but they're heavily deprioritized so agents under their min get fed first.
 */
function monthlyCapMultiplier(agent: Agent, context: ScoringContext): number {
  const maxGoal = agent.monthly_lead_goal_max;
  if (maxGoal <= 0) return 1.0; // No goal set

  const currentCount = context.currentMonthLeadCounts.get(agent.id) ?? 0;
  if (currentCount < maxGoal) return 1.0;

  // At max goal, apply the base penalty. Further over, ramp down more.
  // Each additional lead beyond max reduces multiplier, floored at 0.1
  const overBy = currentCount - maxGoal;
  const penalty = MONTHLY_OVER_CAP_MULTIPLIER - overBy * 0.05;
  return Math.max(penalty, 0.1);
}

export function scoreAgent(
  agent: Agent,
  context: ScoringContext,
  weights?: Record<ScoringFactorKey, number>
): AgentScore {
  const w = weights ?? DEFAULT_GLOBAL_WEIGHTS;
  const total = w.close_rate + w.lead_load;

  // Normalize weights, then apply power curve (^1.5) to amplify
  // differentiation: pushing a weight higher has more-than-proportional effect.
  const norm = total > 0 ? total : 1;
  const rawCR = w.close_rate / norm;
  const rawLL = w.lead_load / norm;
  const ampCR = Math.pow(rawCR, 1.5);
  const ampLL = Math.pow(rawLL, 1.5);
  const ampNorm = ampCR + ampLL > 0 ? ampCR + ampLL : 1;

  const factors = {
    close_rate: scoreCloseRate(agent),
    lead_load: scoreLeadLoad(agent, context),
  };

  const baseScore =
    factors.close_rate * (ampCR / ampNorm) +
    factors.lead_load * (ampLL / ampNorm);

  // Apply specialty bonus and monthly over-cap penalty
  const specBonus = specialtyMultiplier(agent, context);
  const monthlyCap = monthlyCapMultiplier(agent, context);
  const totalScore = baseScore * specBonus * monthlyCap;

  return {
    agentId: agent.id,
    agentName: agent.name,
    totalScore,
    factors,
    specialtyBonus: specBonus,
    monthlyCapMultiplier: monthlyCap,
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
 * then score and rank. Daily cap is a hard filter: prefer agents
 * under their cap, but if ALL eligible agents have hit their cap,
 * allow overflow to the highest-scored agent anyway.
 * Monthly over-cap is a soft penalty (0.4x multiplier, not a hard stop).
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

  // Prefer agents under their daily cap
  const underCap = eligible.filter((a) => agentUnderDailyCap(a, context));

  // If at least one agent is under cap, only score those.
  // If ALL are at/over cap, allow overflow to any eligible agent.
  const pool = underCap.length > 0 ? underCap : eligible;

  const scored = scoreAgents(pool, context, weights);
  return scored[0] ?? null;
}
