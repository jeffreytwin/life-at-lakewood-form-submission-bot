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
        .eq("is_active", true),
      supabase.from("locations").select("*", { count: "exact", head: true }),
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

    return NextResponse.json({
      totalLeads: totalLeads ?? 0,
      totalAgents: totalAgents ?? 0,
      activeAgents: activeAgents ?? 0,
      totalLocations: totalLocations ?? 0,
      statusCounts,
      recentLeads: recentLeads ?? [],
      recentEvents: recentEvents ?? [],
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
