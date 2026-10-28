import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { runSchoolZoneScan } from "@/lib/school-zones/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * GET /api/cron/school-zones (October 1st, vercel.json)
 *
 * Once a year, when the districts have published the coming school
 * year's zones: every village against them, and an alert for each whose
 * page names other schools (school-zones/scan.ts).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runSchoolZoneScan("cron"));
  } catch (error) {
    logger.error("School zone scan failed", { error: describeError(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
