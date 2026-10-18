// New neighborhoods (Jeff, 2026-10-17): a neighborhood with homes for sale
// in a place we cover that is in neither the new-build engine nor the
// listings engine raises a Community Alert, whose to-do list is the work of
// adding it (checklists.ts). Adding it to the engines is left to the
// person: they choose the listings search terms and set the new-build
// connection up with Claude; the Hub ticks those items once it sees them.
//
// A neighborhood is ours when the website has a page for it, which is when
// the listings engine has it (its villages are the site's village pages).
// The new-build engine having floor plans for one is not enough: Stillwater,
// Madera and Westlake sold new builds with no village page (Jeff,
// 2026-10-18), so every neighborhood with floor plans and no page is read
// as new too.
//
// Where the homes are read, per site:
//  - every site: the new-build engine's live floor plans;
//  - Lakewood Ranch and Wellen Park: the master-planned community's own
//    home finder, which lists every builder's homes with the neighborhood
//    they are in. It is the community's own list, so a name on it is a
//    place we cover.
//  - Parrish: the MLS's new-construction listings in the site's market.
//    The MLS market is wider than the place and a builder's single lot
//    is no neighborhood, so a subdivision needs MIN_MLS_HOMES of them.
// Lakewood Ranch and Wellen Park are not read from the MLS: their markets
// take in Sarasota, Bradenton and North Port, and their new-construction
// listings are mostly infill lots and condominiums (some 250 subdivisions
// on 2026-10-17).
//
// A name a person ignores is never raised again. A dismissed alert is
// raised again after DISMISS_QUIET_DAYS if the homes are still there; a
// finished one never is.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { failedAt as failed, describeError } from "@/lib/shared/describe-error";
import { listPageHtml, parseCards, parseHotelCards, priceOf } from "@/lib/floorplans/extractors/mpc-aggregator";
import { loadVillagesWithTerms, selectAll } from "@/lib/listings/db";
import { matchVillage as termMatch } from "@/lib/listings/classify";
import type { LsSite, VillageWithTerms } from "@/lib/listings/types";
import { setSelfCheck, settleAlert } from "@/lib/community-alerts/alerts";
import { findHomesForSalePage, nameKey, type VillageRow } from "@/lib/community-alerts/sold-out";

/** A subdivision needs this many new-construction listings on the MLS to be read as a neighborhood. */
export const MIN_MLS_HOMES = 3;
/** How long a dismissed new-neighborhood alert keeps quiet. */
export const DISMISS_QUIET_DAYS = 30;

type SourceKind = "lakewoodranch" | "wellenpark" | "mls" | "floorplans";

const SOURCES: Record<SourceKind, { label: string; url: string | null }> = {
  floorplans: { label: "new-build engine (floor plans, no village page)", url: null },
  lakewoodranch: {
    label: "Lakewood Ranch home finder",
    // The bare page draws no homes until it is searched.
    url: "https://lakewoodranch.com/home-finder/?home-search=Search+Homes&submitted=1&sortby=price-asc",
  },
  wellenpark: { label: "Wellen Park home finder", url: "https://www.wellenpark.com/available-homes/" },
  mls: { label: "MLS new-construction listings", url: null },
};

/** Where each site's new neighborhoods are read. Longboat Key has no new construction to speak of. */
export const SITE_SOURCES: Record<string, Exclude<SourceKind, "floorplans">> = {
  "lifeatlakewood.com": "lakewoodranch",
  "lifeinwellenpark.com": "wellenpark",
  "lifeatparrish.com": "mls",
};

const PLACE_NAMES = /\b(?:wellen\s+park|lakewood\s+ranch|parrish)\b/g;

/**
 * A neighborhood's name as every source can agree on it: nameKey, without
 * the place it is in or "golf". Wellen Park's home finder files Esplanade
 * as "esplanade" where the new-build engine calls it "Esplanade at Wellen
 * Park", and its golf club as "wellen-park-golf-country-club" where the
 * engines say "Wellen Park Country Club". Empty for a name that is only
 * the place. Pure; exported for tests.
 */
