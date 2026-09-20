import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { rewritePlan } from "@/lib/floorplans/writeback";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Plans are rewritten until this much of the request is spent; the rest come back as remaining for the next call. */
const BUDGET_MS = 230_000;

/**
 * POST /api/internal/floorplans/connections/:id/rewrite
 * Body: { done?: string[] }  (plan ids already rewritten by earlier calls)
 *
 * Writes every canonical plan of a connection to Wix again under the
 * current rules: pictures re-imported where needed and verified with Wix
 * before they are written, drawings as PNG; scores and edits kept. The
 * repair for rows written with a picture Wix could not show (The Isles,
 * 2026-09-20). Works within a time budget and reports what is left, so the
 * Hub calls it again until nothing remains.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const done = new Set<string>(Array.isArray(body?.done) ? body.done.filter((v: unknown) => typeof v === "string") : []);

    const { data: conn, error } = await supabase
      .from("fp_builder_communities")
      .select("id, builder_id, community_id, fp_communities:community_id(site_id)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    const community = conn.fp_communities as unknown as { site_id: string } | null;
    if (!community?.site_id) return NextResponse.json({ error: "Connection has no site" }, { status: 400 });

    const { data: plans, error: plansError } = await supabase
      .from("fp_floor_plans")
      .select("id, name")
      .match({ site_id: community.site_id, community_id: conn.community_id, builder_id: conn.builder_id })
      .is("removed_at", null)
      .order("name");
    if (plansError) throw plansError;

    const deadline = Date.now() + BUDGET_MS;
    const results: { id: string; name: string; status: string; error?: string }[] = [];
    let remaining = 0;
    for (const plan of plans ?? []) {
      if (done.has(plan.id)) continue;
      if (Date.now() > deadline) {
        remaining += 1;
        continue;
      }
      const outcome = await rewritePlan(plan.id);
      results.push({ id: plan.id, ...outcome });
    }
    logger.info("Floor plan connection rewrite", { connectionId: id, rewritten: results.length, remaining });
    return NextResponse.json({ results, remaining, total: plans?.length ?? 0 });
  } catch (error) {
    logger.error("Failed to rewrite a connection's plans", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
