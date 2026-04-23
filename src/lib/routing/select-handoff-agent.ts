import { getActiveAgents } from "@/lib/supabase/queries/agents";
import { getTodayAcceptedCountsByAgent } from "@/lib/supabase/queries/routing-attempts";
import { supabase } from "@/lib/supabase/client";
import { selectBestAgent } from "@/lib/scoring/engine";
import type { Lead, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { AgentScore } from "@/lib/scoring/types";

async function getCurrentMonthLeadCounts(): Promise<Map<string, number>> {
  const yearMonth = new Date().toISOString().slice(0, 7);
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

async function getDailyLeadCounts(
  agents: { id: string; salesforce_user_id: string | null }[]
): Promise<{ counts: Map<string, number>; syncedAt: string | null }> {
  const etDate = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const { data, error } = await supabase
    .from("hand_raise_snapshots")
    .select("salesforce_user_id, count, synced_at")
    .eq("type", "daily_by_agent")
    .eq("year_month", etDate);

  if (error) throw error;

  const sfIdToAgentId = new Map<string, string>();
  for (const agent of agents) {
    if (agent.salesforce_user_id) {
      sfIdToAgentId.set(agent.salesforce_user_id, agent.id);
    }
  }

  const counts = new Map<string, number>();
  let latestSyncedAt: string | null = null;

  for (const row of data ?? []) {
    const agentId = sfIdToAgentId.get(row.salesforce_user_id ?? "");
    if (agentId) {
      counts.set(agentId, row.count);
    }
    if (row.synced_at && (!latestSyncedAt || row.synced_at > latestSyncedAt)) {
      latestSyncedAt = row.synced_at;
    }
  }
  return { counts, syncedAt: latestSyncedAt };
}

async function getWeights(): Promise<Record<ScoringFactorKey, number>> {
  const { data } = await supabase
    .from("scoring_weights")
    .select("close_rate, lead_load")
    .limit(1)
    .single();

  if (data) {
    return { close_rate: data.close_rate, lead_load: data.lead_load };
  }
  return DEFAULT_GLOBAL_WEIGHTS;
}

export interface HandoffSelectionInput {
  locationId: string | null;
  locationName: string;
  /** Optional price hint from the contact (e.g. "$500,000 - $600,000"). */
  priceHint?: string | null;
}

/**
 * Pick the best agent for an email handoff using the same scoring as form
 * submissions — but without inserting a routing_attempts row, so today's
 * handraise count for the selected agent is not affected.
 *
 * Returns null if no agent matches the hard filters (location, price range,
 * availability).
 */
export async function selectHandoffAgent(
  input: HandoffSelectionInput
): Promise<AgentScore | null> {
  const [agents, monthCounts, weights] = await Promise.all([
    getActiveAgents(),
    getCurrentMonthLeadCounts(),
    getWeights(),
  ]);

  const sfDaily = await getDailyLeadCounts(agents);
  const botCountsSinceSync = await getTodayAcceptedCountsByAgent(
    sfDaily.syncedAt
  );

  const dailyCounts = new Map<string, number>();
  const allAgentIds = new Set([
    ...sfDaily.counts.keys(),
    ...botCountsSinceSync.keys(),
  ]);
  for (const id of allAgentIds) {
    const sfCount = sfDaily.counts.get(id) ?? 0;
    const botSinceSync = botCountsSinceSync.get(id) ?? 0;
    dailyCounts.set(id, sfCount + botSinceSync);
  }

  // Stub Lead — scoring only reads `price` off it; everything else is
  // either ignored or covered by locationName/context. No DB side effects.
  const stubLead: Lead = {
    id: "handoff-stub",
    salesforce_record_id: null,
    location_id: input.locationId,
    form_name: null,
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    floor_plan: null,
    village: null,
    price: input.priceHint ?? null,
    home_type: null,
    property_address: null,
    url: null,
    builder: null,
    timeline: null,
    message: null,
    salesforce_owner_id: null,
    is_master_agent_owned: false,
    raw_payload: null,
    arrived_during_quiet_hours: false,
    routing_status: "pending",
    final_agent_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return selectBestAgent(
    agents,
    {
      lead: stubLead,
      locationName: input.locationName,
      currentMonthLeadCounts: monthCounts,
      dailyLeadCounts: dailyCounts,
      currentTime: new Date(),
    },
    [],
    weights
  );
}
