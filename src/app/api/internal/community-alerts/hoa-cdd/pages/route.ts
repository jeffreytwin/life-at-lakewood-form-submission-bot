import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { addFeePage, removeFeePage, updateFeePage } from "@/lib/community-alerts/hoa-cdd";
import type { Outcome } from "@/lib/community-alerts/alerts";

export const dynamic = "force-dynamic";

const reply = (outcome: Outcome) =>
  outcome.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: outcome.error }, { status: outcome.status });

/** POST { domain, label, url, hoa, cdd }: add a page to check. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return reply(
      await addFeePage({
        domain: String(body.domain ?? ""),
        label: String(body.label ?? ""),
        url: String(body.url ?? ""),
        hoa: body.hoa === true,
        cdd: body.cdd === true,
      })
    );
  } catch (error) {
    logger.error("Failed to add an HOA/CDD page", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

/** PATCH ?id= { hoa?, cdd? }: change which fees a page states. */
export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Say which page" }, { status: 400 });
  try {
    const body = await request.json();
    return reply(
      await updateFeePage(id, {
        hoa: typeof body.hoa === "boolean" ? body.hoa : undefined,
        cdd: typeof body.cdd === "boolean" ? body.cdd : undefined,
      })
    );
  } catch (error) {
    logger.error("Failed to update an HOA/CDD page", { id, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

/** DELETE ?id=: take a page off the list. */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Say which page" }, { status: 400 });
  try {
    return reply(await removeFeePage(id));
  } catch (error) {
    logger.error("Failed to remove an HOA/CDD page", { id, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
