import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { removePlace, savePlace } from "@/lib/school-zones/places";

export const dynamic = "force-dynamic";

/** POST { domain, name, address }: place a village no listing places. DELETE ?id=: forget one. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const outcome = await savePlace(String(body.domain ?? ""), String(body.name ?? ""), String(body.address ?? ""));
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to save a school zone address", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Say which address" }, { status: 400 });
  try {
    const outcome = await removePlace(id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to remove a school zone address", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
