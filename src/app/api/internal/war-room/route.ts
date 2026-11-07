import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { easternDate } from "@/lib/war-room/metrics";
import { easternParts, monthlyMetrics } from "@/lib/war-room/sample-metrics";
import { countLeadsToday, getGoals } from "@/lib/war-room/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/war-room?year=2026
 * The year's goals, its month-by-month numbers, and today's form
 * submissions. `goalsError` says why the goals couldn't be read (the
 * rest still comes back). `sample` is true while the numbers are sample figures,
 * before the Salesforce and ad-spend Zaps are connected.
 */
export async function GET(request: NextRequest) {
  const now = new Date();
  const thisYear = easternParts(now).year;
  const year = Number(request.nextUrl.searchParams.get("year")) || thisYear;
  try {
    let goalsError: string | null = null;
    const [goals, leadsToday] = await Promise.all([
      // A goals failure is shown on the Big Goals card; the rest of the page still loads.
      getGoals(year).catch((error) => {
        logger.error("War Room: loading goals failed", { year, error: describeError(error) });
        goalsError = describeError(error);
        return [];
      }),
      // The briefing's count is a nice-to-have: a failure here doesn't take the page down.
      countLeadsToday(easternDate(now)).catch((error) => {
        logger.error("War Room: counting today's form submissions failed", { error: describeError(error) });
        return null;
      }),
    ]);
    return NextResponse.json({
      year,
      now: now.toISOString(),
      goals,
      goalsError,
      months: monthlyMetrics(year, now),
      sample: true,
      leadsToday,
    });
  } catch (error) {
    logger.error("War Room: loading failed", { year, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
