import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { GOAL_METRICS } from "@/lib/war-room/metrics";
import { saveGoals } from "@/lib/war-room/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  goals: z
    .array(
      z.object({
        metric: z.enum(GOAL_METRICS as [string, ...string[]]),
        target: z.number().positive(),
        stretchTarget: z.number().positive().nullable(),
      }),
    )
    .refine((gs) => new Set(gs.map((g) => g.metric)).size === gs.length, "Each goal once"),
});

/**
 * PUT /api/internal/war-room/goals
 * Body: { year, goals: [{ metric, target, stretchTarget }] }. Replaces the
 * year's goals; a metric left out has its goal cleared.
 */
export async function PUT(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid goals" }, { status: 400 });
  }
  const { year, goals } = parsed.data;
  try {
    await saveGoals(year, goals as Parameters<typeof saveGoals>[1]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("War Room: saving goals failed", { year, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
