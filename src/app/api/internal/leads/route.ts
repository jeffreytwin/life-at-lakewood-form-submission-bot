import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);

    let query = supabase
      .from("leads")
      .select("*, routing_attempts(*, agent:agents!routing_attempts_agent_id_fkey(id, name, gender)), final_agent:agents!leads_final_agent_id_fkey(id, name, gender), location:locations!leads_location_id_fkey(id, name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== "all") {
      query = query.eq("routing_status", status);
    }

    const locationFilter = searchParams.get("location");
    if (locationFilter && locationFilter !== "all") {
      query = query.eq("location_id", locationFilter);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // Also fetch locations list for the filter dropdown
    const { data: locationsData } = await supabase
      .from("locations")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    return NextResponse.json({ leads: data ?? [], total: count ?? 0, locations: locationsData ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error) },
      { status: 500 }
    );
  }
}
