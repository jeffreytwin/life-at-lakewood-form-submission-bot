import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getDataCollection } from "@/lib/wix/client";
import { describeFieldType, diffFields, isSystemField, type FieldSpec } from "@/lib/floorplans/collection-schema";

export const dynamic = "force-dynamic";

/** The site whose Floor Plans V2 schema is the standard unless the caller names one (Jeff, 2026-09-19: Wellen Park and Parrish). */
const DEFAULT_REFERENCE_DOMAIN = "lifeinwellenpark.com";

/**
 * GET /api/internal/floorplans/sites/schema?reference=<siteId>
 *
 * Every active site's Floor Plans V2 collection as Wix has it right now,
 * and how each one differs from the reference site's. A site whose
 * collection cannot be read comes back with its error, not as a failure of
 * the whole call.
 */
export async function GET(request: NextRequest) {
  try {
    const { data: sites, error } = await supabase
      .from("fp_sites")
      .select("id, name, domain, wix_site_id, wix_collection_id")
      .eq("active", true)
      .order("domain");
    if (error) throw error;
    const requested = request.nextUrl.searchParams.get("reference");
    const reference =
      (sites ?? []).find((s) => s.id === requested) ??
      (sites ?? []).find((s) => s.domain === DEFAULT_REFERENCE_DOMAIN) ??
      (sites ?? [])[0];
    if (!reference) return NextResponse.json({ error: "No active sites" }, { status: 404 });

    const loaded = await Promise.all(
      (sites ?? []).map(async (site) => {
        const collectionId = site.wix_collection_id ?? "FloorPlansV2";
        if (!site.wix_site_id) return { site, collectionId, collection: null, error: "site has no wix_site_id" };
        try {
          return { site, collectionId, collection: await getDataCollection(site.wix_site_id, collectionId), error: null };
        } catch (err) {
          return { site, collectionId, collection: null, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
    const ref = loaded.find((l) => l.site.id === reference.id);
    const refFields = (ref?.collection?.fields ?? []) as FieldSpec[];
    const result = loaded.map(({ site, collectionId, collection, error }) => ({
      id: site.id,
      name: site.name,
      domain: site.domain,
      collectionId,
      found: Boolean(collection),
      error: error ?? (collection ? null : "collection not found"),
      displayName: collection?.displayName ?? null,
      revision: collection?.revision ?? null,
      fields: ((collection?.fields ?? []) as FieldSpec[]).map((f) => ({
        key: f.key,
        type: describeFieldType(f),
        displayName: f.displayName ?? "",
        systemField: isSystemField(f),
      })),
      diff:
        collection && ref?.collection && site.id !== reference.id
          ? diffFields(refFields, collection.fields as FieldSpec[])
          : null,
    }));
    return NextResponse.json({ reference: reference.id, sites: result });
  } catch (error) {
    logger.error("Failed to read Floor Plans V2 schemas", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
