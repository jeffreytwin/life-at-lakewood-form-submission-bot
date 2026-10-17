import { NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { scanAnnouncements } from "@/lib/community-alerts/announcements";

export const dynamic = "force-dynamic";
// Claude searches the web for each place; a search can take a few minutes.
export const maxDuration = 800;

/** POST /api/internal/community-alerts/announcements: the Search the web now button, the weekly search on demand. */
export async function POST() {
  try {
    return NextResponse.json(await scanAnnouncements());
  } catch (error) {
    logger.error("Announcement search failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
