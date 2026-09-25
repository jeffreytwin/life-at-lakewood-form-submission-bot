// A floor plan's "quick move-ins available" flag, kept true to the quick
// move-ins filed under it in Wix (Jeff, 2026-09-25). The flag and its
// dressing — the "QUICK MOVE-INS BELOW" banner, the badge and the status
// dot (quick-move-ins.ts, basePlanMarkers) — sit on the floor plan's own
// row, and a quick move-in's row names its floor plan as text
// (relatedFloorPlanQuickMoveInOnly). Approving a quick move-in never
// touched its floor plan's row, so the two drifted: Calusa Country Club's
// Napoli Grande said it had quick move-ins with none, its Bromelia II had
// one and said not.
//
// Nobody reviews this: it is a count, not a builder's claim. A floor plan
// has quick move-ins when at least one published quick move-in row of the
// same builder and community is filed under its name. Checked right after
// every write-back, for that builder and community, and on a schedule for
// every row of every site, whoever made the row. A quick move-in that
// names no floor plan, or a name two floor plans share, is reported
// (fp_qmi_flag_log), not guessed at.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getItem, queryAllItems, updateItem, WixApiError, type WixDataItem, type WixItemData } from "@/lib/wix/client";
import { basePlanMarkers } from "@/lib/floorplans/quick-move-ins";
import { normKey } from "@/lib/floorplans/types";

const MARKERS = ["quickMoveInAvailable", "newConstructionOrMoveIn", "constructionDot", "quickMoveInImage"] as const;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const scopeOf = (d: WixItemData) => `${normKey(text(d.builder))}|${normKey(text(d.village))}`;
const isDraft = (d: WixItemData) => String(d._publishStatus ?? "").toUpperCase() === "DRAFT";

/** The four markers a floor plan's row shows, with quick move-ins or without. */
export function markersFor(has: boolean): Record<(typeof MARKERS)[number], unknown> {
  const all = basePlanMarkers({ quickMoveIn: false, hasQuickMoveIns: has, price: null });
  return Object.fromEntries(MARKERS.map((k) => [k, all[k] ?? null])) as Record<(typeof MARKERS)[number], unknown>;
}

/** The media file a picture field points at, however Wix spells it ("wix:image://v1/<file>/…" or a static URL). */
const fileOf = (v: unknown): string => {
  const s = text(v);
  return s.match(/([0-9a-f]{6}_[0-9a-f]{32}~mv2\.[a-z]+)/i)?.[1]?.toLowerCase() ?? s;
};

/** Whether a row already shows these markers. */
function shows(d: WixItemData, want: Record<string, unknown>): boolean {
  if ((d.quickMoveInAvailable === true) !== (want.quickMoveInAvailable === true)) return false;
  if (text(d.newConstructionOrMoveIn) !== text(want.newConstructionOrMoveIn)) return false;
  if (fileOf(d.constructionDot) !== fileOf(want.constructionDot)) return false;
  return fileOf(d.quickMoveInImage) === fileOf(want.quickMoveInImage);
}

export interface FlagFix {
  itemId: string;
  name: string;
  village: string;
  builder: string;
  has: boolean;
  /** Published quick move-ins filed under it. */
  homes: number;
}

export interface FlagProblem {
  itemId: string;
  name: string;
  village: string;
  builder: string;
  kind: "no-plan" | "same-name";
  detail: string;
}

/**
 * The rows whose markers disagree with the quick move-ins filed under
 * them, and the quick move-ins that cannot be placed. Pure; exported for
 * tests.
 */
