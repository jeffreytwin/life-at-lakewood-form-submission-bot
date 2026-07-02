import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("fp_follow_up_tasks")
      .select(
        "id, task_type, detail, status, created_at, fp_floor_plans:floor_plan_id(name, fp_sites:site_id(domain))"
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    logger.error("Failed to fetch follow-up tasks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
