import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { unignore } from "@/lib/community-alerts/alerts";

export const dynamic = "force-dynamic";

/** DELETE /api/internal/community-alerts/ignored/:id: the next scan that finds homes there raises it again. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const outcome = await unignore(id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to un-ignore a neighborhood", { id, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
