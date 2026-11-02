import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { feesDueIn, raiseFeeCheck } from "@/lib/community-alerts/hoa-cdd";

export const dynamic = "force-dynamic";

/** The month in Florida, 1-12. */
const floridaMonth = (now: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" }).format(now));

/**
 * GET /api/cron/hoa-cdd (January 15th and October 15th, vercel.json)
 *
 * Twice a year, the HOA/CDD check: CDD fees in October, HOA dues in
 * January, an alert on each site with pages stating them (hoa-cdd.ts).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const fees = feesDueIn(floridaMonth(new Date()));
    if (fees.length === 0) return NextResponse.json({ skipped: "No HOA/CDD check is due this month" });
    const result = await raiseFeeCheck(fees, "cron");
    logger.info("HOA/CDD check raised", { ...result });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("HOA/CDD check failed", { error: describeError(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
