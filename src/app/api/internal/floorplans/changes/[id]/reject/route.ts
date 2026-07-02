import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { data: updated, error } = await supabase
      .from("fp_pending_changes")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
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
    return NextResponse.json({ status: "rejected" });
  } catch (error) {
    logger.error("Failed to reject floor plan change", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
