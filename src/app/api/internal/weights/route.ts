import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("scoring_weights")
      .select("*")
      .limit(1)
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...weights } = body;

    const weightValues = Object.values(weights).filter(
      (v): v is number => typeof v === "number"
    );
    const sum = weightValues.reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      return NextResponse.json(
        { error: `Weights must sum to 100, got ${sum}` },
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
      .update(weights)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error) },
      { status: 500 }
    );
  }
}
