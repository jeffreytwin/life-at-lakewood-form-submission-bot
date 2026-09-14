import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { errorMessage } from "@/lib/shared/errors";
import { authorizeEngineRequest } from "@/lib/listings/auth";
import { loadActiveSites } from "@/lib/listings/db";
import { importVillagesFromWix } from "@/lib/listings/villages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/internal/listings/villages/import
 * Body: { siteId?: string }
 *
 * Imports each active site's Wix Villages collection into ls_villages and
 * ls_village_terms (idempotent; each village's term set is replaced).
 */
export async function POST(request: NextRequest) {
  const denied = authorizeEngineRequest(request);
  if (denied) return denied;
  let siteId: string | undefined;
  try {
    const body = (await request.json()) ?? {};
    if (typeof body.siteId === "string") siteId = body.siteId;
  } catch {
    // no body
  }
  try {
    const sites = await loadActiveSites(siteId ? [siteId] : undefined);
    const results = [];
    for (const site of sites) {
      if (!site.wix_site_id) {
        results.push({ domain: site.domain, skipped: "no wix_site_id" });
        continue;
      }
      results.push({ domain: site.domain, ...(await importVillagesFromWix(site)) });
    }
    return NextResponse.json({ sites: results });
  } catch (error) {
    logger.error("Village import failed", { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
