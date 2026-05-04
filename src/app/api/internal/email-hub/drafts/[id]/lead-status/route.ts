import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { updateDraftLeadStatus } from "@/lib/email/update-lead-status";

/**
 * POST /api/internal/email-hub/drafts/:id/lead-status
 *
 * Sends a Zapier webhook to update the Salesforce lead status
 * and records which status was set on the draft.
 *
 * Body: { status: "nurture_active" | "disqualified" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !["nurture_active", "disqualified"].includes(status)) {
      return NextResponse.json(
        { error: "status must be 'nurture_active' or 'disqualified'" },
        { status: 400 }
      );
    }

    const result = await updateDraftLeadStatus(id, status);

    if (!result.success) {
      const httpStatus = result.alreadyApplied ? 400 : result.error === "Draft not found" ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status: httpStatus });
    }

    return NextResponse.json({ success: true, status });
  } catch (error) {
    logger.error("Lead status update failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
