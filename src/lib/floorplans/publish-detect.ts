// Publish detection: rows in synced_draft were written to Wix as drafts and
// are waiting for a human to publish them in the Wix CMS. A published item
// becomes visible to the default (published-only) read view — when we can
// see it there, promote the row to synced.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getItem } from "@/lib/wix/client";

export async function promoteSyncedDrafts(): Promise<{
  checked: number;
  promoted: number;
}> {
  const { data: rows, error } = await supabase
    .from("fp_pending_changes")
    .select("id, wix_record_id, fp_sites:site_id(wix_site_id, wix_collection_id)")
    .eq("status", "synced_draft")
    .not("wix_record_id", "is", null)
    .limit(200);
  if (error) throw error;

  let promoted = 0;
  for (const row of rows ?? []) {
    const site = row.fp_sites as unknown as {
      wix_site_id: string | null;
      wix_collection_id: string | null;
    } | null;
    if (!site?.wix_site_id || !site?.wix_collection_id || !row.wix_record_id) continue;
    try {
      // Published-only view: drafts are invisible here, so a hit means the
      // human published the item in the Wix CMS.
      const published = await getItem(
        site.wix_site_id,
        site.wix_collection_id,
        row.wix_record_id,
        false
      );
      if (published) {
        await supabase
          .from("fp_pending_changes")
          .update({ status: "synced", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        promoted += 1;
      }
    } catch (err) {
      logger.warn("Publish check failed for row", {
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (promoted > 0) {
    logger.info("Promoted published floor plan drafts", { promoted });
  }
  return { checked: rows?.length ?? 0, promoted };
}
