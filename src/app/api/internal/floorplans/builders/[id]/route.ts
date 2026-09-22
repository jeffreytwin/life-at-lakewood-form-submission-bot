import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { HOME_TYPES, isHomeType } from "@/lib/floorplans/standardize";

export const dynamic = "force-dynamic";

/**
 * The two generic engines, which read the same pages the same way and
 * differ only in how the page is got. A builder on one can be switched to
 * the other; a builder with an engine of its own (Toll's API, Taylor
 * Morrison's) cannot be switched to either, since its engine is chosen by
 * name and would ignore this anyway.
 */
const GENERIC_METHODS = ["fetch_claude", "render_claude"] as const;

/**
 * PATCH /api/internal/floorplans/builders/:id
 * Body: { active?: boolean, homeType?: string | null, extractionMethod?: "fetch_claude" | "render_claude" }
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
    const setsMethod = "extractionMethod" in body;
    if (!setsActive && !setsHomeType && !setsMethod) {
      return NextResponse.json(
        { error: "active (boolean), homeType (string|null) or extractionMethod is required" },
        { status: 400 }
      );
    }
    if (setsMethod && !GENERIC_METHODS.includes(body.extractionMethod)) {
      return NextResponse.json(
        { error: `extractionMethod must be one of: ${GENERIC_METHODS.join(", ")}` },
        { status: 400 }
      );
    }
    if (setsHomeType && body.homeType !== null && !isHomeType(body.homeType)) {
      return NextResponse.json({ error: `homeType must be null or one of: ${HOME_TYPES.join(", ")}` }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (setsActive) update.active = body.active;
    if (setsMethod) {
      // Only between the two generic engines: a builder with an engine of
      // its own keeps it, whatever this says.
      const { data: current, error: readError } = await supabase
        .from("fp_builders")
        .select("extraction_method")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      if (!current) return NextResponse.json({ error: "Builder not found" }, { status: 404 });
      if (!GENERIC_METHODS.includes(current.extraction_method as (typeof GENERIC_METHODS)[number])) {
        return NextResponse.json(
          { error: `${current.extraction_method ?? "this builder"} has an engine of its own; it cannot be switched here` },
          { status: 400 }
        );
      }
      update.extraction_method = body.extractionMethod;
    }
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
      .select("id, active, engine_config, extraction_method")
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
