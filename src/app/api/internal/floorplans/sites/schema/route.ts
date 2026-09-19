import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getDataCollection, type WixDataCollection } from "@/lib/wix/client";
import { describeFieldType, diffFields, isSystemField, type FieldSpec } from "@/lib/floorplans/collection-schema";

export const dynamic = "force-dynamic";

/** The site whose Floor Plans V2 schema is the standard unless the caller names one (Jeff, 2026-09-19: Wellen Park and Parrish). */
const DEFAULT_REFERENCE_DOMAIN = "lifeinwellenpark.com";

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  wix_site_id: string | null;
  wix_collection_id: string | null;
  legacy_collection_id: string | null;
}

const fieldsOf = (c: WixDataCollection | null): FieldSpec[] => (c?.fields ?? []) as FieldSpec[];

/**
 * GET /api/internal/floorplans/sites/schema?reference=<siteId>&referenceCollection=<collectionId>
 *
 * Every active site's Floor Plans V2 collection as Wix has it right now,
 * and how each one differs from the reference collection: a site's V2 by
 * default, or its legacy FloorPlans, whose human labels ("Primary Image",
 * "Related Floor Plan (Quick Move-In Only)") are what a person knows from
 * the CMS. Each site also reports how its V2 labels differ from its own
 * legacy collection's. A site whose collection cannot be read comes back
 * with its error, not as a failure of the whole call.
 */
export async function GET(request: NextRequest) {
  try {
    const { data, error } = await supabase
      .from("fp_sites")
      .select("id, name, domain, wix_site_id, wix_collection_id, legacy_collection_id")
      .eq("active", true)
      .order("domain");
    if (error) throw error;
    const sites = (data ?? []) as SiteRow[];
    const requested = request.nextUrl.searchParams.get("reference");
    const reference =
      sites.find((s) => s.id === requested) ?? sites.find((s) => s.domain === DEFAULT_REFERENCE_DOMAIN) ?? sites[0];
    if (!reference) return NextResponse.json({ error: "No active sites" }, { status: 404 });
    const referenceCollectionId =
      request.nextUrl.searchParams.get("referenceCollection") || reference.wix_collection_id || "FloorPlansV2";

    const read = async (site: SiteRow, collectionId: string | null) => {
      if (!site.wix_site_id || !collectionId) return { collection: null, error: collectionId ? "site has no wix_site_id" : null };
      try {
        const collection = await getDataCollection(site.wix_site_id, collectionId);
        return { collection, error: collection ? null : "collection not found" };
      } catch (err) {
        return { collection: null, error: err instanceof Error ? err.message : String(err) };
      }
    };

    const loaded = await Promise.all(
      sites.map(async (site) => {
        const collectionId = site.wix_collection_id ?? "FloorPlansV2";
        const [v2, legacy] = await Promise.all([read(site, collectionId), read(site, site.legacy_collection_id)]);
        return { site, collectionId, v2, legacy };
      })
    );
    const refEntry = loaded.find((l) => l.site.id === reference.id);
    const refCollection =
      referenceCollectionId === refEntry?.collectionId
        ? refEntry.v2.collection
        : referenceCollectionId === reference.legacy_collection_id
          ? (refEntry?.legacy.collection ?? null)
          : (await read(reference, referenceCollectionId)).collection;
    if (!refCollection) {
      return NextResponse.json({ error: `Reference collection ${referenceCollectionId} not found on ${reference.domain}` }, { status: 404 });
    }
    const refFields = fieldsOf(refCollection);

    const result = loaded.map(({ site, collectionId, v2, legacy }) => {
      const isReference = site.id === reference.id && collectionId === referenceCollectionId;
      const ownLabels = v2.collection && legacy.collection ? diffFields(fieldsOf(legacy.collection), fieldsOf(v2.collection)) : null;
      return {
        id: site.id,
        name: site.name,
        domain: site.domain,
        collectionId,
        legacyCollectionId: site.legacy_collection_id,
        found: Boolean(v2.collection),
        error: v2.error,
        displayName: v2.collection?.displayName ?? null,
        revision: v2.collection?.revision ?? null,
        fields: fieldsOf(v2.collection).map((f) => ({
          key: f.key,
          type: describeFieldType(f),
          displayName: f.displayName ?? "",
          systemField: isSystemField(f),
        })),
        diff: v2.collection && !isReference ? diffFields(refFields, fieldsOf(v2.collection)) : null,
        /** How this site's V2 labels differ from its own legacy collection's, for the per-site relabel. */
        legacyLabels: ownLabels ? { relabeled: ownLabels.relabeled, missing: ownLabels.missing.map((f) => f.key) } : null,
      };
    });
    return NextResponse.json({ reference: { siteId: reference.id, collectionId: referenceCollectionId }, sites: result });
  } catch (error) {
    logger.error("Failed to read Floor Plans V2 schemas", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
