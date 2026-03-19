import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

/**
 * GET /api/internal/email-hub/auto-approve
 * Returns the current auto_approve_drafts setting.
 */
export async function GET() {
  const { data, error } = await supabase
    .from("system_settings")
    .select("auto_approve_drafts")
    .eq("id", 1)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ enabled: data.auto_approve_drafts ?? false });
}

/**
 * PUT /api/internal/email-hub/auto-approve
 * Toggle the auto_approve_drafts setting.
 * Body: { enabled: boolean }
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const enabled = Boolean(body.enabled);

  const { error } = await supabase
    .from("system_settings")
    .update({
      auto_approve_drafts: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ enabled });
}