export function placeKey(name: string): string {
  let text = name;
  try {
    text = decodeURIComponent(name);
  } catch {
    // Not escaped after all.
  }
  return nameKey(text.toLowerCase().replace(/[-_]+/g, " ").replace(PLACE_NAMES, " ").replace(/\bgolf\b/g, " "));
}

/** "wellen-park-golf-country-club" → "Wellen Park Golf Country Club"; "RIVER PRESERVE ESTATES" → "River Preserve Estates". Pure. */
export function titleCase(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/**
 * An MLS subdivision as a neighborhood's name: without the county's code
 * in front ("3458 - STRAND AT CEDAR GROVE", "4556; REAGAN LANDING"), the
 * note behind ("--- PRELIM"), or the phase ("SEAFLOWER PH I SUBPH IA",
 * "GRAND PARK PHASE 2", "WATERCOLOR PLACE I"). Pure; exported for tests.
 */
export function cleanSubdivision(raw: string): string {
  return raw
    .replace(/^\s*\d+\s*[-;:]\s*/, "")
    .replace(/\s*-{2,}.*$/, "")
    .replace(/\s+(?:PH|PHASE|SUBPH|UNIT|SEC|SECTION)\b.*$/i, "")
    .replace(/\s+(?:I{1,3}|IV|V|\d{1,2}[A-Z]?)$/i, "")
    .trim();
}

export interface Home {
  /** The neighborhood as the source names it. */
  neighborhood: string;
  builder: string | null;
  price: number | null;
}

export interface Sighting {
  key: string;
  /** The name the source uses most for it. */
  name: string;
  homes: number;
  builders: string[];
  priceLow: number | null;
  priceHigh: number | null;
}

/** The homes, gathered into neighborhoods by placeKey; a name that is only the place is left out. Pure; exported for tests. */
export function groupHomes(homes: Home[]): Sighting[] {
  const groups = new Map<string, { names: Map<string, number>; homes: number; builders: Set<string>; prices: number[] }>();
  for (const home of homes) {
    const key = placeKey(home.neighborhood);
    if (!key) continue;
    const g = groups.get(key) ?? { names: new Map<string, number>(), homes: 0, builders: new Set<string>(), prices: [] as number[] };
    g.homes += 1;
    g.names.set(home.neighborhood, (g.names.get(home.neighborhood) ?? 0) + 1);
    if (home.builder) g.builders.add(home.builder);
    if (home.price != null) g.prices.push(home.price);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      name: titleCase([...g.names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]),
      homes: g.homes,
      builders: [...g.builders].sort(),
      priceLow: g.prices.length ? Math.min(...g.prices) : null,
      priceHigh: g.prices.length ? Math.max(...g.prices) : null,
    }))
    .sort((a, b) => b.homes - a.homes || a.name.localeCompare(b.name));
}

/** Every home on Wellen Park's home finder, by the neighborhood its card names. Pure; exported for tests. */
export function wellenParkHomes(html: string): Home[] {
  return parseCards(html)
    .filter((card) => card.attrs.neighborhood)
    .map((card) => ({
      neighborhood: card.attrs.neighborhood,
      builder: card.attrs["builder-name"] ?? card.attrs.builder ?? null,
      price: priceOf(card.h4),
    }));
}

