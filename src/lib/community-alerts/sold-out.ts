// Sold-out neighborhoods (Jeff, 2026-10-17): a new-build community whose
// inventory reached zero raises a Community Alert, whose to-do list is the
// website work a sell-out calls for (checklists.ts).
//
// "Zero" has two readings, and either one counts:
//  - every connection still running for the community read no plans on a
//    good run. A run that finds nothing where there were plans is failed
//    as partial and its count recorded, so the next night's run is the
//    first to pass with zero: two readings in a row, never one bad scrape;
//  - no connection is left running and the site holds no plans for it,
//    the way a sold-out neighborhood leaves today (Builder Connections →
//    Remove).
// A Reset forgets the connection's count, so a reset community is not
// read as sold out while it waits for its next run.
//
// An alert is raised when a community goes from having inventory to having
// none. The first check remembers what every community looks like and
// raises nothing, so the neighborhoods that sold out before Community
// Alerts existed stay quiet.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { failedAt as failed } from "@/lib/shared/describe-error";
import { settleAlert } from "@/lib/community-alerts/alerts";

/** How many rows one read brings back before another is needed. */
const PAGE = 1000;

export interface ConnectionReading {
  /** The connection and its builder are both switched on. */
  running: boolean;
  lastPlanCount: number | null;
  lastRunStatus: string | null;
}

/** The community has no new-build inventory left, by either reading. Pure; exported for tests. */
export function isSoldOut(livePlans: number, connections: ConnectionReading[]): boolean {
  const running = connections.filter((c) => c.running);
  if (running.length === 0) return livePlans === 0;
  return running.every((c) => c.lastPlanCount === 0 && (c.lastRunStatus ?? "").startsWith("ok"));
}

/** A community that had inventory at the last check and has none now. Null: never checked before. Pure. */
export function shouldRaise(previous: boolean | null, now: boolean): boolean {
  return previous === false && now;
}

const STOP_WORDS = new Set(["at", "the", "of", "in", "and"]);

/**
 * A name's words, order and filler aside, so the new-build engine's
 * "Waterside - Bungalow Walk" is the listings engine's "Bungalow Walk at
 * Waterside". Pure; exported for tests.
 */
export function nameKey(name: string): string {
  // A slug can carry an escaped "&" (Wellen Park Golf %26 Country Club).
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Not escaped after all: read as it is.
  }
  const words = decoded
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  return [...new Set(words)].sort().join(" ");
}

export interface VillageRow {
  id: string;
  name: string;
  wix_slug: string | null;
  page_url: string | null;
  active: boolean;
  terms: number;
}

/**
 * The listings engine's neighborhood a new-build community is, by its
 * name or its page's slug ("Crosswind Point" is the listings engine's
 * "Crosswind", at /neighborhood/crosswind-point). Null when none is.
 * Pure; exported for tests.
 */
export function matchVillage(name: string, villages: VillageRow[]): VillageRow | null {
  const key = nameKey(name);
  if (!key) return null;
  return (
    villages.find((v) => nameKey(v.name) === key) ??
    villages.find((v) => v.wix_slug && nameKey(v.wix_slug) === key) ??
    null
  );
}

/**
 * Where the homes-for-sale page might be, given the neighborhood page.
 * The newer sites build both from one dynamic page, so the address
 * follows; Life At Lakewood's were made one at a time and have gone by
 * more than one pattern. Pure; exported for tests.
 */
export function homesForSaleCandidates(pageUrl: string | null, slug: string | null): string[] {
  if (!pageUrl) return [];
  if (pageUrl.includes("/neighborhood/")) return [pageUrl.replace("/neighborhood/", "/neighborhood-homes-for-sale/")];
  if (!slug) return [];
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  return [`${origin}/homes-for-sale-in-${slug}`, `${origin}/homes-for-sale-${slug}`];
}

/** A page that answers, and is not the site's "page not found". */
async function pageExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const title = (await res.text()).match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
    return !/\b404\b|not found/i.test(title);
  } catch {
    return false;
  }
}

async function findHomesForSalePage(village: VillageRow): Promise<string | null> {
  const candidates = homesForSaleCandidates(village.page_url, village.wix_slug);
  // One address that follows from the dynamic page needs no asking.
  if (candidates.length === 1) return candidates[0];
  for (const url of candidates) if (await pageExists(url)) return url;
  return null;
}