export function flagFixes(items: WixDataItem[]): { fixes: FlagFix[]; problems: FlagProblem[]; plans: number; homes: number } {
  const plans = items.filter((i) => !text(i.data.relatedFloorPlanQuickMoveInOnly));
  const homes = items.filter((i) => text(i.data.relatedFloorPlanQuickMoveInOnly));
  const byName = new Map<string, WixDataItem[]>();
  for (const p of plans) {
    const key = `${scopeOf(p.data)}|${normKey(text(p.data.floorPlanName))}`;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const describe = (i: WixDataItem) => ({
    itemId: i.id,
    name: text(i.data.floorPlanName),
    village: text(i.data.village),
    builder: text(i.data.builder),
  });

  // Published quick move-ins filed under each name.
  const count = new Map<string, number>();
  const problems: FlagProblem[] = [];
  for (const home of homes) {
    // A draft is not on the site: it does not make its floor plan's flag.
    if (isDraft(home.data)) continue;
    const filed = text(home.data.relatedFloorPlanQuickMoveInOnly);
    const key = `${scopeOf(home.data)}|${normKey(filed)}`;
    if (byName.has(key)) count.set(key, (count.get(key) ?? 0) + 1);
    else problems.push({ ...describe(home), kind: "no-plan", detail: `filed under "${filed}", which no floor plan of this builder and community is called` });
  }

  const fixes: FlagFix[] = [];
  for (const [key, same] of byName) {
    const n = count.get(key) ?? 0;
    if (same.length > 1 && n > 0) {
      // Which of them the homes are under cannot be told: said, not guessed.
      for (const p of same) problems.push({ ...describe(p), kind: "same-name", detail: `${same.length} floor plans of this builder and community are called "${text(p.data.floorPlanName)}", and ${n} quick move-in${n === 1 ? " is" : "s are"} filed under that name` });
      continue;
    }
    for (const plan of same) {
      // A row that shows none of the markers and has nothing under it is
      // left as it is: it may be a quick move-in whose floor plan was never
      // named, and a quick move-in's row carries no markers.
      if (n === 0 && MARKERS.every((k) => !plan.data[k])) continue;
      if (!shows(plan.data, markersFor(n > 0))) fixes.push({ ...describe(plan), has: n > 0, homes: n });
    }
  }
  return { fixes, problems, plans: plans.length, homes: homes.length };
}

interface SiteRow {
  id: string;
  name: string | null;
  wix_site_id: string | null;
  wix_collection_id: string | null;
}

/** Writes one fix: the row read again just before, so nothing written since is lost, and only the markers changed. */
async function applyFix(site: SiteRow, fix: FlagFix): Promise<boolean> {
  const fresh = await getItem(site.wix_site_id!, site.wix_collection_id!, fix.itemId);
  if (!fresh) return false;
  const kept = Object.fromEntries(Object.entries(fresh.data ?? {}).filter(([k]) => !k.startsWith("_")));
  await updateItem(site.wix_site_id!, site.wix_collection_id!, fix.itemId, { ...kept, ...markersFor(fix.has) });
  // The pipeline's own record of the plan says the same, so the next write
  // of the plan carries it (diff.ts keeps it).
  const { data: own } = await supabase
    .from("fp_floor_plans")
    .select("id, record")
    .eq("site_id", site.id)
    .eq("wix_record_id", fix.itemId)
    .maybeSingle();
  if (own) {
    await supabase
      .from("fp_floor_plans")
      .update({ record: { ...(own.record as Record<string, unknown>), hasQuickMoveIns: fix.has } })
      .eq("id", own.id);
  }
  return true;
}

export interface FlagCheck {
  site: string;
  plans: number;
  homes: number;
  fixes: FlagFix[];
  problems: FlagProblem[];
  /** Fixes written; fewer than found when Wix slowed us down or time ran out (the next check goes on). */
  fixed: number;
  error?: string;
}

/**
 * Checks one site's rows — all of them, or one builder's in one community
 * — and fixes what disagrees, unless asked only to look.
 */
export async function checkSiteFlags(
  site: SiteRow,
  opts: { builder?: string; village?: string; dryRun?: boolean; reason: string; deadline?: number }
): Promise<FlagCheck> {
  const label = site.name ?? site.id;
  if (!site.wix_site_id || !site.wix_collection_id) {
    return { site: label, plans: 0, homes: 0, fixes: [], problems: [], fixed: 0, error: "no Wix collection" };
  }
  const scoped = Boolean(opts.builder && opts.village);
  const items = await queryAllItems(site.wix_site_id, site.wix_collection_id, {
    includeDrafts: true,
    ...(scoped ? { filter: { builder: { $eq: opts.builder }, village: { $eq: opts.village } } } : {}),
  });
  const found = flagFixes(items);
  const check: FlagCheck = { site: label, ...found, fixed: 0 };
  if (opts.dryRun) return check;

  const deadline = opts.deadline ?? Date.now() + 120_000;
  for (const fix of found.fixes) {
    if (Date.now() > deadline) break;
    try {
      if (!(await applyFix(site, fix))) continue;
      check.fixed += 1;
      await supabase.from("fp_qmi_flag_log").insert({
        site_id: site.id,
        wix_item_id: fix.itemId,
        plan_name: fix.name,
        village: fix.village,
        builder: fix.builder,
        action: fix.has ? "set" : "cleared",
        detail: fix.has ? `${fix.homes} quick move-in${fix.homes === 1 ? "" : "s"} filed under it` : "no published quick move-ins filed under it",
        reason: opts.reason,
      });
    } catch (error) {
      if (error instanceof WixApiError && error.rateLimited) {
        check.error = "Wix is throttling; the rest wait for the next check";
        break;
      }
      logger.warn("Quick move-in flag could not be fixed", {
        site: label,
        plan: fix.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // A full check replaces the site's list of what it could not place.
  if (!scoped) {
    await supabase.from("fp_qmi_flag_log").delete().eq("site_id", site.id).in("action", ["no-plan", "same-name"]);
    if (found.problems.length) {
      await supabase.from("fp_qmi_flag_log").insert(
        found.problems.map((p) => ({
          site_id: site.id,
          wix_item_id: p.itemId,
          plan_name: p.name,
          village: p.village,
          builder: p.builder,
          action: p.kind,
          detail: p.detail,
          reason: opts.reason,
        }))
      );
    }
    await supabase.from("fp_qmi_flag_log").insert({
      site_id: site.id,
      action: "checked",
      detail: `${found.plans} floor plans, ${found.homes} quick move-ins: ${check.fixed} flag${check.fixed === 1 ? "" : "s"} fixed, ${found.problems.length} to look at`,
      reason: opts.reason,
    });
  }
  if (check.fixed) logger.info("Quick move-in flags fixed", { site: label, fixed: check.fixed, scoped, reason: opts.reason });
  return check;
}

/** Every site, every row. */
export async function checkAllFlags(opts: { dryRun?: boolean; reason: string; budgetMs?: number }): Promise<FlagCheck[]> {
  const { data: sites } = await supabase.from("fp_sites").select("id, name, wix_site_id, wix_collection_id").order("name");
  const deadline = Date.now() + (opts.budgetMs ?? 200_000);
  const checks: FlagCheck[] = [];
  for (const site of (sites ?? []) as SiteRow[]) {
    try {
      checks.push(await checkSiteFlags(site, { dryRun: opts.dryRun, reason: opts.reason, deadline }));
    } catch (error) {
      checks.push({ site: site.name ?? site.id, plans: 0, homes: 0, fixes: [], problems: [], fixed: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return checks;
}

/**
 * Right after a write-back: that builder's floor plans in that community.
 * Never fails the write-back it follows; the scheduled check catches up.
 */
export async function checkFlagsAfterWrite(site: SiteRow, builder: string, village: string): Promise<void> {
  try {
    await checkSiteFlags(site, { builder, village, reason: "after an approved change" });
  } catch (error) {
    logger.warn("Quick move-in flags not checked after a write-back", {
      site: site.name ?? site.id,
      builder,
      village,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
