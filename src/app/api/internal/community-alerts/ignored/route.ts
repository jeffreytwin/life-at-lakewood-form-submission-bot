import { NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { listIgnored } from "@/lib/community-alerts/alerts";

export const dynamic = "force-dynamic";

/** GET /api/internal/community-alerts/ignored: the neighborhoods no scan raises. */
export async function GET() {
  try {
    return NextResponse.json({ ignored: await listIgnored() });
  } catch (error) {
    logger.error("Failed to read ignored neighborhoods", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
