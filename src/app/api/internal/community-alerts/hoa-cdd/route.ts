import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { FEES, feeSites, listFeePages, nextChecks, raiseFeeCheck, type Fee } from "@/lib/community-alerts/hoa-cdd";

export const dynamic = "force-dynamic";

/** GET /api/internal/community-alerts/hoa-cdd: the pages to check, the sites, and when the next checks are. */
export async function GET() {
  try {
    const [pages, sites] = await Promise.all([listFeePages(), feeSites()]);
    return NextResponse.json({ pages, sites, next: nextChecks(new Date()) });
  } catch (error) {
    logger.error("Failed to read the HOA/CDD pages", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

/** POST { fees: ["hoa", "cdd"] }: the Start a check now button. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const fees = FEES.filter((f) => Array.isArray(body?.fees) && body.fees.includes(f)) as Fee[];
    if (fees.length === 0) return NextResponse.json({ error: "Say which to check: HOA dues, CDD fees or both" }, { status: 400 });
    return NextResponse.json(await raiseFeeCheck(fees, "hub"));
  } catch (error) {
    logger.error("HOA/CDD check failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
