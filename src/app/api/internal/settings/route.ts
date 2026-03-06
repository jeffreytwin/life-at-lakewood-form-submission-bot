import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const SETTINGS_COLUMNS =
  "routing_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, updated_at";

export async function GET() {
  // Try fetching all columns (including quiet hours).
  // Fall back to just routing_enabled if quiet hours columns don't exist yet.
  let { data, error } = await supabase
    .from("system_settings")
    .select(SETTINGS_COLUMNS)
    .eq("id", 1)
    .single();

  if (error) {
    const fallback = await supabase
      .from("system_settings")
      .select("routing_enabled, updated_at")
      .eq("id", 1)
      .single();

    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    data = {
      ...fallback.data,
      quiet_hours_enabled: true,
      quiet_hours_start: "21:00",
      quiet_hours_end: "08:30",
    };
  }

  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  // Build update payload from allowed fields
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.routing_enabled === "boolean") {
    update.routing_enabled = body.routing_enabled;
  }
  if (typeof body.quiet_hours_enabled === "boolean") {
    update.quiet_hours_enabled = body.quiet_hours_enabled;
  }
  if (typeof body.quiet_hours_start === "string") {
    update.quiet_hours_start = body.quiet_hours_start;
  }
  if (typeof body.quiet_hours_end === "string") {
    update.quiet_hours_end = body.quiet_hours_end;
  }

  // Must include at least one real field
  if (Object.keys(update).length <= 1) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Try updating with all columns. Fall back to core columns only if
  // quiet hours columns don't exist yet (migration not applied).
  let { data, error } = await supabase
    .from("system_settings")
    .update(update)
    .eq("id", 1)
    .select(SETTINGS_COLUMNS)
    .single();

  if (error) {
    // Strip quiet hours fields from the update payload and retry
    const coreUpdate: Record<string, unknown> = {
      updated_at: update.updated_at,
    };
    if (update.routing_enabled !== undefined) {
      coreUpdate.routing_enabled = update.routing_enabled;
    }

    const fallback = await supabase
      .from("system_settings")
      .update(coreUpdate)
      .eq("id", 1)
      .select("routing_enabled, updated_at")
      .single();

    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    data = {
      ...fallback.data,
      quiet_hours_enabled: true,
      quiet_hours_start: "21:00",
      quiet_hours_end: "08:30",
    };
  }

  return NextResponse.json(data);
}
