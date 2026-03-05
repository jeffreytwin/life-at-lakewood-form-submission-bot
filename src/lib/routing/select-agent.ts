import { getActiveAgents } from "@/lib/supabase/queries/agents";
import { getDeclinedAgentIdsForLead } from "@/lib/supabase/queries/routing-attempts";
import { supabase } from "@/lib/supabase/client";
import { selectBestAgent } from "@/lib/scoring/engine";
import type { Lead, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore } from "@/lib/scoring/types";

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

async function getDailyLeadCounts(): Promise<Map<string, number>> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("leads")
    .select("final_agent_id")
    .gte("created_at", todayStart.toISOString())
    .not("final_agent_id", "is", null);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.final_agent_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
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
  const [agents, excludedIds, leadCounts, dailyCounts, weights] =
    await Promise.all([
      getActiveAgents(),
      getDeclinedAgentIdsForLead(lead.id),
      getCurrentMonthLeadCounts(),
      getDailyLeadCounts(),
      getWeights(),
    ]);

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
