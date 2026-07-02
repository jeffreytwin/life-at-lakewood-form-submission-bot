// Cutover report: compares the pipeline's canonical plans against the LIVE
// legacy FloorPlans collection (fetched fresh from Wix at report time) for
// one site. Three buckets:
//   mismatches   — same plan, different price (who's right? usually us)
//   pipelineOnly — plans we track that legacy lacks (freelancer gaps)
//   legacyOnly   — legacy rows we don't track yet (not-yet-onboarded
//                  builders/communities, or QMIs pending extraction)
// The go signal for a site: weeks where every disagreement is a legacy error.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { queryAllItems } from "@/lib/wix/client";
import { normKey } from "@/lib/floorplans/types";

const normBuilder = (name: string) => (name === "Lennar Homes" ? "Lennar" : name);
const matchKey = (builder: string, plan: string) =>
  `${normKey(normBuilder(builder))}|${normKey(plan)}`;

export interface CutoverReport {
  generatedAt: string;
  legacyCount: number;
  pipelineCount: number;
  matched: number;
  mismatches: { plan: string; builder: string; legacyPrice: string | null; pipelinePrice: string | null }[];
  pipelineOnly: { plan: string; builder: string; community: string }[];
  legacyOnly: { plan: string; builder: string; village: string; isQmi: boolean }[];
}

export async function generateCutoverReport(siteId: string): Promise<CutoverReport> {
  const { data: site, error } = await supabase
    .from("fp_sites")
    .select("id, domain, wix_site_id, legacy_collection_id")
    .eq("id", siteId)
    .single();
  if (error || !site?.wix_site_id || !site.legacy_collection_id) {
    throw new Error(error?.message ?? "site missing Wix configuration");
  }

  const [legacyItems, { data: plans }] = await Promise.all([
    queryAllItems(site.wix_site_id, site.legacy_collection_id),
    supabase
      .from("fp_floor_plans")
      .select("plan_key, name, record, fp_builders:builder_id(name), fp_communities:community_id(name)")
      .eq("site_id", siteId)
      .is("removed_at", null),
  ]);

  const pipeline = new Map(
    (plans ?? []).map((p) => {
      const builder = (p.fp_builders as unknown as { name: string })?.name ?? "";
      const community = (p.fp_communities as unknown as { name: string })?.name ?? "";
      const rec = (p.record ?? {}) as { priceDisplay?: string | null };
      return [matchKey(builder, p.name), { plan: p.name, builder, community, price: rec.priceDisplay ?? null }];
    })
  );

  const report: CutoverReport = {
    generatedAt: new Date().toISOString(),
    legacyCount: legacyItems.length,
    pipelineCount: pipeline.size,
    matched: 0,
    mismatches: [],
    pipelineOnly: [],
    legacyOnly: [],
  };

  const seenKeys = new Set<string>();
  for (const item of legacyItems) {
    const d = item.data as Record<string, string | undefined>;
    const name = d.floorPlanName ?? "";
    const builder = d.builder ?? "";
    if (!name) continue;
    const key = matchKey(builder, name);
    const match = pipeline.get(key);
    if (match) {
      seenKeys.add(key);
      report.matched += 1;
      const legacyPrice = d.floorPlanPrice ?? null;
      if ((legacyPrice ?? "") !== (match.price ?? "")) {
        report.mismatches.push({ plan: name, builder, legacyPrice, pipelinePrice: match.price });
      }
    } else {
      report.legacyOnly.push({
        plan: name,
        builder,
        village: d.village ?? "",
        isQmi: /quick\s*move/i.test(name) || d.quickMoveInAvailable === "true" || Boolean(d.relatedFloorPlanQuickMoveInOnly),
      });
    }
  }
  for (const [key, p] of pipeline) {
    if (!seenKeys.has(key)) {
      report.pipelineOnly.push({ plan: p.plan, builder: p.builder, community: p.community });
    }
  }

  await supabase.from("fp_cutover_reports").insert({ site_id: siteId, report });
  logger.info("Cutover report generated", {
    domain: site.domain,
    matched: report.matched,
    mismatches: report.mismatches.length,
    pipelineOnly: report.pipelineOnly.length,
    legacyOnly: report.legacyOnly.length,
  });
  return report;
}
