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

    // Fetch Salesforce daily snapshots and bot-local counts in parallel
    const [sfResult, botDailyCounts] = await Promise.all([
      supabase
        .from("hand_raise_snapshots")
        .select("salesforce_user_id, count")
        .eq("type", "daily_by_agent")
        .eq("year_month", etDate),
      getTodayAcceptedCountsByAgent(),
    ]);

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

    // Map SF snapshot counts to agent IDs
    const sfDailyCounts = new Map<string, number>();
    for (const row of sfResult.data ?? []) {
      const agentId = sfIdToAgentId.get(row.salesforce_user_id ?? "");
      if (agentId) {
        sfDailyCounts.set(agentId, row.count);
      }
    }

    // Merge: take max of bot-local routing attempts vs Salesforce daily snapshot
    const merged: Record<string, number> = {};
    const allAgentIds = new Set([
      ...sfDailyCounts.keys(),
      ...botDailyCounts.keys(),
    ]);
    for (const id of allAgentIds) {
      merged[id] = Math.max(
        sfDailyCounts.get(id) ?? 0,
        botDailyCounts.get(id) ?? 0
      );
    }

    return NextResponse.json({ dailyCounts: merged, date: etDate });
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
