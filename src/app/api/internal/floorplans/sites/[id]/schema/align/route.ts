import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getDataCollection, updateDataCollection } from "@/lib/wix/client";
import { alignedFields, diffFields, type FieldSpec } from "@/lib/floorplans/collection-schema";
import { STANDARD_COLLECTION_ID, STANDARD_FLOOR_PLAN_FIELDS } from "@/lib/floorplans/standard-schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/floorplans/sites/:id/schema/align
 * Body: { add?: boolean, relabel?: boolean, removeExtra?: boolean }
 *
 * Makes this site's Floor Plans V2 collection carry the standard
 * (standard-schema.ts): missing fields added and labels aligned (both on
 * by default, each can be turned off); fields the standard lacks removed
 * only when removeExtra is true, because removing a field deletes its
 * data on every item. A field whose type differs is reported and left
 * alone: Wix cannot retype a field in place. Nothing is sent to Wix when
 * there is nothing to change.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const options = {
      add: body?.add !== false,
      relabel: body?.relabel !== false,
      removeExtra: body?.removeExtra === true,
    };

    const { data: site, error } = await supabase
      .from("fp_sites")
      .select("id, domain, wix_site_id, wix_collection_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });
    if (!site.wix_site_id) return NextResponse.json({ error: "Site has no wix_site_id" }, { status: 400 });
    const collectionId = site.wix_collection_id ?? STANDARD_COLLECTION_ID;

    const collection = await getDataCollection(site.wix_site_id, collectionId);
    if (!collection) return NextResponse.json({ error: `${collectionId} not found on ${site.domain}` }, { status: 404 });

    const current = collection.fields as FieldSpec[];
    const { mismatched } = diffFields(STANDARD_FLOOR_PLAN_FIELDS, current);
    const { fields, added, removed, relabeled } = alignedFields(STANDARD_FLOOR_PLAN_FIELDS, current, options);
    if (!added.length && !removed.length && !relabeled.length) {
      return NextResponse.json({ changed: false, added, removed, relabeled, mismatched });
    }

    const updated = await updateDataCollection(site.wix_site_id, { ...collection, fields });
    logger.info("Floor Plans V2 schema aligned to the standard", {
      site: site.domain,
      added,
      removed,
      relabeled,
      mismatched: mismatched.map((m) => m.key),
      revision: updated.revision ?? null,
    });
    return NextResponse.json({
      changed: true,
      added,
      removed,
      relabeled,
      mismatched,
      revision: updated.revision ?? null,
      fieldCount: updated.fields.length,
    });
  } catch (error) {
    logger.error("Failed to align Floor Plans V2 schema", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 502 });
  }
}
