import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

const COLUMNS = "fp_nightly_enabled, fp_nightly_hour, fp_digest_phone, fp_nightly_state";

export async function GET() {
  const { data, error } = await supabase
    .from("system_settings")
    .select(COLUMNS)
    .eq("id", 1)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.fp_nightly_enabled === "boolean") {
      updates.fp_nightly_enabled = body.fp_nightly_enabled;
    }
    if (Number.isInteger(body.fp_nightly_hour) && body.fp_nightly_hour >= 0 && body.fp_nightly_hour <= 23) {
      updates.fp_nightly_hour = body.fp_nightly_hour;
    }
    if (typeof body.fp_digest_phone === "string") {
      updates.fp_digest_phone = body.fp_digest_phone.trim() || null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid settings provided" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("system_settings")
      .update(updates)
      .eq("id", 1)
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    logger.error("Failed to update floor plan sync settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