export interface SoldOutDetail {
  site: string;
  livePlans: number;
  /** Homes are listed again since the alert was raised. */
  inventoryBack?: boolean;
  builders: { name: string; url: string | null }[];
  village?: { id: string; name: string } | null;
  pages?: { neighborhood: string | null; homesForSale: string | null } | null;
}

interface CommunityRow {
  id: string;
  name: string;
  site_id: string;
  fp_sites: { domain: string } | null;
}

interface ConnectionRow {
  community_id: string;
  active: boolean;
  last_plan_count: number | null;
  last_run_status: string | null;
  extractor_params: { url?: string } | null;
  fp_builders: { name: string; active: boolean } | null;
}

async function livePlanCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fp_floor_plans")
      .select("community_id")
      .is("removed_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw failed("reading the live floor plans", error);
    for (const row of data ?? []) counts.set(row.community_id, (counts.get(row.community_id) ?? 0) + 1);
    if ((data ?? []).length < PAGE) return counts;
  }
}

async function villagesByDomain(): Promise<Map<string, VillageRow[]>> {
  const { data, error } = await supabase
    .from("ls_villages")
    .select("id, name, wix_slug, page_url, active, ls_sites:site_id(domain)");
  if (error) throw failed("reading the listings neighborhoods", error);
  const terms = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error: termsError } = await supabase
      .from("ls_village_terms")
      .select("village_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (termsError) throw failed("reading the listings search terms", termsError);
    for (const t of rows ?? []) terms.set(t.village_id, (terms.get(t.village_id) ?? 0) + 1);
    if ((rows ?? []).length < PAGE) break;
  }
  const byDomain = new Map<string, VillageRow[]>();
  for (const v of data ?? []) {
    const domain = (v.ls_sites as unknown as { domain: string } | null)?.domain;
    if (!domain) continue;
    const row: VillageRow = { id: v.id, name: v.name, wix_slug: v.wix_slug, page_url: v.page_url, active: v.active, terms: terms.get(v.id) ?? 0 };
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), row]);
  }
  return byDomain;
}

export interface SoldOutCheck {
  communities: number;
  /** Communities seen for the first time: remembered, nothing raised. */
  seeded: number;
  raised: string[];
  /** Open alerts whose self-checking items were looked at again. */
  refreshed: number;
  /** Alerts that closed because their last item was settled by a self-check. */
  closed: number;
}

/**
 * Looks at every new-build community, raises a sold-out alert for each
 * that has just run out of inventory, and brings every open sold-out
 * alert's self-checking items up to date.
 */
