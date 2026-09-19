import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getDataCollection, updateDataCollection } from "@/lib/wix/client";
import { alignedFields, diffFields, type FieldSpec } from "@/lib/floorplans/collection-schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/floorplans/sites/:id/schema/align
 * Body: { referenceSiteId: string, removeExtra?: boolean }
 *
 * Makes this site's Floor Plans V2 collection carry the reference site's
 * fields: missing fields are added (and shared fields relabeled to match);
 * fields the reference lacks are removed only when removeExtra is true,
 * because removing a field deletes its data on every item. A field whose
 * type differs is reported and left alone: Wix cannot retype a field in
 * place. Nothing is sent to Wix when there is nothing to change.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const referenceSiteId = typeof body?.referenceSiteId === "string" ? body.referenceSiteId : null;
    const removeExtra = body?.removeExtra === true;
    if (!referenceSiteId) return NextResponse.json({ error: "referenceSiteId is required" }, { status: 400 });
    if (referenceSiteId === id) return NextResponse.json({ error: "A site cannot be aligned to itself" }, { status: 400 });

    const { data: sites, error } = await supabase
      .from("fp_sites")
      .select("id, domain, wix_site_id, wix_collection_id")
      .in("id", [id, referenceSiteId]);
    if (error) throw error;
    const target = sites?.find((s) => s.id === id);
    const reference = sites?.find((s) => s.id === referenceSiteId);
    if (!target || !reference) return NextResponse.json({ error: "Site not found" }, { status: 404 });
    if (!target.wix_site_id || !reference.wix_site_id) {
      return NextResponse.json({ error: "Both sites need a wix_site_id" }, { status: 400 });
    }

    const [targetCollection, referenceCollection] = await Promise.all([
      getDataCollection(target.wix_site_id, target.wix_collection_id ?? "FloorPlansV2"),
      getDataCollection(reference.wix_site_id, reference.wix_collection_id ?? "FloorPlansV2"),
    ]);
    if (!targetCollection || !referenceCollection) {
      return NextResponse.json({ error: "Floor Plans V2 collection not found on one of the sites" }, { status: 404 });
    }

    const refFields = referenceCollection.fields as FieldSpec[];
    const tgtFields = targetCollection.fields as FieldSpec[];
    const { mismatched } = diffFields(refFields, tgtFields);
    const { fields, added, removed, relabeled } = alignedFields(refFields, tgtFields, { removeExtra });
    if (!added.length && !removed.length && !relabeled.length) {
      return NextResponse.json({ changed: false, added, removed, relabeled, mismatched });
    }

    const updated = await updateDataCollection(target.wix_site_id, { ...targetCollection, fields });
    logger.info("Floor Plans V2 schema aligned", {
      site: target.domain,
      reference: reference.domain,
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
