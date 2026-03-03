import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { validateAdminAuth } from "@/lib/shared/admin-auth";
import { logger } from "@/lib/shared/logger";

export async function GET(request: NextRequest) {
  const authError = validateAdminAuth(request);
  if (authError) return authError;

  try {
    const { data, error } = await supabase
      .from("scoring_weights")
      .select("*")
      .limit(1)
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    logger.error("Failed to fetch scoring weights", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = validateAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, ...weights } = body;

    // Validate weights sum to 100
    const sum = Object.values(weights).reduce(
      (acc: number, val) => acc + (typeof val === "number" ? val : 0),
      0
    );
    if (sum !== 100) {
      return NextResponse.json(
        { error: `Weights must sum to 100, got ${sum}` },
        { status: 400 }
      );
    }

    // Update the single weights row
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
    logger.error("Failed to update scoring weights", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
