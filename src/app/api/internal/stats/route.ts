import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/** Compute start-of-day N days ago in Eastern time, returned as UTC ISO string */
function easternDayStart(daysAgo: number): string {
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  etNow.setHours(0, 0, 0, 0);
  etNow.setDate(etNow.getDate() - (daysAgo - 1)); // e.g. days=1 means start of today
  // Convert back to UTC: find the offset between the ET wall-clock midnight and UTC
  const etMidnightStr = `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}T00:00:00`;
  const naive = new Date(etMidnightStr);
  const sample = new Date(naive.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = sample.getTime() - naive.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 7;
    const cutoff = easternDayStart(days);

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

    // Count leads by status (all time, for other dashboard uses)
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

    // Count accepted leads within the selected period
    const { count: acceptedInPeriod } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("routing_status", "accepted")
      .gte("created_at", cutoff);

    // Recent leads
    const { data: recentLeads } = await supabase
      .from("leads")
      .select("id, first_name, last_name, routing_status, created_at, form_name, agents:final_agent_id(name)")
      .order("created_at", { ascending: false })
      .limit(10);

    // Recent audit events
    const { data: recentEvents } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    // Average time to acceptance (filtered by requested period)
    // Uses the immutable audit log timestamp rather than updated_at which
    // could shift if a row is ever touched after acceptance.
    const { data: acceptedEvents } = await supabase
      .from("audit_log")
      .select("lead_id, created_at")
      .eq("event_type", "accepted")
      .not("lead_id", "is", null)
      .gte("created_at", cutoff);

    let avgAcceptanceMinutes: number | null = null;
    if (acceptedEvents && acceptedEvents.length > 0) {
      // Fetch the corresponding lead created_at times
      const leadIds = [...new Set(acceptedEvents.map((e) => e.lead_id!))];
      const { data: acceptedLeads } = await supabase
        .from("leads")
        .select("id, created_at, arrived_during_quiet_hours")
        .in("id", leadIds);

      if (acceptedLeads && acceptedLeads.length > 0) {
        // Exclude bad_data leads from acceptance time calculations
        const { data: badDataLeads } = await supabase
          .from("leads")
          .select("id")
          .eq("routing_status", "bad_data")
          .in("id", leadIds);
        const badDataIds = new Set((badDataLeads ?? []).map((l) => l.id));

        // Build lookup maps
        const leadCreatedMap = new Map(acceptedLeads.map((l) => [l.id, l.created_at]));
        const quietHoursIds = new Set(
          acceptedLeads.filter((l) => l.arrived_during_quiet_hours).map((l) => l.id)
        );

        let totalMs = 0;
        let count = 0;
        for (const event of acceptedEvents) {
          if (badDataIds.has(event.lead_id!)) continue;
          // Skip leads that were tagged as arriving during quiet hours
          if (quietHoursIds.has(event.lead_id!)) continue;
          const leadCreated = leadCreatedMap.get(event.lead_id!);
          if (!leadCreated) continue;
          totalMs += Math.max(0, new Date(event.created_at).getTime() - new Date(leadCreated).getTime());
          count++;
        }
        if (count > 0) {
          avgAcceptanceMinutes = totalMs / count / 60000;
        }
      }
    }

    return NextResponse.json({
      totalLeads: totalLeads ?? 0,
      totalAgents: totalAgents ?? 0,
      activeAgents: activeAgents ?? 0,
      totalLocations: totalLocations ?? 0,
      statusCounts,
      acceptedInPeriod: acceptedInPeriod ?? 0,
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
