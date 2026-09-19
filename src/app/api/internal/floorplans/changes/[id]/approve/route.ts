import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { applyPendingChange } from "@/lib/floorplans/writeback";
import { approvalBlocker } from "@/lib/floorplans/approval";

export const dynamic = "force-dynamic";
// The write-back fetches, measures and imports every photo of the plan in
// turn before the Wix write; the default function limit is not enough
// for a full gallery. Same ceiling as the nightly tick.
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { data: change, error: loadError } = await supabase
      .from("fp_pending_changes")
      .select("id, status, change_type, proposed_record")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!change || change.status !== "pending") {
      return NextResponse.json({ error: "Change not found or not pending" }, { status: 409 });
    }
    // A base plan goes to the site with its score or not at all (approval.ts).
    const blocker = approvalBlocker(change.change_type, change.proposed_record);
    if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

    const { data: updated, error } = await supabase
      .from("fp_pending_changes")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) {
      return NextResponse.json(
        { error: "Change not found or not pending" },
        { status: 409 }
      );
    }

    const result = await applyPendingChange(id);
    return NextResponse.json(result, {
      status: result.status === "failed" ? 502 : 200,
    });
  } catch (error) {
    logger.error("Failed to approve floor plan change", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
