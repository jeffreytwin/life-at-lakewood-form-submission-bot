import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { triggerAgentHandoff } from "@/lib/gmail/trigger-handoff";

/**
 * POST /api/internal/email-hub/drafts/:id/handoff
 *
 * Triggers an agent handoff for a sent email draft.
 * Sends draft/thread/agent data to Zapier which updates Salesforce owner.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Accept agent_id from request body (new flow) or fall back to draft.agent_handoff_id (legacy)
    let bodyAgentId: string | null = null;
    try {
      const body = await request.json();
      bodyAgentId = body.agent_id ?? null;
    } catch {
      // No body or invalid JSON — that's fine, will use draft.agent_handoff_id
    }

    const result = await triggerAgentHandoff(id, bodyAgentId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Agent handoff transferred successfully",
    });
  } catch (error) {
    logger.error("Agent handoff failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
