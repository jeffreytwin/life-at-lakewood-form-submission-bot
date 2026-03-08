import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") ?? "7d";

    // Calculate cutoff date
    let cutoff: Date | null = null;
    const now = new Date();
    switch (range) {
      case "today":
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "3d":
        cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        break;
      case "7d":
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "14d":
        cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "all":
        cutoff = null;
        break;
      default:
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Fetch all routing attempts (responded + timed out) for per-agent stats
    let query = supabase
      .from("routing_attempts")
      .select("id, created_at, updated_at, status, agent:agents!routing_attempts_agent_id_fkey(id, name)")
      .in("status", ["accepted", "declined", "timed_out"]);

    if (cutoff) {
      query = query.gte("created_at", cutoff.toISOString());
    }

    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) throw error;

    // Group by agent
    const byAgent = new Map<string, {
      agentName: string;
      totalMinutes: number;
      responseCount: number;
      nonResponseCount: number;
    }>();

    for (const a of (data ?? [])) {
      const agentName = (a.agent as unknown as { name: string } | null)?.name ?? "Unknown";
      const entry = byAgent.get(agentName) ?? {
        agentName,
        totalMinutes: 0,
        responseCount: 0,
        nonResponseCount: 0,
      };

      if (a.status === "timed_out") {
        entry.nonResponseCount += 1;
      } else {
        const diffMs = new Date(a.updated_at).getTime() - new Date(a.created_at).getTime();
        const minutes = Math.max(0, diffMs / 60000);
        entry.totalMinutes += minutes;
        entry.responseCount += 1;
      }

      byAgent.set(agentName, entry);
    }

    const agentStats = Array.from(byAgent.values())
      .map((a) => ({
        agentName: a.agentName,
        avgMinutes: a.responseCount > 0
          ? Math.round((a.totalMinutes / a.responseCount) * 10) / 10
          : 0,
        responseCount: a.responseCount,
        nonResponseCount: a.nonResponseCount,
      }))
      .sort((a, b) => a.agentName.localeCompare(b.agentName));

    // Overall average (only from responded attempts)
    const totalResponses = agentStats.reduce((s, a) => s + a.responseCount, 0);
    const totalMinutes = agentStats.reduce((s, a) => s + a.avgMinutes * a.responseCount, 0);
    const overallAvg = totalResponses > 0
      ? Math.round((totalMinutes / totalResponses) * 10) / 10
      : 0;
    const totalNonResponses = agentStats.reduce((s, a) => s + a.nonResponseCount, 0);

    return NextResponse.json({
      agentStats,
      overallAvgMinutes: overallAvg,
      totalResponses,
      totalNonResponses,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
