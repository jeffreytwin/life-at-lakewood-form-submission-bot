import { getActiveAgents } from "@/lib/supabase/queries/agents";
import {
  getDeclinedAgentIdsForLead,
  getTodayAcceptedCountsByAgent,
} from "@/lib/supabase/queries/routing-attempts";
import { getTodayEmailHandoffCountsByAgent } from "@/lib/supabase/queries/email-drafts";
import { supabase } from "@/lib/supabase/client";
import { selectBestAgent } from "@/lib/scoring/engine";
import type { Lead, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore } from "@/lib/scoring/types";
import { getLastDailySyncTimestamp } from "@/lib/supabase/queries/hand-raise-snapshots";

async function getCurrentMonthLeadCounts(): Promise<Map<string, number>> {
  const yearMonth = new Date().toISOString().slice(0, 7); // '2026-03'
  const { data, error } = await supabase
    .from("monthly_lead_counts")
    .select("agent_id, lead_count")
    .eq("year_month", yearMonth);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.agent_id, row.lead_count);
  }
  return counts;
}

/**
 * Get today's lead counts per agent from Salesforce-sourced daily snapshots.
 * Maps salesforce_user_id → agent.id using the provided agents list.
 * Uses Date_of_Positive_Response__c (stored as year_month in hand_raise_snapshots)
 * to determine which day each lead belongs to.
 */
async function getDailyLeadCounts(
  agents: { id: string; salesforce_user_id: string | null }[]
): Promise<Map<string, number>> {
  // Today in Eastern time (matches Salesforce report date context)
  const etDate = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // "2026-03-09"

  const { data, error } = await supabase
    .from("hand_raise_snapshots")
    .select("salesforce_user_id, count")
    .eq("type", "daily_by_agent")
    .eq("year_month", etDate);

  if (error) throw error;

  // Build salesforce_user_id → agent.id lookup
  const sfIdToAgentId = new Map<string, string>();
  for (const agent of agents) {
    if (agent.salesforce_user_id) {
      sfIdToAgentId.set(agent.salesforce_user_id, agent.id);
    }
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const agentId = sfIdToAgentId.get(row.salesforce_user_id ?? "");
    if (agentId) {
      counts.set(agentId, row.count);
    }
  }
  return counts;
}

async function getWeights(): Promise<Record<ScoringFactorKey, number>> {
  const { data } = await supabase
    .from("scoring_weights")
    .select("close_rate, lead_load")
    .limit(1)
    .single();

  if (data) {
    return {
      close_rate: data.close_rate,
      lead_load: data.lead_load,
    };
  }

  return DEFAULT_GLOBAL_WEIGHTS;
}

export async function selectNextAgent(
  lead: Lead,
  locationName: string
): Promise<AgentScore | null> {
  const [agents, excludedIds, leadCounts, weights] = await Promise.all([
    getActiveAgents(),
    getDeclinedAgentIdsForLead(lead.id),
    getCurrentMonthLeadCounts(),
    getWeights(),
  ]);

  // Daily counts need the agents list to map salesforce_user_id → agent.id
  const [sfDailyCounts, lastSfSync] = await Promise.all([
    getDailyLeadCounts(agents),
    getLastDailySyncTimestamp(),
  ]);

  // Get bot/email counts created AFTER the last SF sync so we can add them
  // on top of the SF snapshot without double-counting.
  // When there's no SF sync, pass null to count all bot/email leads today.
  const [postSyncBotCounts, postSyncEmailCounts] = await Promise.all([
    getTodayAcceptedCountsByAgent(lastSfSync),
    getTodayEmailHandoffCountsByAgent(lastSfSync),
  ]);

  // Merge: SF snapshot + bot/email activity that occurred after the snapshot
  const dailyCounts = new Map<string, number>();
  const allAgentIds = new Set([
    ...sfDailyCounts.keys(),
    ...postSyncBotCounts.keys(),
    ...postSyncEmailCounts.keys(),
  ]);
  for (const id of allAgentIds) {
    const sfCount = sfDailyCounts.get(id) ?? 0;
    const postSyncBot =
      (postSyncBotCounts.get(id) ?? 0) + (postSyncEmailCounts.get(id) ?? 0);
    dailyCounts.set(id, sfCount + postSyncBot);
  }

  return selectBestAgent(
    agents,
    {
      lead,
      locationName,
      currentMonthLeadCounts: leadCounts,
      dailyLeadCounts: dailyCounts,
      currentTime: new Date(),
    },
    excludedIds,
    weights
  );
}
