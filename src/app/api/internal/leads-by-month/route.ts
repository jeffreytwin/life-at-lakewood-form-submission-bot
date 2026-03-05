import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("monthly_lead_counts")
      .select("year_month, lead_count, synced_at")
      .order("year_month");

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json({ months: [], asOf: null });
    }

    const months = data.map((r) => ({
      yearMonth: r.year_month,
      leadCount: r.lead_count,
    }));

    const asOf = data.reduce(
      (latest, r) => (r.synced_at > latest ? r.synced_at : latest),
      data[0].synced_at
    );

    return NextResponse.json({ months, asOf });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch monthly lead counts",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