export async function checkSoldOuts(): Promise<SoldOutCheck> {
  const { data: communities, error } = await supabase
    .from("fp_communities")
    .select("id, name, site_id, fp_sites:site_id(domain)")
    .eq("active", true);
  if (error) throw failed("reading the communities", error);

  const { data: connectionRows, error: connError } = await supabase
    .from("fp_builder_communities")
    .select("community_id, active, last_plan_count, last_run_status, extractor_params, fp_builders:builder_id(name, active)");
  if (connError) throw failed("reading the builder connections", connError);
  const connections = new Map<string, ConnectionRow[]>();
  for (const c of (connectionRows ?? []) as unknown as ConnectionRow[]) {
    connections.set(c.community_id, [...(connections.get(c.community_id) ?? []), c]);
  }
  const running = (c: ConnectionRow) => c.active && c.fp_builders?.active !== false;

  const live = await livePlanCounts();

  const { data: stateRows, error: stateError } = await supabase.from("ca_community_state").select("community_id, sold_out");
  if (stateError) throw failed("reading what the last check saw", stateError);
  const previous = new Map((stateRows ?? []).map((s) => [s.community_id as string, s.sold_out as boolean]));

  const result: SoldOutCheck = { communities: 0, seeded: 0, raised: [], refreshed: 0, closed: 0 };
  const now = new Date().toISOString();
  const states: Record<string, unknown>[] = [];

  for (const community of (communities ?? []) as unknown as CommunityRow[]) {
    result.communities += 1;
    const conns = connections.get(community.id) ?? [];
    const livePlans = live.get(community.id) ?? 0;
    const soldOut = isSoldOut(
      livePlans,
      conns.map((c) => ({ running: running(c), lastPlanCount: c.last_plan_count, lastRunStatus: c.last_run_status }))
    );
    const was = previous.has(community.id) ? previous.get(community.id)! : null;
    if (was === null) result.seeded += 1;
    states.push({
      community_id: community.id,
      sold_out: soldOut,
      live_plans: livePlans,
      checked_at: now,
      ...(was !== null && was !== soldOut ? { changed_at: now } : {}),
    });

    if (!shouldRaise(was, soldOut)) continue;
    const detail: SoldOutDetail = {
      site: community.fp_sites?.domain ?? "",
      livePlans,
      builders: conns.map((c) => ({ name: c.fp_builders?.name ?? "Builder", url: c.extractor_params?.url ?? null })),
    };
    const { error: insertError } = await supabase.from("ca_alerts").insert({
      kind: "sold_out",
      site_id: community.site_id,
      community_id: community.id,
      name: community.name,
      detail,
    });
    // Already open for this community: the refresh below brings it up to date.
    if (insertError && insertError.code !== "23505") throw failed(`raising ${community.name}'s sold-out alert`, insertError);
    if (!insertError) {
      result.raised.push(community.name);
      logger.info("Community sold out", { community: community.name, site: detail.site, livePlans });
    }
  }

  // The state is written after the alerts: a check that fails halfway
  // raises the same alerts again next time rather than none.
  for (let i = 0; i < states.length; i += PAGE) {
    const { error: upsertError } = await supabase.from("ca_community_state").upsert(states.slice(i, i + PAGE));
    if (upsertError) throw failed("remembering what this check saw", upsertError);
  }

  const soldOutNow = new Map(states.map((s) => [s.community_id as string, s.sold_out as boolean]));
  const villages = await villagesByDomain();
  const { data: open, error: openError } = await supabase
    .from("ca_alerts")
    .select("id, community_id, name, detail")
    .eq("kind", "sold_out")
    .eq("status", "open");
  if (openError) throw failed("reading the open sold-out alerts", openError);

  for (const alert of open ?? []) {
    if (!alert.community_id) continue;
    const detail = { ...(alert.detail as SoldOutDetail) };
    const conns = connections.get(alert.community_id) ?? [];
    const village = matchVillage(alert.name, villages.get(detail.site) ?? []);

    detail.livePlans = live.get(alert.community_id) ?? 0;
    detail.inventoryBack = soldOutNow.get(alert.community_id) === false;
    if (conns.length) detail.builders = conns.map((c) => ({ name: c.fp_builders?.name ?? "Builder", url: c.extractor_params?.url ?? null }));
    if ((village?.id ?? null) !== (detail.village?.id ?? null) || detail.pages === undefined) {
      detail.village = village ? { id: village.id, name: village.name } : null;
      detail.pages = village ? { neighborhood: village.page_url, homesForSale: await findHomesForSalePage(village) } : null;
    }
    const { error: detailError } = await supabase
      .from("ca_alerts")
      .update({ detail, updated_at: new Date().toISOString() })
      .eq("id", alert.id);
    if (detailError) throw failed(`updating ${alert.name}'s alert`, detailError);

    await setSelfCheck(alert.id, "listings_engine", Boolean(village?.active && village.terms > 0), null);
    await setSelfCheck(alert.id, "connections", !conns.some(running), "retire");
    result.refreshed += 1;
    if (await settleAlert(alert.id)) result.closed += 1;
  }

  return result;
}

/**
 * A self-checking item set to what the Hub sees, unless a person has
 * answered it by hand: their answer stands.
 */
async function setSelfCheck(alertId: string, key: string, passes: boolean, choice: string | null): Promise<void> {
  const { data: current, error } = await supabase
    .from("ca_alert_items")
    .select("done_at, by_hand, not_applicable")
    .eq("alert_id", alertId)
    .eq("item_key", key)
    .maybeSingle();
  if (error) throw failed(`reading the alert's "${key}" item`, error);
  if (current?.by_hand || current?.not_applicable) return;
  if (Boolean(current?.done_at) === passes) return;
  const now = new Date().toISOString();
  const { error: writeError } = await supabase.from("ca_alert_items").upsert(
    {
      alert_id: alertId,
      item_key: key,
      done_at: passes ? now : null,
      by_hand: false,
      choice: passes ? choice : null,
      updated_at: now,
    },
    { onConflict: "alert_id,item_key" }
  );
  if (writeError) throw failed(`checking the alert's "${key}" item`, writeError);
}
