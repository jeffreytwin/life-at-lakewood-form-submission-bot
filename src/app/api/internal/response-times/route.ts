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

    // Fetch routing attempts that have a response (accepted or declined)
    let query = supabase
      .from("routing_attempts")
      .select("id, created_at, updated_at, status, agent:agents!routing_attempts_agent_id_fkey(id, name)")
      .in("status", ["accepted", "declined"]);

    if (cutoff) {
      query = query.gte("created_at", cutoff.toISOString());
    }

    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) throw error;

    // Calculate response times in minutes
    const attempts = (data ?? []).map((a) => {
      const diffMs = new Date(a.updated_at).getTime() - new Date(a.created_at).getTime();
      const minutes = Math.max(0, diffMs / 60000);
      return {
        date: a.created_at.slice(0, 10), // YYYY-MM-DD
        minutes: Math.round(minutes * 10) / 10, // 1 decimal place
        status: a.status,
        agentName: (a.agent as unknown as { name: string } | null)?.name ?? "Unknown",
      };
    });

    // Group by date and calculate daily average
    const byDate = new Map<string, { total: number; count: number }>();
    for (const a of attempts) {
      const entry = byDate.get(a.date) ?? { total: 0, count: 0 };
      entry.total += a.minutes;
      entry.count += 1;
      byDate.set(a.date, entry);
    }

    const dailyAverages = Array.from(byDate.entries())
      .map(([date, { total, count }]) => ({
        date,
        avgMinutes: Math.round((total / count) * 10) / 10,
        count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Overall average
    const totalMinutes = attempts.reduce((sum, a) => sum + a.minutes, 0);
    const overallAvg = attempts.length > 0
      ? Math.round((totalMinutes / attempts.length) * 10) / 10
      : 0;

    return NextResponse.json({
      dailyAverages,
      overallAvgMinutes: overallAvg,
      totalResponses: attempts.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
