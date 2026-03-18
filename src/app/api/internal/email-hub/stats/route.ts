import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get current month boundaries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

    // Total drafts generated this month
    const { count: totalDrafts } = await supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("is_simulation", false)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    // Approved drafts this month
    const { count: approvedDrafts } = await supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("is_simulation", false)
      .not("approved_at", "is", null)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    // Sent emails this month
    const { count: sentEmails } = await supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .eq("is_simulation", false)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    // Pending drafts (all time, current queue)
    const { count: pendingDrafts } = await supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .in("status", ["drafted", "approved"])
      .eq("is_simulation", false);

    // Agent handoffs this month
    const { count: agentHandoffs } = await supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("agent_handoff_transferred", true)
      .eq("is_simulation", false)
      .gte("agent_handoff_transferred_at", monthStart)
      .lt("agent_handoff_transferred_at", monthEnd);

    // Drafts per day this month (for graph)
    const { data: monthDrafts } = await supabase
      .from("email_drafts")
      .select("created_at, status, sent_at")
      .eq("is_simulation", false)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd)
      .order("created_at", { ascending: true });

    // Aggregate by day
    const dailyStats: Record<string, { drafted: number; sent: number }> = {};
    for (const d of monthDrafts ?? []) {
      const day = new Date(d.created_at).toISOString().split("T")[0];
      if (!dailyStats[day]) dailyStats[day] = { drafted: 0, sent: 0 };
      dailyStats[day].drafted++;
      if (d.status === "sent") dailyStats[day].sent++;
    }

    const dailyGraph = Object.entries(dailyStats)
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Recent emails (mix of drafts and sent, last 20 — exclude discarded)
    const { data: recentEmails } = await supabase
      .from("email_drafts")
      .select("id, status, subject, created_at, sent_at, approved_at, agent_handoff_transferred")
      .eq("is_simulation", false)
      .neq("status", "discarded")
      .order("created_at", { ascending: false })
      .limit(20);

    // Agent handoffs per agent this month (for handoffs graph)
    const { data: handoffDrafts } = await supabase
      .from("email_drafts")
      .select("agent_handoff_id")
      .eq("agent_handoff_transferred", true)
      .eq("is_simulation", false)
      .gte("agent_handoff_transferred_at", monthStart)
      .lt("agent_handoff_transferred_at", monthEnd);

    // Count per agent
    const handoffCounts: Record<string, number> = {};
    for (const d of handoffDrafts ?? []) {
      if (d.agent_handoff_id) {
        handoffCounts[d.agent_handoff_id] = (handoffCounts[d.agent_handoff_id] ?? 0) + 1;
      }
    }

    // Resolve agent names
    const agentIds = Object.keys(handoffCounts);
    let agentHandoffGraph: { agentName: string; handoffs: number }[] = [];
    if (agentIds.length > 0) {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, name")
        .in("id", agentIds);

      const nameMap: Record<string, string> = {};
      for (const a of agents ?? []) {
        nameMap[a.id] = a.name;
      }

      agentHandoffGraph = agentIds
        .map((id) => ({
          agentName: nameMap[id] ?? "Unknown",
          handoffs: handoffCounts[id],
        }))
        .sort((a, b) => b.handoffs - a.handoffs);
    }

    return NextResponse.json({
      totalDrafts: totalDrafts ?? 0,
      approvedDrafts: approvedDrafts ?? 0,
      sentEmails: sentEmails ?? 0,
      pendingDrafts: pendingDrafts ?? 0,
      agentHandoffs: agentHandoffs ?? 0,
      dailyGraph,
      recentEmails: recentEmails ?? [],
      agentHandoffGraph,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
