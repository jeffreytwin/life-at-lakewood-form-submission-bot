import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/internal/floorplans/connections/:id
 * Body: { active: boolean }
 *
 * Pause/resume a single builder×community connection. Same inert-pause
 * semantics as the builder-level flag.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active (boolean) is required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("fp_builder_communities")
      .update({ active: body.active })
      .eq("id", id)
      .select("id, active")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    logger.error("Failed to update builder connection", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
