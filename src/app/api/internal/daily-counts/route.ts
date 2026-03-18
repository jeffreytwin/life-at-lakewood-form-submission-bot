import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getTodayAcceptedCountsByAgent } from "@/lib/supabase/queries/routing-attempts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Today in Eastern time (matches Salesforce report date context)
    const etDate = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });

    // Fetch Salesforce daily snapshots
    const sfResult = await supabase
      .from("hand_raise_snapshots")
      .select("salesforce_user_id, count, synced_at")
      .eq("type", "daily_by_agent")
      .eq("year_month", etDate);

    if (sfResult.error) throw sfResult.error;

    // Build salesforce_user_id → agent.id lookup from agents table
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id, salesforce_user_id")
      .not("salesforce_user_id", "is", null);

    if (agentsError) throw agentsError;

    const sfIdToAgentId = new Map<string, string>();
    for (const agent of agents ?? []) {
      if (agent.salesforce_user_id) {
        sfIdToAgentId.set(agent.salesforce_user_id, agent.id);
      }
    }

    // Map SF snapshot counts to agent IDs and find latest sync timestamp
    const sfDailyCounts = new Map<string, number>();
    let latestSyncedAt: string | null = null;
    for (const row of sfResult.data ?? []) {
      const agentId = sfIdToAgentId.get(row.salesforce_user_id ?? "");
      if (agentId) {
        sfDailyCounts.set(agentId, row.count);
      }
      if (row.synced_at && (!latestSyncedAt || row.synced_at > latestSyncedAt)) {
        latestSyncedAt = row.synced_at;
      }
    }

    // Merge: SF snapshot as baseline + bot-local acceptances since last sync.
    // This ensures SF removals (e.g. 'Bad Data') are respected while new
    // acceptances between syncs are still counted.
    const botCountsSinceSync = await getTodayAcceptedCountsByAgent(latestSyncedAt);

    const merged: Record<string, number> = {};
    const allAgentIds = new Set([
      ...sfDailyCounts.keys(),
      ...botCountsSinceSync.keys(),
    ]);
    for (const id of allAgentIds) {
      const sfCount = sfDailyCounts.get(id) ?? 0;
      const botSinceSync = botCountsSinceSync.get(id) ?? 0;
      merged[id] = sfCount + botSinceSync;
    }

    return NextResponse.json({ dailyCounts: merged, date: etDate, sfSyncedAt: latestSyncedAt });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch daily counts",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
