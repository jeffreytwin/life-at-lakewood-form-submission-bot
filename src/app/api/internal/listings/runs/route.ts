import { NextRequest, NextResponse } from "next/server";
import { authorizeEngineRequest, engineErrorResponse } from "@/lib/listings/auth";
import { listRuns } from "@/lib/listings/hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/listings/runs?limit=&before=&runKey=&runKeys=
 *
 * Runs newest first for the Change Log; `before` (a started_at) pages
 * back, `runKey` fetches one run, `runKeys` (comma-separated) a known set.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  const q = request.nextUrl.searchParams;
  const limit = Number.parseInt(q.get("limit") ?? "", 10);
  try {
    return NextResponse.json(
      await listRuns({
        limit: Number.isFinite(limit) ? limit : undefined,
        before: q.get("before") ?? undefined,
        runKey: q.get("runKey") ?? undefined,
        runKeys: q.get("runKeys")?.split(",").filter(Boolean) ?? undefined,
      })
    );
  } catch (error) {
    return engineErrorResponse(error, "Listings runs failed");
  }
}
