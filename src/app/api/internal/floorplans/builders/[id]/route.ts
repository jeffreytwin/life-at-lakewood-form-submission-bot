import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/internal/floorplans/builders/:id
 * Body: { active: boolean }
 *
 * Pausing a builder is inert: the nightly run skips it entirely — no
 * scrape, no diff, and no removals can be queued from its absence.
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
      .from("fp_builders")
      .update({ active: body.active })
      .eq("id", id)
      .select("id, active")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Builder not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    logger.error("Failed to update builder", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
