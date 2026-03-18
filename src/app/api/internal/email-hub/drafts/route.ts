import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const isSimulation = searchParams.get("is_simulation");
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    let query = supabase
      .from("email_drafts")
      .select("*, agents:agent_handoff_id(id, name, email)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      // "drafts" filter shows both drafted and approved statuses
      if (status === "drafted") {
        query = query.in("status", ["drafted", "approved"]);
      } else {
        query = query.eq("status", status);
      }
    }
    if (isSimulation !== null) {
      query = query.eq("is_simulation", isSimulation === "true");
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