/** Every home on Lakewood Ranch's home finder, by the village its card spells out. Pure; exported for tests. */
export function lakewoodRanchHomes(html: string, origin: string): Home[] {
  return parseHotelCards(html, origin)
    .filter((h) => h.village)
    .map((h) => ({ neighborhood: h.village.replace(/&#8211;|&ndash;/g, "-"), builder: h.builder || null, price: h.plan.price }));
}

interface MlsRow {
  subdivision: string | null;
  street_text: string | null;
  list_price: number | null;
}

/**
 * The MLS's new-construction listings that no listings-engine term takes,
 * as homes of their cleaned subdivision. Pure; exported for tests.
 */
export function mlsHomes(rows: MlsRow[], villages: VillageWithTerms[]): Home[] {
  return rows
    .filter((r) => r.subdivision && !termMatch(r.subdivision, r.street_text, villages))
    .map((r) => ({ neighborhood: cleanSubdivision(r.subdivision!), builder: null, price: r.list_price }));
}

async function readMls(site: LsSite, villages: VillageWithTerms[]): Promise<Home[]> {
  const cities = (site.market_cities ?? []).filter(Boolean);
  if (!cities.length) return [];
  const cityFilter = cities.flatMap((c) => [`city.ilike.${c}`, `postal_city.ilike.${c}`]).join(",");
  const rows = await selectAll<MlsRow>("load new-construction listings", (from, to) =>
    supabase
      .from("ls_listings")
      .select("subdivision, street_text, list_price")
      .eq("in_feed", true)
      .eq("standard_status", "Active")
      .eq("new_construction", true)
      .in("property_type", site.property_types ?? [])
      .or(cityFilter)
      .order("listing_id")
      .range(from, to)
  );
  return mlsHomes(rows, villages);
}

async function readSource(kind: SourceKind, site: LsSite | null, villages: VillageWithTerms[]): Promise<Home[]> {
  if (kind === "mls") return site ? readMls(site, villages) : [];
  const url = SOURCES[kind].url!;
  const html = await listPageHtml(url);
  const homes = kind === "wellenpark" ? wellenParkHomes(html) : lakewoodRanchHomes(html, new URL(url).origin);
  // An empty home finder is the page changing shape, not every home selling.
  if (!homes.length) throw new Error(`${SOURCES[kind].label} listed no homes at ${url}; the page may have changed`);
  return homes;
}

export interface NewNeighborhoodDetail {
  site: string;
  source: string;
  sourceUrl: string | null;
  homes: number;
  builders: string[];
  priceLow: number | null;
  priceHigh: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  village?: { id: string; name: string } | null;
  pages?: { neighborhood: string | null; homesForSale: string | null } | null;
  /** Raised for a watched name: what the watch list said about it. */
  watched?: { note: string | null; sourceUrl: string | null };
}

/** Whether a name stays quiet: ignored, finished, or dismissed lately. Pure; exported for tests. */
export function isQuiet(
  key: string,
  ctx: { ignored: Set<string>; closed: { subject_key: string; status: string; resolved_at: string | null }[]; now: number }
): boolean {
  if (ctx.ignored.has(key)) return true;
  return ctx.closed.some(
    (a) =>
      a.subject_key === key &&
      (a.status === "done" ||
        (a.status === "dismissed" && a.resolved_at != null && ctx.now - new Date(a.resolved_at).getTime() < DISMISS_QUIET_DAYS * 86_400_000))
  );
}

export interface SiteContext {
  fpSiteId: string;
  domain: string;
  lsSite: LsSite | null;
  villages: VillageWithTerms[];
  /** The placeKeys of every neighborhood either engine has on the site. */
  known: Set<string>;
  /** The placeKeys of the neighborhoods with a page on the site: the listings engine's villages. */
  pages: Set<string>;
  communities: { id: string; name: string; running: boolean }[];
}

export async function siteContext(domain: string): Promise<SiteContext | null> {
  const { data: fpSite, error } = await supabase.from("fp_sites").select("id").eq("domain", domain).maybeSingle();
  if (error) throw failed(`reading ${domain}'s site`, error);
  if (!fpSite) return null;
  const { data: lsSite, error: lsError } = await supabase.from("ls_sites").select("*").eq("domain", domain).maybeSingle();
  if (lsError) throw failed(`reading ${domain}'s listings site`, lsError);
  const villages = lsSite ? await loadVillagesWithTerms(lsSite.id) : [];
  const { data: communities, error: commError } = await supabase
    .from("fp_communities")
    .select("id, name, fp_builder_communities(active, fp_builders:builder_id(active))")
    .eq("site_id", fpSite.id);
  if (commError) throw failed(`reading ${domain}'s communities`, commError);
  const comms = (communities ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    running: ((c.fp_builder_communities ?? []) as unknown as { active: boolean; fp_builders: { active: boolean } | null }[]).some(
      (bc) => bc.active && bc.fp_builders?.active !== false
    ),
  }));
  const pages = new Set<string>([...villages.map((v) => v.name), ...villages.map((v) => v.wix_slug ?? "")].map(placeKey).filter(Boolean));
  const known = new Set<string>([...pages, ...comms.map((c) => placeKey(c.name)).filter(Boolean)]);
  return { fpSiteId: fpSite.id, domain, lsSite: lsSite as LsSite | null, villages, known, pages, communities: comms };
}

/** The new-build engine's live floor plans on the site, as homes of their community. */
async function readFloorPlanHomes(ctx: SiteContext): Promise<Home[]> {
  const names = new Map(ctx.communities.map((c) => [c.id, c.name]));
  const rows = await selectAll<{ community_id: string; price: number | null; fp_builders: { name: string } | null }>(
    "load the live floor plans",
    (from, to) =>
      supabase
        .from("fp_floor_plans")
        .select("community_id, price, fp_builders:builder_id(name)")
        .eq("site_id", ctx.fpSiteId)
        .is("removed_at", null)
        .order("id")
        .range(from, to)
  );
  return rows
    .filter((r) => names.has(r.community_id))
    .map((r) => ({ neighborhood: names.get(r.community_id)!, builder: r.fp_builders?.name ?? null, price: r.price }));
}

export interface NewNeighborhoodScan {
  sources: { site: string; source: string; homes: number; neighborhoods: number; error?: string }[];
  raised: string[];
  /** Watched neighborhoods that have homes now. */
  watchFound: string[];
  /** Open alerts whose homes were counted again. */
  seenAgain: number;
}

/** Reads every site's source and raises an alert for each neighborhood we do not have, unless it is quiet. */
export async function scanNewNeighborhoods(): Promise<NewNeighborhoodScan> {
  const result: NewNeighborhoodScan = { sources: [], raised: [], watchFound: [], seenAgain: 0 };
  const now = new Date();
  for (const [domain, kind] of Object.entries(SITE_SOURCES)) {
    const ctx = await siteContext(domain);
    if (!ctx) continue;
    // The floor plans first: a neighborhood the new-build engine sells and
    // the site has no page for is named as the engine names it.
    const planGroups = groupHomes(await readFloorPlanHomes(ctx));
    result.sources.push({
      site: domain,
      source: SOURCES.floorplans.label,
      homes: planGroups.reduce((n, g) => n + g.homes, 0),
      neighborhoods: planGroups.filter((g) => !ctx.pages.has(g.key)).length,
    });
    let sourceGroups: Sighting[] = [];
    try {
      const homes = await readSource(kind, ctx.lsSite, ctx.villages);
      sourceGroups = groupHomes(homes);
      result.sources.push({
        site: domain,
        source: SOURCES[kind].label,
        homes: homes.length,
        neighborhoods: sourceGroups.filter((g) => kind !== "mls" || g.homes >= MIN_MLS_HOMES).length,
      });
    } catch (error) {
      result.sources.push({ site: domain, source: SOURCES[kind].label, homes: 0, neighborhoods: 0, error: describeError(error) });
      logger.warn("New-neighborhood source could not be read", { site: domain, source: kind, error: describeError(error) });
    }
    const planKeys = new Set(planGroups.map((g) => g.key));
    const sightings: { s: Sighting; source: SourceKind }[] = [
      ...planGroups.map((s) => ({ s, source: "floorplans" as SourceKind })),
      ...sourceGroups
        .filter((s) => !planKeys.has(s.key) && (kind !== "mls" || s.homes >= MIN_MLS_HOMES))
        .map((s) => ({ s, source: kind as SourceKind })),
    ];

    const { data: ignoredRows, error: ignoredError } = await supabase
      .from("ca_ignored_neighborhoods")
      .select("name_key")
      .eq("site_id", ctx.fpSiteId);
    if (ignoredError) throw failed("reading the ignored neighborhoods", ignoredError);
    const { data: alertRows, error: alertError } = await supabase
      .from("ca_alerts")
      .select("id, subject_key, status, resolved_at, detail")
      .eq("kind", "new_neighborhood")
      .eq("site_id", ctx.fpSiteId);
    if (alertError) throw failed("reading the new-neighborhood alerts", alertError);
    const ignored = new Set((ignoredRows ?? []).map((r) => r.name_key as string));
    const open = new Map((alertRows ?? []).filter((a) => a.status === "open").map((a) => [a.subject_key as string, a]));
    const closed = (alertRows ?? []).filter((a) => a.status !== "open") as { subject_key: string; status: string; resolved_at: string | null }[];

    // The watch list first: a watched name needs only one home, from the
    // site's own source or the MLS, and is raised whatever its quiet.
    const { data: watchRows, error: watchError } = await supabase
      .from("ca_watch_list")
      .select("id, name, name_key, note, source_url")
      .eq("site_id", ctx.fpSiteId)
      .eq("status", "watching");
    if (watchError) throw failed("reading the watch list", watchError);
    if (watchRows?.length) {
      const anyHomes = new Map<string, Sighting & { source: SourceKind }>();
      for (const g of planGroups) anyHomes.set(g.key, { ...g, source: "floorplans" });
      for (const g of sourceGroups) if (!anyHomes.has(g.key)) anyHomes.set(g.key, { ...g, source: kind });
      if (kind !== "mls" && ctx.lsSite) {
        for (const g of groupHomes(await readMls(ctx.lsSite, ctx.villages))) {
          if (!anyHomes.has(g.key)) anyHomes.set(g.key, { ...g, source: "mls" });
        }
      }
      for (const w of watchRows) {
        const key = w.name_key as string;
        const found = ctx.pages.has(key) ? null : anyHomes.get(key);
        if (!ctx.pages.has(key) && !found) continue;
        let alertId: string | null = (open.get(key)?.id as string | undefined) ?? null;
        if (found && !alertId) {
          const detail: NewNeighborhoodDetail = {
            site: domain,
            source: SOURCES[found.source].label,
            sourceUrl: SOURCES[found.source].url,
            homes: found.homes,
            builders: found.builders,
            priceLow: found.priceLow,
            priceHigh: found.priceHigh,
            firstSeenAt: now.toISOString(),
            lastSeenAt: now.toISOString(),
            watched: { note: w.note ?? null, sourceUrl: w.source_url ?? null },
          };
          const { data: inserted, error: insertError } = await supabase
            .from("ca_alerts")
            .insert({ kind: "new_neighborhood", site_id: ctx.fpSiteId, subject_key: key, name: w.name, detail })
            .select("id, subject_key, status, resolved_at, detail")
            .single();
          if (insertError) throw failed(`raising watched ${w.name}'s alert`, insertError);
          alertId = inserted.id;
          open.set(key, inserted);
          await closeAnnouncement(ctx.fpSiteId, key);
          result.raised.push(w.name);
          logger.info("Watched neighborhood has homes", { site: domain, neighborhood: w.name, homes: found.homes });
        }
        // Found with homes, or given a page by hand: either way there is
        // nothing left to wait for.
        const { error: foundError } = await supabase
          .from("ca_watch_list")
          .update({ status: "found", found_at: now.toISOString(), alert_id: alertId })
          .eq("id", w.id);
        if (foundError) throw failed(`marking ${w.name} found`, foundError);
        result.watchFound.push(w.name);
      }
    }

    for (const { s, source } of sightings) {
      if (ctx.pages.has(s.key)) continue;
      const seen = {
        homes: s.homes,
        builders: s.builders,
        priceLow: s.priceLow,
        priceHigh: s.priceHigh,
        lastSeenAt: now.toISOString(),
      };
      const already = open.get(s.key);
      if (already) {
        const { error: updateError } = await supabase
          .from("ca_alerts")
          .update({ detail: { ...(already.detail as object), ...seen }, updated_at: now.toISOString() })
          .eq("id", already.id);
        if (updateError) throw failed(`updating ${s.name}'s alert`, updateError);
        result.seenAgain += 1;
        continue;
      }
      if (isQuiet(s.key, { ignored, closed, now: now.getTime() })) continue;
      const detail: NewNeighborhoodDetail = {
        site: domain,
        source: SOURCES[source].label,
        sourceUrl: SOURCES[source].url,
        firstSeenAt: now.toISOString(),
        ...seen,
      };
      const { error: insertError } = await supabase.from("ca_alerts").insert({
        kind: "new_neighborhood",
        site_id: ctx.fpSiteId,
        subject_key: s.key,
        name: s.name,
        detail,
      });
      if (insertError && insertError.code !== "23505") throw failed(`raising ${s.name}'s alert`, insertError);
      if (!insertError) {
        result.raised.push(s.name);
        logger.info("New neighborhood found", { site: domain, neighborhood: s.name, homes: s.homes, source });
        await closeAnnouncement(ctx.fpSiteId, s.key);
      }
    }
  }
  logger.info("New-neighborhood scan", { sources: result.sources, raised: result.raised, watchFound: result.watchFound, seenAgain: result.seenAgain });
  return result;
}

/**
 * An open announcement of a neighborhood that now has homes for sale is
 * done: the new-neighborhood alert just raised for it carries the work.
 */
async function closeAnnouncement(siteId: string, key: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ca_alerts")
    .update({ status: "done", resolved_at: now, updated_at: now })
    .eq("kind", "announcement")
    .eq("site_id", siteId)
    .eq("subject_key", key)
    .eq("status", "open");
  if (error) throw failed("closing the announcement", error);
}

/**
 * The open new-neighborhood alerts' self-checking items brought up to date:
 * the listings engine has the neighborhood with a search term, and the
 * new-build engine has it with a connection running. Once the listings
 * engine has it, its pages are linked. Reads the database only.
 */
export async function refreshNewNeighborhoodAlerts(): Promise<{ refreshed: number; closed: number }> {
  const { data: open, error } = await supabase
    .from("ca_alerts")
    .select("id, subject_key, detail")
    .eq("kind", "new_neighborhood")
    .eq("status", "open");
  if (error) throw failed("reading the open new-neighborhood alerts", error);
  const contexts = new Map<string, SiteContext | null>();
  let refreshed = 0;
  let closed = 0;
  for (const alert of open ?? []) {
    const detail = { ...(alert.detail as NewNeighborhoodDetail) };
    if (!contexts.has(detail.site)) contexts.set(detail.site, await siteContext(detail.site));
    const ctx = contexts.get(detail.site);
    if (!ctx || !alert.subject_key) continue;
    const key = alert.subject_key as string;
    const village = ctx.villages.find((v) => placeKey(v.name) === key || (v.wix_slug && placeKey(v.wix_slug) === key)) ?? null;
    const community = ctx.communities.find((c) => placeKey(c.name) === key) ?? null;

    if ((village?.id ?? null) !== (detail.village?.id ?? null)) {
      detail.village = village ? { id: village.id, name: village.name } : null;
      const row: VillageRow | null = village
        ? { id: village.id, name: village.name, wix_slug: village.wix_slug, page_url: village.page_url, active: village.active, terms: village.terms.length }
        : null;
      detail.pages = row ? { neighborhood: row.page_url, homesForSale: await findHomesForSalePage(row) } : null;
      const { error: detailError } = await supabase
        .from("ca_alerts")
        .update({ detail, updated_at: new Date().toISOString() })
        .eq("id", alert.id);
      if (detailError) throw failed("updating the alert's pages", detailError);
    }

    await setSelfCheck(alert.id, "listings_engine", Boolean(village && village.active !== false && village.terms.length > 0), null);
    await setSelfCheck(alert.id, "new_build_engine", Boolean(community?.running), null);
    refreshed += 1;
    if (await settleAlert(alert.id)) closed += 1;
  }
  return { refreshed, closed };
}
