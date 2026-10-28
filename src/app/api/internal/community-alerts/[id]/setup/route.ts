import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { setUpVillage } from "@/lib/villages/setup";

export const dynamic = "force-dynamic";
// Claude reads the builder's and the community's pages first: a minute or two.
export const maxDuration = 800;

/**
 * POST /api/internal/community-alerts/:id/setup
 *
 * Set up village (Jeff, 2026-10-28): for a New Neighborhood alert, the
 * village's rows found or made as drafts and their blank fields filled
 * (villages/setup.ts). Answers with what was written.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const outcome = await setUpVillage(id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ setup: outcome.setup });
  } catch (error) {
    logger.error("Village setup failed", { id, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
