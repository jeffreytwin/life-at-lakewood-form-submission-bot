import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { authorizeEngineRequest } from "@/lib/listings/auth";
import { loadActiveSites, loadSitesByIds } from "@/lib/listings/db";
import { importVillagesFromWix } from "@/lib/listings/villages";
import { seedVillagesFromSiteCollections } from "@/lib/listings/seed-villages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/internal/listings/villages/import
 * Body: { siteId?: string, source?: "villages" | "site-collections" }
 *
 * Imports each active site's Wix Villages collection into ls_villages and
 * ls_village_terms (idempotent; each village's term set is replaced).
 *
 * `source: "site-collections"` is for a site with no Villages collection:
 * the neighborhoods come from the site's own villages collection and the
 * terms are derived from the subdivisions its live listings are filed
 * under (src/lib/listings/seed-villages.ts). It adds terms and never
 * removes one, so a re-seed keeps whatever the Hub has tuned.
 *
 * A named site is imported whether or not it is active, which is how a site
 * being onboarded gets its neighborhoods before its first run.
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  let siteId: string | undefined;
  let source = "villages";
  try {
    const body = (await request.json()) ?? {};
    if (typeof body.siteId === "string") siteId = body.siteId;
    if (typeof body.source === "string") source = body.source;
  } catch {
    // no body
  }
  if (source !== "villages" && source !== "site-collections") {
    return NextResponse.json({ error: `unknown source "${source}" (expected villages|site-collections)` }, { status: 400 });
  }
  try {
    const sites = siteId ? await loadSitesByIds([siteId]) : await loadActiveSites();
    const results = [];
    for (const site of sites) {
      if (!site.wix_site_id) {
        results.push({ domain: site.domain, skipped: "no wix_site_id" });
        continue;
      }
      const outcome =
        source === "site-collections"
          ? await seedVillagesFromSiteCollections(site)
          : await importVillagesFromWix(site);
      results.push({ domain: site.domain, ...outcome });
    }
    return NextResponse.json({ sites: results });
  } catch (error) {
    logger.error("Village import failed", { error: errorMessage(error), source });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
