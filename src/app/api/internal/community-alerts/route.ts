import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { countOpen, listAlerts } from "@/lib/community-alerts/alerts";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/community-alerts?scope=open|closed
 * GET /api/internal/community-alerts?count=1 → { count } of open alerts, for the menu's badge
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    if (params.get("count")) return NextResponse.json({ count: await countOpen() });
    const scope = params.get("scope") === "closed" ? "closed" : "open";
    const alerts = await listAlerts(scope);
    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error) {
    logger.error("Failed to read community alerts", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
