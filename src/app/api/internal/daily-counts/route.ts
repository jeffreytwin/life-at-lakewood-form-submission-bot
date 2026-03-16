import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getTodayAcceptedCountsByAgent } from "@/lib/supabase/queries/routing-attempts";
import { getTodayEmailHandoffCountsByAgent } from "@/lib/supabase/queries/email-drafts";
import { getLastDailySyncTimestamp } from "@/lib/supabase/queries/hand-raise-snapshots";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Today in Eastern time (matches Salesforce report date context)
    const etDate = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });

    // Fetch Salesforce daily snapshots and the last sync timestamp in parallel
    const [sfResult, agentsResult, lastSfSync] = await Promise.all([
      supabase
        .from("hand_raise_snapshots")
        .select("salesforce_user_id, count")
        .eq("type", "daily_by_agent")
        .eq("year_month", etDate),
      supabase
        .from("agents")
        .select("id, salesforce_user_id")
        .not("salesforce_user_id", "is", null),
      getLastDailySyncTimestamp(),
    ]);

    if (sfResult.error) throw sfResult.error;
    if (agentsResult.error) throw agentsResult.error;

    const sfIdToAgentId = new Map<string, string>();
    for (const agent of agentsResult.data ?? []) {
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

    // Get bot/email counts created AFTER the last SF sync so we can add them
    // on top of the SF snapshot without double-counting.
    const [postSyncBotCounts, postSyncEmailCounts] = await Promise.all([
      getTodayAcceptedCountsByAgent(lastSfSync),
      getTodayEmailHandoffCountsByAgent(lastSfSync),
    ]);

    // Merge: SF snapshot + bot/email activity that occurred after the snapshot
    const merged: Record<string, number> = {};
    const allAgentIds = new Set([
      ...sfDailyCounts.keys(),
      ...postSyncBotCounts.keys(),
      ...postSyncEmailCounts.keys(),
    ]);
    for (const id of allAgentIds) {
      const sfCount = sfDailyCounts.get(id) ?? 0;
      const postSyncBot =
        (postSyncBotCounts.get(id) ?? 0) + (postSyncEmailCounts.get(id) ?? 0);
      merged[id] = sfCount + postSyncBot;
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
