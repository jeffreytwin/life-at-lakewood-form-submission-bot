import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { clearConnection } from "@/lib/floorplans/connection-clear";
import { describeError } from "@/lib/shared/describe-error";

export const dynamic = "force-dynamic";
// A removal takes the connection's items out of Wix one by one.
export const maxDuration = 300;

/** A single address the connection is read from, as the body names it. */
const URL_FIELDS = ["url", "quickMoveInUrl"] as const;
/** A list of them: the pages one community's plans are listed on. */
const URL_LIST_FIELDS = ["listUrls"] as const;

const absolute = (url: string) => /^https?:\/\//.test(url);

/** One address per line, or a list; blank entries dropped. */
const asList = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : String(raw ?? "").split(/[\n,]+/)).map((u) => String(u).trim()).filter(Boolean);

/**
 * PATCH /api/internal/floorplans/connections/:id
 * Body: { active?, url?, listUrls?, quickMoveInUrl?, dismissAttention? }
 *
 * Pause/resume a single builder×community connection (same inert-pause
 * semantics as the builder-level flag), set the pages it is read from, or
 * dismiss it from the "needs attention" banner until a newer run of it
 * fails again (Jeff, 2026-09-21).
 *
 * Three kinds of page, all optional but `url`: the community's own
 * address; the pages its plans are listed on, where those are not the
 * community page (Perry splits a community by lot width and lists the
 * homes under each, Jeff 2026-09-22); and the separate page some builders
 * keep their quick move-ins on (Stock's /inventory/).
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

    const singles = URL_FIELDS.filter((field) => typeof body[field] === "string").map(
      (field) => [field, String(body[field]).trim()] as const
    );
    const lists = URL_LIST_FIELDS.filter((field) => field in body).map(
      (field) => [field, asList(body[field])] as const
    );

    for (const [field, value] of singles) {
      if (value && !absolute(value)) {
        return NextResponse.json({ error: `${field} must be absolute (https://…)` }, { status: 400 });
      }
    }
    for (const [field, urls] of lists) {
      const bad = urls.find((u) => !absolute(u));
      if (bad) {
        return NextResponse.json({ error: `${field} must be absolute URLs (https://…): ${bad}` }, { status: 400 });
      }
    }

    if (singles.length || lists.length) {
      // Read-modify-write, once: the other extractor params are the run's,
      // not ours, and two fields set together must not overwrite each other.
      const { data: current } = await supabase
        .from("fp_builder_communities")
        .select("extractor_params")
        .eq("id", id)
        .single();
      const next = { ...((current?.extractor_params as object) ?? {}) } as Record<string, unknown>;
      for (const [field, value] of singles) {
        if (value) next[field] = value;
        else delete next[field];
      }
      for (const [field, urls] of lists) {
        if (urls.length) next[field] = urls;
        else delete next[field];
      }
      updates.extractor_params = next;
    }

    if (body.dismissAttention === true) updates.attention_dismissed_at = new Date().toISOString();
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "active (boolean), url / quickMoveInUrl (string), listUrls (list) or dismissAttention (true) required" },
        { status: 400 }
      );
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
    const why = describeError(error);
    logger.error("Failed to remove builder connection", { id, error: why });
    return NextResponse.json({ error: why }, { status: 500 });
  }
}
