import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { groupChanges } from "@/lib/floorplans/group-changes";
import { sortGalleryNow } from "@/lib/floorplans/sort-queue";
import { withRunContext } from "@/lib/floorplans/run-context";
import type { NormalizedPlan } from "@/lib/floorplans/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Galleries are sorted for this long in one request; the plans not begun
 * come back as `remaining` for the page to send again. A gallery of thirty
 * takes a minute at most, so the one begun last still finishes.
 */
const BUDGET_MS = 200_000;

interface Row {
  id: string;
  site_id: string;
  community_id: string;
  builder_id: string;
  plan_key: string;
  change_type: "add" | "update" | "remove";
  status: string;
  created_at: string;
  updated_at: string | null;
  proposed_record: NormalizedPlan | null;
}

/**
 * POST /api/internal/floorplans/changes/sort-photos
 * Body: { ids: string[] }
 *
 * Sorts the photos of the ticked plans in the queue at once, as the Sort
 * button in the edit overlay sorts one (Jeff, 2026-09-28): each photograph
 * once, then the front of the house, the rooms, the other outside views.
 * The rows of one plan carry the same record, so each plan is sorted once
 * and written to every pending row of it. Unlike a save from the overlay,
 * it is not a hand edit: the gallery is marked sorted, as the background
 * sort marks one, and later runs may still propose the builder's new
 * photos. A row a person saved in the meantime is left as they saved it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const ids: unknown = body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "ids (string[], at most 200) are required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("fp_pending_changes")
      .select("id, site_id, community_id, builder_id, plan_key, change_type, field_changed, status, created_at, updated_at, proposed_record")
      .in("id", ids)
      .eq("status", "pending");
    if (error) throw error;

    const started = Date.now();
    const results: { planKey: string; status: "sorted" | "skipped" | "failed"; photos: number; removed: number; error: string | null }[] = [];
    const remaining: string[] = [];
    for (const group of groupChanges((data ?? []) as Row[])) {
      const groupIds = group.rows.map((r) => r.id);
      const record = group.lead.proposed_record;
      const photos = Array.isArray(record?.galleryImages) ? record.galleryImages.length : 0;
      if (!record || group.lead.change_type === "remove" || photos < 2) {
        results.push({ planKey: group.lead.plan_key, status: "skipped", photos, removed: 0, error: null });
        continue;
      }
      if (Date.now() - started > BUDGET_MS) {
        remaining.push(...groupIds);
        continue;
      }
      try {
        const sorted = await withRunContext({ source: "sort-button" }, () => sortGalleryNow(record));
        const fields = {
          galleryImages: sorted.record.galleryImages,
          galleryMeta: sorted.record.galleryMeta,
          photosSorted: true,
          copiesChecked: true,
          ...(sorted.record.copiesOf ? { copiesOf: sorted.record.copiesOf } : {}),
        };
        for (const row of group.rows) {
          if (!row.proposed_record) continue;
          let update = supabase
            .from("fp_pending_changes")
            .update({ proposed_record: { ...row.proposed_record, ...fields }, updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("status", "pending");
          update = row.updated_at ? update.eq("updated_at", row.updated_at) : update.is("updated_at", null);
          const { error: writeError } = await update;
          if (writeError) throw writeError;
        }
        results.push({ planKey: group.lead.plan_key, status: "sorted", photos: sorted.record.galleryImages.length, removed: sorted.removed.length, error: null });
      } catch (sortError) {
        const message = sortError instanceof Error ? sortError.message : String(sortError);
        logger.warn("A ticked plan's photos could not be sorted", { planKey: group.lead.plan_key, error: message });
        results.push({ planKey: group.lead.plan_key, status: "failed", photos, removed: 0, error: message });
      }
    }
    logger.info("Ticked plans' photos sorted", {
      plans: results.length,
      sorted: results.filter((r) => r.status === "sorted").length,
      removed: results.reduce((n, r) => n + r.removed, 0),
      remaining: remaining.length,
    });
    return NextResponse.json({ results, remaining });
  } catch (error) {
    logger.error("Failed to sort the ticked plans' photos", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
