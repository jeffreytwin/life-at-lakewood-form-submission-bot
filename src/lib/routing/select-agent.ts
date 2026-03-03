import { getActiveAgents } from "@/lib/supabase/queries/agents";
import { getDeclinedAgentIdsForLead } from "@/lib/supabase/queries/routing-attempts";
import { supabase } from "@/lib/supabase/client";
import { selectBestAgent } from "@/lib/scoring/engine";
import type { Lead, ScoringWeights } from "@/lib/supabase/types";
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

async function getScoringWeights(): Promise<ScoringWeights> {
  const { data, error } = await supabase
    .from("scoring_weights")
    .select("*")
    .limit(1)
    .single();

  if (error) throw error;
  return data;
}

export async function selectNextAgent(
  lead: Lead,
  locationName: string
): Promise<AgentScore | null> {
  const [agents, excludedIds, leadCounts, weights] = await Promise.all([
    getActiveAgents(),
    getDeclinedAgentIdsForLead(lead.id),
    getCurrentMonthLeadCounts(),
    getScoringWeights(),
  ]);

  return selectBestAgent(agents, {
    lead,
    locationName,
    currentMonthLeadCounts: leadCounts,
    weights,
    currentTime: new Date(),
  }, excludedIds);
}
