import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { authorizeEngineRequest } from "@/lib/listings/auth";
import { runReconcile } from "@/lib/listings/reconcile";
import { summarize, TICK_BUDGET_MS } from "@/lib/listings/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/listings/run
 * Body: { mode?: "incremental" | "full", allowMassDelete?: boolean,
 *         since?: ISO string (incremental only), maxPages?: number }
 *
 * Runs the engine once, now, whether or not the cron is enabled. This is
 * the Hub's "run now" button and the operator path for applying a removal
 * batch the mass-delete guard held back.
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    // an empty body is fine
  }
  const mode = body.mode === "full" ? "full" : "incremental";
  const since = typeof body.since === "string" && !Number.isNaN(Date.parse(body.since)) ? new Date(body.since) : undefined;
  const maxPages = Number.isInteger(body.maxPages) && (body.maxPages as number) > 0 ? (body.maxPages as number) : undefined;
  try {
    const result = await runReconcile({
      mode,
      trigger: "hub",
      deadline: Date.now() + TICK_BUDGET_MS,
      allowMassDelete: body.allowMassDelete === true,
      since,
      maxPages,
    });
    return NextResponse.json({ mode, ...summarize(result) }, { status: result.status === "error" ? 502 : 200 });
  } catch (error) {
    logger.error("Listings run failed", { error: errorMessage(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
