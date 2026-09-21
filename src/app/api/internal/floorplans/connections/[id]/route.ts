import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { clearConnection } from "@/lib/floorplans/connection-clear";

export const dynamic = "force-dynamic";
// A removal takes the connection's items out of Wix one by one.
export const maxDuration = 300;

/**
 * PATCH /api/internal/floorplans/connections/:id
 * Body: { active?: boolean, url?: string, dismissAttention?: true }
 *
 * Pause/resume a single builder×community connection (same inert-pause
 * semantics as the builder-level flag), set its builder page URL, or
 * dismiss it from the "needs attention" banner until a newer run of it
 * fails again (Jeff, 2026-09-21).
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
    if (body.dismissAttention === true) updates.attention_dismissed_at = new Date().toISOString();
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "active (boolean), url (string) or dismissAttention (true) required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("fp_builder_communities")
      .update(updates)
      .eq("id", id)
      .select("id, active, extractor_params, attention_dismissed_at")
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

/**
 * DELETE /api/internal/floorplans/connections/:id
 *
 * Removes a connection for good, the way a sold-out neighborhood leaves
 * (Jeff, 2026-09-21): every plan it put on the site and in the Hub goes
 * (connection-clear.ts), then the connection itself. The community and
 * builder rows stay; other connections may use them. The Hub asks for the
 * word REMOVE before calling this.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const outcome = await clearConnection(id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const { error } = await supabase.from("fp_builder_communities").delete().eq("id", id);
    if (error) throw error;
    logger.info("Floor plan connection removed", { connectionId: id, ...outcome.result });
    return NextResponse.json(outcome.result);
  } catch (error) {
    logger.error("Failed to remove builder connection", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
