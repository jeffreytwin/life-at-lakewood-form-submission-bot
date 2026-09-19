import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getDataCollection } from "@/lib/wix/client";
import { describeFieldType, diffFields, isSystemField, type FieldSpec } from "@/lib/floorplans/collection-schema";
import { STANDARD_COLLECTION_ID, STANDARD_FLOOR_PLAN_FIELDS } from "@/lib/floorplans/standard-schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/floorplans/sites/schema
 *
 * Every active site's Floor Plans V2 collection as Wix has it right now,
 * and how each one differs from the standard (standard-schema.ts). A site
 * whose collection cannot be read comes back with its error, not as a
 * failure of the whole call.
 */
export async function GET() {
  try {
    const { data: sites, error } = await supabase
      .from("fp_sites")
      .select("id, name, domain, wix_site_id, wix_collection_id")
      .eq("active", true)
      .order("domain");
    if (error) throw error;

    const loaded = await Promise.all(
      (sites ?? []).map(async (site) => {
        const collectionId = site.wix_collection_id ?? STANDARD_COLLECTION_ID;
        if (!site.wix_site_id) return { site, collectionId, collection: null, error: "site has no wix_site_id" };
        try {
          const collection = await getDataCollection(site.wix_site_id, collectionId);
          return { site, collectionId, collection, error: collection ? null : "collection not found" };
        } catch (err) {
          return { site, collectionId, collection: null, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );

    const result = loaded.map(({ site, collectionId, collection, error }) => {
      const fields = (collection?.fields ?? []) as FieldSpec[];
      return {
        id: site.id,
        name: site.name,
        domain: site.domain,
        collectionId,
        found: Boolean(collection),
        error,
        displayName: collection?.displayName ?? null,
        revision: collection?.revision ?? null,
        fields: fields.map((f) => ({
          key: f.key,
          type: describeFieldType(f),
          displayName: f.displayName ?? "",
          systemField: isSystemField(f),
        })),
        diff: collection ? diffFields(STANDARD_FLOOR_PLAN_FIELDS, fields) : null,
      };
    });
    return NextResponse.json({
      standard: {
        collectionId: STANDARD_COLLECTION_ID,
        fields: STANDARD_FLOOR_PLAN_FIELDS.map((f) => ({ key: f.key, type: describeFieldType(f), displayName: f.displayName ?? "" })),
      },
      sites: result,
    });
  } catch (error) {
    logger.error("Failed to read Floor Plans V2 schemas", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
