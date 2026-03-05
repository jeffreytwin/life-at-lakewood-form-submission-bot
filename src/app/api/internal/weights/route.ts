import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("scoring_weights")
      .select("id, close_rate, lead_load")
      .limit(1)
      .single();

    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const closeRate = typeof body.close_rate === "number" ? body.close_rate : null;
    const leadLoad = typeof body.lead_load === "number" ? body.lead_load : null;

    if (closeRate === null || leadLoad === null) {
      return NextResponse.json(
        { error: "close_rate and lead_load are required" },
        { status: 400 }
      );
    }

    if (closeRate + leadLoad !== 100) {
      return NextResponse.json(
        { error: `Weights must sum to 100, got ${closeRate + leadLoad}` },
        { status: 400 }
      );
    }

    const { data: existing } = await supabase
      .from("scoring_weights")
      .select("id")
      .limit(1)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Scoring weights not initialized" },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("scoring_weights")
      .update({ close_rate: closeRate, lead_load: leadLoad })
      .eq("id", existing.id)
      .select("id, close_rate, lead_load")
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
