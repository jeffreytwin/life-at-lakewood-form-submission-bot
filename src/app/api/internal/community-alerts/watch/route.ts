import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { addWatch, listWatch } from "@/lib/community-alerts/watch-list";

export const dynamic = "force-dynamic";

/** GET /api/internal/community-alerts/watch: what is watched, and what was found lately. */
export async function GET() {
  try {
    return NextResponse.json(await listWatch());
  } catch (error) {
    logger.error("Failed to read the watch list", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

/** POST /api/internal/community-alerts/watch  Body: { site, name, note?, sourceUrl? } */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const outcome = await addWatch({
      site: typeof body.site === "string" ? body.site : "",
      name: typeof body.name === "string" ? body.name : "",
      note: typeof body.note === "string" ? body.note : null,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true, id: outcome.id });
  } catch (error) {
    logger.error("Failed to add to the watch list", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
