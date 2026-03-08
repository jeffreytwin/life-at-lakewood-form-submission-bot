import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const results = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }),
      supabase.from("agents").select("*", { count: "exact", head: true }),
      supabase
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_frontlines", false),
      supabase.from("locations").select("*", { count: "exact", head: true }).eq("is_active", true),
    ]);

    // Check if any query failed (indicates DB connection issue)
    const firstError = results.find((r) => r.error);
    if (firstError?.error) {
      throw firstError.error;
    }

    const [
      { count: totalLeads },
      { count: totalAgents },
      { count: activeAgents },
      { count: totalLocations },
    ] = results;

    // Count leads by status
    const { data: leads } = await supabase
      .from("leads")
      .select("routing_status")
      .order("created_at", { ascending: false })
      .limit(500);

    const statusCounts: Record<string, number> = {};
    for (const lead of leads ?? []) {
      statusCounts[lead.routing_status] =
        (statusCounts[lead.routing_status] ?? 0) + 1;
    }

    // Recent leads
    const { data: recentLeads } = await supabase
      .from("leads")
      .select("id, first_name, last_name, routing_status, created_at, form_name")
      .order("created_at", { ascending: false })
      .limit(10);

    // Recent audit events
    const { data: recentEvents } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    // Average time to acceptance (lead created → agent accepted)
    const { data: acceptedLeads } = await supabase
      .from("leads")
      .select("created_at, routing_attempts!inner(updated_at, status)")
      .eq("routing_status", "accepted")
      .eq("routing_attempts.status", "accepted");

    let avgAcceptanceMinutes: number | null = null;
    if (acceptedLeads && acceptedLeads.length > 0) {
      const totalMs = acceptedLeads.reduce((sum, lead) => {
        const attempts = lead.routing_attempts as Array<{ updated_at: string; status: string }>;
        const acceptedAt = attempts[0]?.updated_at;
        if (!acceptedAt) return sum;
        return sum + Math.max(0, new Date(acceptedAt).getTime() - new Date(lead.created_at).getTime());
      }, 0);
      avgAcceptanceMinutes = totalMs / acceptedLeads.length / 60000;
    }

    return NextResponse.json({
      totalLeads: totalLeads ?? 0,
      totalAgents: totalAgents ?? 0,
      activeAgents: activeAgents ?? 0,
      totalLocations: totalLocations ?? 0,
      statusCounts,
      recentLeads: recentLeads ?? [],
      recentEvents: recentEvents ?? [],
      avgAcceptanceMinutes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch stats",
        details: error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}
