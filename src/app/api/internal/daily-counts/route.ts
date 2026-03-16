import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getTodayAcceptedCountsByAgent } from "@/lib/supabase/queries/routing-attempts";
import { getTodayEmailHandoffCountsByAgent } from "@/lib/supabase/queries/email-drafts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Today in Eastern time (matches Salesforce report date context)
    const etDate = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });

    // Fetch Salesforce daily snapshots, bot-local counts, and email handoffs in parallel
    const [sfResult, botDailyCounts, emailHandoffCounts] = await Promise.all([
      supabase
        .from("hand_raise_snapshots")
        .select("salesforce_user_id, count")
        .eq("type", "daily_by_agent")
        .eq("year_month", etDate),
      getTodayAcceptedCountsByAgent(),
      getTodayEmailHandoffCountsByAgent(),
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

    // Merge: sum bot-local routing attempts + email handoffs, then take max vs Salesforce
    const merged: Record<string, number> = {};
    const allAgentIds = new Set([
      ...sfDailyCounts.keys(),
      ...botDailyCounts.keys(),
      ...emailHandoffCounts.keys(),
    ]);
    for (const id of allAgentIds) {
      const botTotal =
        (botDailyCounts.get(id) ?? 0) + (emailHandoffCounts.get(id) ?? 0);
      merged[id] = Math.max(sfDailyCounts.get(id) ?? 0, botTotal);
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
