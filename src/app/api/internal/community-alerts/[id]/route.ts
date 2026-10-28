import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { changeItem, completeAlert, dismissAlert, ignoreAlert, reopenAlert, type Outcome } from "@/lib/community-alerts/alerts";
import { watchFromAlert } from "@/lib/community-alerts/watch-list";
import { applySchoolZones } from "@/lib/school-zones/scan";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/internal/community-alerts/:id
 * Body, one of:
 *   { item, done?, choice?, notApplicable?, note? }  work one to-do item
 *   { complete: true }                               close it as done, its every item done or N/A
 *   { dismiss: "reason" }                            close it without the list done
 *   { ignore: "reason" }                             a new neighborhood or announcement: close it and never raise its name again
 *   { watch: true }                                  an announcement: put it on the watch list and close it
 *   { apply: true }                                  school zones: write the schools to the site's collection and close it
 *   { reopen: true }                                 open a closed alert again
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    let outcome: Outcome;
    if (body.complete === true) outcome = await completeAlert(id);
    else if (typeof body.dismiss === "string") outcome = await dismissAlert(id, body.dismiss);
    else if (typeof body.ignore === "string") outcome = await ignoreAlert(id, body.ignore);
    else if (body.watch === true) outcome = await watchFromAlert(id);
    else if (body.apply === true) outcome = await applySchoolZones(id);
    else if (body.reopen === true) outcome = await reopenAlert(id);
    else if (typeof body.item === "string") {
      outcome = await changeItem(id, body.item, {
        done: typeof body.done === "boolean" ? body.done : undefined,
        choice: typeof body.choice === "string" ? body.choice : undefined,
        notApplicable: typeof body.notApplicable === "boolean" ? body.notApplicable : undefined,
        note: typeof body.note === "string" || body.note === null ? body.note : undefined,
      });
    } else outcome = { ok: false, status: 400, error: "Nothing to do: send item, complete, dismiss, ignore, watch, apply or reopen" };
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to update a community alert", { id, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
