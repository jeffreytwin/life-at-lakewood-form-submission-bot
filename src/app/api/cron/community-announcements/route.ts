import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { scanAnnouncements } from "@/lib/community-alerts/announcements";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * GET /api/cron/community-announcements
 *
 * Once a week: Claude searches the web for new neighborhoods announced in
 * each place we cover, and each one nobody has dealt with raises an
 * announcement alert (announcements.ts).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await scanAnnouncements());
  } catch (error) {
    logger.error("Announcement search failed", { error: describeError(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
