import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { HOME_TYPES, isHomeType } from "@/lib/floorplans/standardize";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/internal/floorplans/builders/:id
 * Body: { active?: boolean, homeType?: string | null }
 *
 * Pausing a builder is inert: the nightly run skips it entirely — no
 * scrape, no diff, and no removals can be queued from its absence.
 *
 * A home type here is what every plan of this builder is, whatever its own
 * pages say (Jeff, 2026-09-22: Stock Luxury Homes builds single-family
 * homes and nothing else, and its pages name no type at all). It is kept
 * with the builder's other settings, and null clears it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const setsActive = typeof body.active === "boolean";
    const setsHomeType = "homeType" in body;
    if (!setsActive && !setsHomeType) {
      return NextResponse.json({ error: "active (boolean) or homeType (string|null) is required" }, { status: 400 });
    }
    if (setsHomeType && body.homeType !== null && !isHomeType(body.homeType)) {
      return NextResponse.json({ error: `homeType must be null or one of: ${HOME_TYPES.join(", ")}` }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (setsActive) update.active = body.active;
    if (setsHomeType) {
      // Read-modify-write: the same column carries the URL discovery hints.
      const { data: current, error: readError } = await supabase
        .from("fp_builders")
        .select("engine_config")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      if (!current) return NextResponse.json({ error: "Builder not found" }, { status: 404 });
      const config = { ...((current.engine_config as Record<string, unknown> | null) ?? {}) };
      if (body.homeType === null) delete config.homeType;
      else config.homeType = body.homeType;
      update.engine_config = config;
    }

    const { data, error } = await supabase
      .from("fp_builders")
      .update(update)
      .eq("id", id)
      .select("id, active, engine_config")
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
