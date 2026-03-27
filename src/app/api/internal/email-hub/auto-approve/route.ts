import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

/**
 * GET /api/internal/email-hub/auto-approve
 * Returns the current auto_approve_drafts setting and schedule.
 */
export async function GET() {
  const { data, error } = await supabase
    .from("system_settings")
    .select("auto_approve_drafts, auto_approve_schedule_time")
    .eq("id", 1)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    enabled: data.auto_approve_drafts ?? false,
    scheduleTime: data.auto_approve_schedule_time ?? null,
  });
}

/**
 * PUT /api/internal/email-hub/auto-approve
 * Toggle the auto_approve_drafts setting and/or update the schedule.
 * Body: { enabled?: boolean, scheduleTime?: string | null }
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.enabled !== undefined) {
    updates.auto_approve_drafts = Boolean(body.enabled);
  }

  if (body.scheduleTime !== undefined) {
    updates.auto_approve_schedule_time = body.scheduleTime || null;
  }

  const { error } = await supabase
    .from("system_settings")
    .update(updates)
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return current state
  const { data } = await supabase
    .from("system_settings")
    .select("auto_approve_drafts, auto_approve_schedule_time")
    .eq("id", 1)
    .single();

  return NextResponse.json({
    enabled: data?.auto_approve_drafts ?? false,
    scheduleTime: data?.auto_approve_schedule_time ?? null,
  });
}
