import { after, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { checkAllFlags } from "@/lib/floorplans/qmi-flags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How far back the page lists the flags the check fixed. */
const FIXES_SHOWN_DAYS = 14;

/**
 * GET /api/internal/floorplans/qmi-flags
 *
 * What the quick move-in flag check has done (qmi-flags.ts): when each
 * site was last checked, the flags it set or cleared lately, and the quick
 * move-ins it could not place.
 */
export async function GET() {
  const since = new Date(Date.now() - FIXES_SHOWN_DAYS * 86_400_000).toISOString();
  const [checked, fixes, problems] = await Promise.all([
    supabase
      .from("fp_qmi_flag_log")
      .select("site_id, detail, reason, created_at, fp_sites:site_id(name)")
      .eq("action", "checked")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("fp_qmi_flag_log")
      .select("id, plan_name, village, builder, action, detail, reason, created_at, fp_sites:site_id(name)")
      .in("action", ["set", "cleared"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("fp_qmi_flag_log")
      .select("id, plan_name, village, builder, action, detail, created_at, fp_sites:site_id(name)")
      .in("action", ["no-plan", "same-name"])
      .order("builder")
      .limit(300),
  ]);
  const error = checked.error ?? fixes.error ?? problems.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The latest full check of each site.
  const lastBySite = new Map<string, unknown>();
  for (const row of checked.data ?? []) if (!lastBySite.has(row.site_id as string)) lastBySite.set(row.site_id as string, row);
  return NextResponse.json({
    checked: [...lastBySite.values()],
    fixes: fixes.data ?? [],
    problems: problems.data ?? [],
    days: FIXES_SHOWN_DAYS,
  });
}

/** POST: check every site now; the check goes on after the answer. */
export async function POST() {
  after(async () => {
    try {
      await checkAllFlags({ reason: "checked by hand" });
    } catch (error) {
      logger.error("Quick move-in flag check failed", { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return NextResponse.json({ status: "started" }, { status: 202 });
}
