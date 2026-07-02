import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

/** POST body: { starred: boolean } — marks a canonical plan as used in
 * brand emails; changes to starred plans create follow-up tasks. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    if (typeof body.starred !== "boolean") {
      return NextResponse.json({ error: "starred (boolean) is required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("fp_floor_plans")
      .update({ starred: body.starred, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, starred")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    logger.error("Failed to star plan", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
