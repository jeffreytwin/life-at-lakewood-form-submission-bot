import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Current month in Eastern time
    const now = new Date();
    const etMonth = now.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
    });
    const [month, , year] = etMonth.split("/");
    const yearMonth = `${year}-${month}`;

    const { data, error } = await supabase
      .from("lead_distribution_snapshots")
      .select("agent_name, lead_count, synced_at")
      .eq("year_month", yearMonth)
      .order("agent_name");

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json({ distribution: [], asOf: null });
    }

    const distribution = data.map((r) => ({
      agentName: r.agent_name,
      leadCount: r.lead_count,
    }));

    // Use the most recent synced_at as the "as of" time
    const asOf = data.reduce((latest, r) =>
      r.synced_at > latest ? r.synced_at : latest,
      data[0].synced_at
    );

    return NextResponse.json({ distribution, asOf });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch lead distribution",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
