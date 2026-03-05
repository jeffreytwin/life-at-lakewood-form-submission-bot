import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("system_settings")
    .select("routing_enabled, updated_at")
    .eq("id", 1)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  if (typeof body.routing_enabled !== "boolean") {
    return NextResponse.json(
      { error: "routing_enabled must be a boolean" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("system_settings")
    .update({
      routing_enabled: body.routing_enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select("routing_enabled, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
