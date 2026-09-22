// What a connection Reset does with the pictures it imported: their files
// leave the site's Media Manager, their rendered drawings leave storage,
// and their rows leave fp_media_map, so the next Run imports everything
// afresh and tests the whole path from the builder's site (Jeff,
// 2026-09-20: a Reset wipes everything). A picture another plan on the
// site still uses is kept, since its row would break without the file.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { failedAt } from "@/lib/shared/describe-error";
import { deleteMediaFiles } from "@/lib/wix/client";
import { askableBatches, isSvgUrl, mediaUrlsOf, RASTER_BUCKET, rasterStoragePath, urlsToRelease, wixFileIdOf } from "@/lib/floorplans/media";

export interface PlanScope {
  site_id: string;
  community_id: string;
  builder_id: string;
}

export interface MediaRelease {
  /** Source URLs this connection alone used. */
  urls: number;
  filesDeleted: number;
  filesFailed: string[];
  rasters: number;
  rows: number;
}

const CHUNK = 50;

/** The pictures of a connection's plans, canonical rows (removed ones too) and queued changes alike. */
async function urlsInScope(scope: PlanScope): Promise<string[]> {
  const { data: plans, error: plansError } = await supabase.from("fp_floor_plans").select("record").match(scope);
  if (plansError) throw failedAt("reading its plans' pictures", plansError);
  const { data: changes, error: changesError } = await supabase.from("fp_pending_changes").select("proposed_record").match(scope);
  if (changesError) throw failedAt("reading its queued pictures", changesError);
  return [...(plans ?? []).flatMap((p) => mediaUrlsOf(p.record)), ...(changes ?? []).flatMap((c) => mediaUrlsOf(c.proposed_record))];
}

/** The pictures every other live plan or open change on the site uses. */
async function urlsUsedElsewhere(scope: PlanScope): Promise<Set<string>> {
  const outside = (row: { community_id: string; builder_id: string }) =>
    !(row.community_id === scope.community_id && row.builder_id === scope.builder_id);
  const { data: plans, error: plansError } = await supabase
    .from("fp_floor_plans")
    .select("record, community_id, builder_id")
    .eq("site_id", scope.site_id)
    .is("removed_at", null);
  if (plansError) throw failedAt("reading the site's other plans' pictures", plansError);
  const { data: changes, error: changesError } = await supabase
    .from("fp_pending_changes")
    .select("proposed_record, community_id, builder_id")
    .eq("site_id", scope.site_id)
    .in("status", ["pending", "approved"]);
  if (changesError) throw failedAt("reading the site's other queued pictures", changesError);
  return new Set([
    ...(plans ?? []).filter(outside).flatMap((p) => mediaUrlsOf(p.record)),
    ...(changes ?? []).filter(outside).flatMap((c) => mediaUrlsOf(c.proposed_record)),
  ]);
}

/**
 * Removes the pictures only this connection used: from the Media Manager
 * (when the site has a Wix id), from storage (rendered drawings) and from
 * fp_media_map. A file Wix would not delete is logged and reported; the
 * rest still go. Call it before the connection's plans and changes are
 * deleted, since they say which pictures are in scope.
 */
export async function releaseConnectionMedia(wixSiteId: string | null, scope: PlanScope): Promise<MediaRelease> {
  const urls = urlsToRelease(await urlsInScope(scope), await urlsUsedElsewhere(scope));
  const result: MediaRelease = { urls: urls.length, filesDeleted: 0, filesFailed: [], rasters: 0, rows: 0 };
  if (!urls.length) return result;

  const rows: { source_url: string; wix_media_id: string; content_hash: string | null }[] = [];
  for (const batch of askableBatches(urls)) {
    const { data, error } = await supabase
      .from("fp_media_map")
      .select("source_url, wix_media_id, content_hash")
      .eq("site_id", scope.site_id)
      .in("source_url", batch);
    if (error) throw failedAt("looking the pictures up", error);
    rows.push(...(data ?? []));
  }
  if (!rows.length) return result;

  if (wixSiteId) {
    const fileIds = rows.map((r) => wixFileIdOf(r.wix_media_id)).filter((id): id is string => Boolean(id));
    const deletion = await deleteMediaFiles(wixSiteId, fileIds);
    result.filesDeleted = deletion.deleted.length;
    result.filesFailed = deletion.failed.map((f) => f.fileId);
    if (deletion.failed.length) {
      logger.warn("Reset could not delete some Media Manager files", { siteId: scope.site_id, failed: deletion.failed.slice(0, 10) });
    }
  }

  const rasterPaths = rows
    .filter((r) => r.content_hash && isSvgUrl(r.source_url))
    .map((r) => rasterStoragePath(scope.site_id, r.content_hash as string));
  for (let i = 0; i < rasterPaths.length; i += CHUNK) {
    const { data, error } = await supabase.storage.from(RASTER_BUCKET).remove(rasterPaths.slice(i, i + CHUNK));
    if (error) logger.warn("Reset could not remove rendered drawings from storage", { error: error.message });
    else result.rasters += data?.length ?? 0;
  }

  // The rows go whether or not Wix kept a file: a kept file is an orphan in
  // the Media Manager, not a broken row, and the next Run imports afresh.
  for (const batch of askableBatches(rows.map((r) => r.source_url))) {
    const { error } = await supabase
      .from("fp_media_map")
      .delete()
      .eq("site_id", scope.site_id)
      .in("source_url", batch);
    if (error) throw failedAt("forgetting the pictures", error);
  }
  result.rows = rows.length;
  return result;
}
