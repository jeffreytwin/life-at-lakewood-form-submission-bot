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
    const updates: Record<string, unknown> = {};
    if (typeof body.active === "boolean") updates.active = body.active;
    if (typeof body.url === "string") {
      const trimmed = body.url.trim();
      if (trimmed && !/^https?:\/\//.test(trimmed)) {
        return NextResponse.json({ error: "url must be absolute (https://…)" }, { status: 400 });
      }
      const { data: current } = await supabase
        .from("fp_builder_communities")
        .select("extractor_params")
        .eq("id", id)
        .single();
      const params = { ...((current?.extractor_params as object) ?? {}) } as Record<string, unknown>;
      if (trimmed) params.url = trimmed;
      else delete params.url;
      updates.extractor_params = params;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "active (boolean) or url (string) required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("fp_builder_communities")
      .update(updates)
      .eq("id", id)
      .select("id, active, extractor_params")
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
