// The engine's run: pull from MLSGrid, upsert the listings and their photo
// identities, classify per site, and write each site's target collection.
// Ported from runSync in the Longboat Key Velo backend with the plan's
// changes: staged state lives in Postgres, writes are bulk, and a record is
// written only with photos the site already has (a partial gallery is
// written and the row stays gallery_ready = false for the photo job).
//
// Two modes:
//   incremental - every MLS record modified since the watermark (the newest
//                 complete incremental run), MLS-wide because MLSGrid allows
//                 no city filter. The window is bounded; older drift is the
//                 full run's job.
//   full        - verify-by-id of every listing the engine holds, 50 per
//                 request. Anything MLSGrid no longer returns is not_in_feed.
// Both honour a deadline (the cron tick's budget) and leave a run row with
// stage and counts at every checkpoint.

import { MlsGridClient, MlsGridError, type MlsGridStats } from "@/lib/listings/mlsgrid";
import { normalizeListing } from "@/lib/listings/normalize";
import { classifyListing } from "@/lib/listings/classify";
import { buildListingRecord, recordFingerprint } from "@/lib/listings/transform";
import { seedSiteMediaFromLive } from "@/lib/listings/media-seed";
import { runPhotoJob, type PhotoDeps, type PhotoSummary } from "@/lib/listings/photos";
import { refreshVillageStatsOnWix } from "@/lib/listings/village-stats";
import { loadDiscoverCursor, nextCursor, saveDiscoverCursor, type DiscoverSummary } from "@/lib/listings/discover";
import * as db from "@/lib/listings/db";
import {
  lastCompleteIncrementalStartedAt,
  previousRunStartedAt,
  startRun,
  type RunCounts,
  type RunHandle,
} from "@/lib/listings/runs";
import { bulkRemoveItems, bulkSaveItems, WixApiError, type WixItemData } from "@/lib/wix/client";
import { errorMessage } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import type {
  GalleryItem,
  LsListingRow,
  LsSite,
  LsSiteListing,
  MlsGridProperty,
  ReasonCode,
  RunTrigger,
  VillageWithTerms,
} from "@/lib/listings/types";

export const INCREMENTAL_EVERY_MINUTES = 60;
export const RUN_LATE_AFTER_MINUTES = 120;
/** An incremental window never reaches back further than this; the full run covers the rest. */
export const MAX_WINDOW_HOURS = 24;
/** Re-pull a little before the watermark so a record modified while the last run ran is not missed. */
export const WATERMARK_OVERLAP_MS = 2 * 60_000;
/** 40 pages of 200 is 8,000 MLS-wide records, well inside a tick. */
export const DEFAULT_MAX_PAGES = 40;
/** Live rows are rewritten this often so dateOfMlsPull stays fresh (MLSGrid compliance). */
export const PULL_DATE_REFRESH_HOURS = 12;
export const MASS_DELETE_MIN = 10;
export const MASS_DELETE_SHARE = 0.1;
const WRITE_CHUNK = 200;
const FETCH_RESERVE_MS = 90_000;
const DATA_DRIVEN_REASONS: ReadonlySet<ReasonCode> = new Set(["city_change", "no_village", "mls_revoked", "not_in_feed"]);

/** The photo step inside a run gets at most this long, and always leaves the writes this much. */
export const PHOTOS_BUDGET_MS = 90_000;
/**
 * A discovery scan stops this long before the fetch deadline so the finds
 * can be pulled by id with their Media in the same run (50 ids a request:
 * 45 s is a couple of thousand listings). The first Parrish scan spent the
 * whole budget scanning and pulled none of its 211 finds.
 */
export const DISCOVER_PULL_RESERVE_MS = 45_000;
export const WRITE_RESERVE_MS = 60_000;

/** What a run pulls: the hourly window, the full verify of every held id, or a discovery scan of every Active listing. */
export type ReconcileMode = "incremental" | "full" | "discover";

/** The mode word the Hub uses for a run. */
export function modeWord(mode: ReconcileMode): string {
  return mode === "incremental" ? "hourly" : mode === "discover" ? "discovery" : mode;
}

/** Removal and hold rules know two modes; a discovery run behaves like an hourly one (nothing is judged missing). */
const classifyMode = (mode: ReconcileMode): "incremental" | "full" => (mode === "full" ? "full" : "incremental");

export interface ReconcileOptions {
  mode: ReconcileMode;
  trigger: RunTrigger;
  /** Epoch ms; the run stops fetching 90 s before it and stops writing at it. */
  deadline: number;
  allowMassDelete?: boolean;
  /** Incremental and discover: pages to read before stopping (the deadline stops earlier). */
  maxPages?: number;
  /** Incremental only: pull from this instant instead of the watermark. */
  since?: Date;
  siteIds?: string[];
  client?: MlsGridClient;
  /** The photo step's IO, injectable for tests. */
  photoDeps?: Partial<PhotoDeps>;
}

export interface SiteWriteSummary {
  siteId: string;
  domain: string;
  writeMode: string;
  target: string;
  classified: number;
  eligible: number;
  removedNow: number;
  inserted: number;
  updated: number;
  unchanged: number;
  waitingForPhotos: number;
  waitingForData: number;
  failed: number;
  deleted: number;
  unstaged: number;
  held: number;
  villagesChanged: number;
  skipped?: string;
}

export interface ReconcileResult {
  runId: string | null;
  runKey: string;
  mode: ReconcileMode;
  status: "ok" | "error";
  stage: string;
  truncated: boolean;
  /** Records received from MLSGrid (MLS-wide for an incremental run). */
  fetched: number;
  /** Of those, the ones a site can care about: in a market city or already held. */
  relevant: number;
  missing: number;
  counts: RunCounts;
  mlsgrid: MlsGridStats;
  sites: SiteWriteSummary[];
  /** What the photo step did, when it ran. */
  photos?: PhotoSummary;
  /** What a discovery run scanned and found. */
  discover?: DiscoverSummary;
  error?: string;
}

export function massDeleteThreshold(liveCount: number): number {
  return Math.max(MASS_DELETE_MIN, Math.ceil(liveCount * MASS_DELETE_SHARE));
}

/**
 * Which pending removals a run may apply. A full run that wants to remove
 * max(10, 10%) of a site's inventory is what a broken feed looks like, so it
 * removes nothing and records the candidates; an hourly run holds back only
 * the data-driven removals (city, village, display rights, feed) above the
 * same threshold, since status changes are individually trustworthy.
 */
export function planRemovals<T extends { reason_code: ReasonCode | null }>(
  pending: T[],
  ctx: { mode: "incremental" | "full"; liveCount: number; allowMassDelete?: boolean }
): { apply: T[]; held: T[]; threshold: number } {
  const threshold = massDeleteThreshold(ctx.liveCount);
  if (ctx.allowMassDelete) return { apply: pending, held: [], threshold };
  if (ctx.mode === "full") {
    return pending.length >= threshold ? { apply: [], held: pending, threshold } : { apply: pending, held: [], threshold };
  }
  const dataDriven = pending.filter((p) => p.reason_code && DATA_DRIVEN_REASONS.has(p.reason_code));
  if (dataDriven.length >= threshold) {
    const heldIds = new Set(dataDriven);
    return { apply: pending.filter((p) => !heldIds.has(p)), held: dataDriven, threshold };
  }
  return { apply: pending, held: [], threshold };
}

/**
 * Whether any site can care about an MLS-wide record: it is in some site's
 * market, or the engine already holds it (so a move out of the market, a
 * status change or a revoked MlgCanView still reaches the site that shows
 * it). Everything else in an hourly pull is another city's listing.
 */
export function isRelevant(raw: MlsGridProperty, marketCities: ReadonlySet<string>, known: ReadonlySet<string>): boolean {
  if (!raw || typeof raw.ListingId !== "string" || !raw.ListingId) return false;
  if (known.has(raw.ListingId)) return true;
  const city = (raw.City || raw.PostalCity || "").toLowerCase();
  return !!city && marketCities.has(city);
}

function formatMinutes(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function describeRecord(record: WixItemData): string {
  const parts: string[] = [];
  if (typeof record.village === "string") parts.push(record.village);
  if (typeof record.listingPrice === "string") parts.push(record.listingPrice);
  const n = Array.isArray(record.listingImageGallery) ? record.listingImageGallery.length : 0;
  parts.push(`${n} photo${n === 1 ? "" : "s"}`);
  return parts.join(", ");
}

const deleteLevel = (reason: ReasonCode | null): "info" | "warn" =>
  reason && DATA_DRIVEN_REASONS.has(reason) ? "warn" : "info";

export async function runReconcile(opts: ReconcileOptions): Promise<ReconcileResult> {
  const startedAt = new Date();
  const run = await startRun({ mode: opts.mode, trigger: opts.trigger, startedAt });
  const result: ReconcileResult = {
    runId: run.id,
    runKey: run.runKey,
    mode: opts.mode,
    status: "ok",
    stage: "start",
    truncated: false,
    fetched: 0,
    relevant: 0,
    missing: 0,
    counts: run.counts,
    mlsgrid: { requests: 0, bytes: 0, retries: 0, rateLimited: 0 },
    sites: [],
  };
  let stage = "gap-check";
  try {
    const previous = await previousRunStartedAt();
    if (previous) {
      const gapMinutes = (startedAt.getTime() - previous.getTime()) / 60_000;
      run.counts.gap_minutes = Math.round(gapMinutes);
      if (gapMinutes > RUN_LATE_AFTER_MINUTES) {
        run.event("warn", "gap", `No run recorded for ${formatMinutes(gapMinutes)} (expected every ${INCREMENTAL_EVERY_MINUTES} min)`, {
          details: { gapMinutes: Math.round(gapMinutes), previousStartedAt: previous.toISOString() },
        });
      }
    }

    stage = "seed";
    await run.checkpoint(stage);
    const sites = await db.loadActiveSites(opts.siteIds);
    for (const site of sites) {
      // While a site is in shadow mode its live galleries are still the Velo
      // pipeline's, which re-uploads and trashes files as it goes: re-read them
      // so the shadow write carries the URIs the site serves right now, and so
      // a listing new on the site has a placeholder for this run to verify.
      if (site.write_mode !== "shadow" || !site.wix_site_id || site.target_collection_id === site.live_collection_id) continue;
      try {
        const seeded = await seedSiteMediaFromLive(site);
        if (seeded.placeholders || seeded.siteMediaRows || seeded.refreshed) {
          run.event("info", "seed", `${site.name}: live galleries re-read: ${seeded.placeholders} new listing(s), ${seeded.siteMediaRows} photo(s) recorded, ${seeded.refreshed} URI(s) refreshed`, {
            siteId: site.id, details: seeded,
          });
        }
      } catch (error) {
        run.event("warn", "seed_failed", `${site.name}: could not re-read the live galleries (${errorMessage(error)}); writing with the photos already recorded`, { siteId: site.id });
      }
    }

    stage = "fetch";
    await run.checkpoint(stage);
    const client = opts.client ?? new MlsGridClient();
    const fetchDeadline = opts.deadline - FETCH_RESERVE_MS;

    let items: MlsGridProperty[] = [];
    let relevant: MlsGridProperty[] = [];
    let missingIds: string[] = [];
    let truncated = false;
    if (opts.mode === "incremental") {
      let since = opts.since ?? (await lastCompleteIncrementalStartedAt()) ?? new Date(startedAt.getTime() - 2 * 3600_000);
      since = new Date(since.getTime() - WATERMARK_OVERLAP_MS);
      const windowMinutes = (startedAt.getTime() - since.getTime()) / 60_000;
      if (windowMinutes > MAX_WINDOW_HOURS * 60) {
        run.event("warn", "gap", `Incremental window had grown to ${formatMinutes(windowMinutes)}; clamped to ${MAX_WINDOW_HOURS}h, the nightly full run reconciles anything older`, {
          details: { windowMinutes: Math.round(windowMinutes), since: since.toISOString() },
        });
        since = new Date(startedAt.getTime() - MAX_WINDOW_HOURS * 3600_000);
      }
      run.counts.fetch_window_minutes = Math.round((startedAt.getTime() - since.getTime()) / 60_000);
      const pull = await client.fetchModifiedSince(since, { maxPages: opts.maxPages ?? DEFAULT_MAX_PAGES, deadline: fetchDeadline });
      items = pull.items;
      truncated = pull.truncated;
      run.counts.mlsgrid_listing_count = pull.expectedCount ?? items.length;
      if (truncated) {
        run.event("warn", "budget", `Incremental pull stopped after ${pull.pages} page(s), ${items.length} of ${pull.expectedCount ?? "?"} MLS-wide records; the watermark stays put and the next run continues`, {
          details: { pages: pull.pages, fetched: items.length, expected: pull.expectedCount },
        });
      }
      // The pull is MLS-wide: keep what a site can care about, drop the rest unread.
      const marketCities = new Set(sites.flatMap((s) => (s.market_cities ?? []).map((c) => c.toLowerCase())));
      const known = new Set(await db.loadKnownListingIds());
      relevant = items.filter((raw) => isRelevant(raw, marketCities, known));
    } else if (opts.mode === "discover") {
      // Every Active listing MLS-wide, without Media; a scan the budget cuts
      // short leaves a cursor and the next discover run continues it.
      const prior = await loadDiscoverCursor();
      const marketCities = new Set(sites.flatMap((s) => (s.market_cities ?? []).map((c) => c.toLowerCase())));
      const known = new Set(await db.loadKnownListingIds());
      const scan = await client.fetchActive({ since: prior ? new Date(prior.sinceTimestamp) : null, maxPages: opts.maxPages, deadline: fetchDeadline - DISCOVER_PULL_RESERVE_MS });
      if (!scan.ordered) {
        run.event("warn", "discover", "MLSGrid returned a page out of ModificationTimestamp order; a resumed scan may skip records modified before its resume point");
      }
      const nobody: ReadonlySet<string> = new Set();
      const found = new Map<string, MlsGridProperty>();
      for (const raw of scan.items) {
        if (isRelevant(raw, marketCities, nobody) && !known.has(raw.ListingId)) found.set(raw.ListingId, raw);
      }
      // The finds with their Media, so their photos start now rather than
      // after the nightly full run; whatever the deadline leaves unpulled is
      // recorded without Media and the full run brings the rest.
      const verify = found.size ? await client.fetchByIds([...found.keys()], { deadline: fetchDeadline }) : null;
      const pulled = new Set((verify?.items ?? []).map((i) => i.ListingId));
      const unpulled = [...found.values()].filter((raw) => !pulled.has(raw.ListingId));
      if (unpulled.length) await db.upsertListings(unpulled.map((raw) => normalizeListing(raw, startedAt).listing));
      items = scan.items;
      relevant = verify?.items ?? [];
      truncated = scan.truncated;
      run.counts.mlsgrid_listing_count = prior?.expectedCount ?? scan.expectedCount ?? 0;
      const cursor = nextCursor(prior, { truncated: scan.truncated, lastModificationTimestamp: scan.lastModificationTimestamp, scanned: scan.items.length, found: found.size, pages: scan.pages, expectedCount: scan.expectedCount, startedAt });
      await saveDiscoverCursor(cursor);
      const summary: DiscoverSummary = {
        resumed: !!prior,
        scanned: scan.items.length,
        scannedTotal: (prior?.scanned ?? 0) + scan.items.length,
        expectedCount: prior?.expectedCount ?? scan.expectedCount,
        pages: scan.pages,
        found: found.size,
        foundTotal: (prior?.found ?? 0) + found.size,
        pulled: pulled.size,
        complete: !scan.truncated,
      };
      result.discover = summary;
      run.event("info", "discover", `Discovery: scanned ${summary.scannedTotal}${summary.expectedCount ? ` of ${summary.expectedCount}` : ""} Active listings MLS-wide, ${summary.foundTotal} new in a market city${unpulled.length ? ` (${unpulled.length} recorded without photos; the next full run pulls them)` : ""}${summary.complete ? "; scan complete" : "; the rest continues on the next run"}`, {
        details: { ...summary, unpulled: unpulled.length },
      });
    } else {
      const known = await db.loadKnownListingIds();
      const verify = await client.fetchByIds(known, { deadline: fetchDeadline });
      items = verify.items;
      truncated = verify.truncated;
      relevant = items;
      const returned = new Set(items.map((i) => i.ListingId));
      missingIds = verify.verifiedIds.filter((id) => !returned.has(id));
      run.counts.mlsgrid_listing_count = known.length;
      if (truncated) {
        run.event("warn", "budget", `Full run verified ${verify.verifiedIds.length} of ${known.length} listings before the deadline; the rest wait for the next full run`, {
          details: { verified: verify.verifiedIds.length, known: known.length },
        });
      }
    }
    result.truncated = truncated;
    result.fetched = items.length;
    result.relevant = relevant.length;
    result.missing = missingIds.length;
    result.mlsgrid = { ...client.stats };
    run.counts.mlsgrid_request_count = client.stats.requests;
    run.counts.mlsgrid_bytes = client.stats.bytes;
    run.counts.mlsgrid_items_fetched = items.length;

    stage = "upsert";
    await run.checkpoint(stage);
    const byId = new Map<string, MlsGridProperty>();
    for (const raw of relevant) if (raw && typeof raw.ListingId === "string") byId.set(raw.ListingId, raw);
    const normalized = [...byId.values()].map((raw) => normalizeListing(raw, startedAt));
    await db.upsertListings(normalized.map((n) => n.listing));
    await db.replaceListingMedia(
      normalized.flatMap((n) => n.media),
      normalized.map((n) => n.listing.listing_id)
    );
    if (missingIds.length) await db.markNotInFeed(missingIds, startedAt);

    stage = "classify";
    await run.checkpoint(stage);
    const summaries = new Map<string, SiteWriteSummary>();
    for (const site of sites) {
      const summary: SiteWriteSummary = {
        siteId: site.id, domain: site.domain, writeMode: site.write_mode, target: site.target_collection_id,
        classified: 0, eligible: 0, removedNow: 0, inserted: 0, updated: 0, unchanged: 0,
        waitingForPhotos: 0, waitingForData: 0, failed: 0, deleted: 0, unstaged: 0, held: 0, villagesChanged: 0,
      };
      summaries.set(site.id, summary);
      const villages = await db.loadVillagesWithTerms(site.id);
      const pulledIds = normalized.map((n) => n.listing.listing_id);
      const existing = await db.loadSiteListings(site.id, [...pulledIds, ...missingIds]);
      const nowIso = startedAt.toISOString();
      const rows: Array<Record<string, unknown>> = [];
      for (const { listing } of normalized) {
        summary.classified += 1;
        const prior = existing.get(listing.listing_id);
        const known = !!prior && prior.state !== "removed";
        const outcome = classifyListing(listing, { marketCities: site.market_cities, propertyTypes: site.property_types, showNewConstruction: site.show_new_construction, villages, known, mode: classifyMode(opts.mode) });
        if (outcome.kind === "eligible") {
          summary.eligible += 1;
          rows.push({
            site_id: site.id,
            listing_id: listing.listing_id,
            state: prior?.state === "live" ? "live" : "staged",
            village_id: outcome.village.id,
            reason_code: null,
            reason_detail: null,
            needs_write: true,
            ...(known ? {} : { staged_at: nowIso, removed_at: null }),
          });
        } else if (outcome.kind === "ineligible" && known) {
          summary.removedNow += 1;
          rows.push({
            site_id: site.id,
            listing_id: listing.listing_id,
            state: "removed",
            reason_code: outcome.reason,
            reason_detail: outcome.detail,
            needs_write: true,
            removed_at: nowIso,
          });
        }
      }
      for (const id of missingIds) {
        const prior = existing.get(id);
        if (!prior || prior.state === "removed") continue;
        summary.removedNow += 1;
        rows.push({
          site_id: site.id,
          listing_id: id,
          state: "removed",
          reason_code: "not_in_feed",
          reason_detail: "MLSGrid no longer returns this listing (removed from the feed)",
          needs_write: true,
          removed_at: nowIso,
        });
      }
      await db.upsertSiteListings(rows);
    }

    // ---- photos: what the sites still lack, on a budget that leaves the writes their time ----
    stage = "photos";
    await run.checkpoint(stage);
    const photoDeadline = Math.min(opts.deadline - WRITE_RESERVE_MS, Date.now() + PHOTOS_BUDGET_MS);
    if (photoDeadline > Date.now()) {
      try {
        result.photos = await runPhotoJob({ run, deadline: photoDeadline, sites, client, deps: opts.photoDeps });
      } catch (error) {
        run.event("warn", "photos_failed", `Photo step failed: ${errorMessage(error)}; writing with the photos already imported`);
      }
      run.counts.mlsgrid_request_count = client.stats.requests;
      run.counts.mlsgrid_bytes = client.stats.bytes;
      result.mlsgrid = { ...client.stats };
    }

    stage = "write";
    await run.checkpoint(stage);
    for (const site of sites) {
      const summary = summaries.get(site.id)!;
      await writeSite(site, run, opts, summary, startedAt);
      result.sites.push(summary);
    }

    run.stage = truncated ? "truncated" : "done";
    await run.finish("ok");
    result.stage = run.stage;
    result.status = "ok";
  } catch (error) {
    const message = errorMessage(error);
    const rateLimited = error instanceof MlsGridError && error.rateLimited;
    logger.error("Listings reconcile failed", { runKey: run.runKey, stage, message, rateLimited });
    if (opts.mode === "discover" && error instanceof MlsGridError && error.status === 400) {
      // A resume point MLSGrid will not accept would fail on every idle tick; drop it so discovery starts over on the next click.
      try {
        await saveDiscoverCursor(null);
        run.event("warn", "discover", `MLSGrid refused the discovery request; the saved resume point was cleared and Run Discovery starts a fresh scan: ${message.slice(0, 200)}`);
      } catch (clearError) {
        logger.warn("Could not clear the discovery cursor", { error: errorMessage(clearError) });
      }
    }
    await run.finish("error", { stage, message, stack: error instanceof Error ? error.stack : undefined });
    result.status = "error";
    result.stage = stage;
    result.error = message;
  }
  return result;
}

async function writeSite(site: LsSite, run: RunHandle, opts: ReconcileOptions, summary: SiteWriteSummary, startedAt: Date): Promise<void> {
  if (!site.wix_site_id) {
    summary.skipped = "no wix_site_id";
    return;
  }
  if (site.write_mode === "paused") {
    summary.skipped = "write_mode paused";
    return;
  }
  if (site.write_mode !== "live" && site.target_collection_id === site.live_collection_id) {
    // The database check forbids this; belt and braces before touching Wix.
    summary.skipped = "shadow mode pointed at the live collection";
    run.event("error", "write_failed", `${site.name}: refused to write, shadow mode targets the live collection ${site.live_collection_id}`, { siteId: site.id });
    return;
  }
  const target = site.target_collection_id;
  const nowIso = new Date().toISOString();
  const refreshBefore = new Date(Date.now() - PULL_DATE_REFRESH_HOURS * 3600_000);

  // ---- writes: staged and live rows that need it ----
  const due = await db.loadWritableSiteListings(site.id, refreshBefore);
  const listings = await db.loadListings(due.map((d) => d.listing_id));
  const villages = new Map((await db.loadVillagesWithTerms(site.id)).map((v) => [v.id, v]));
  const galleries = await db.loadSiteGalleries(site.id, due.map((d) => d.listing_id));

  interface Planned { sl: LsSiteListing; record: WixItemData; fingerprint: string; galleryReady: boolean; insert: boolean; contentChanged: boolean }
  const planned: Planned[] = [];
  const unchangedPatches: Array<Record<string, unknown>> = [];
  for (const sl of due) {
    const listing = listings.get(sl.listing_id);
    if (!listing || typeof listing.raw?.ListingId !== "string") {
      summary.waitingForData += 1; // a seeded placeholder the pull has not reached yet
      continue;
    }
    const village: VillageWithTerms | undefined = sl.village_id ? villages.get(sl.village_id) : undefined;
    if (!village) {
      summary.waitingForData += 1;
      continue;
    }
    const photos = galleries.get(sl.listing_id) ?? [];
    const available = photos.filter((p) => p.src);
    if (!available.length) {
      summary.waitingForPhotos += 1;
      continue;
    }
    const gallery: GalleryItem[] = available.map((p, i) => ({ type: "Image", title: p.title ?? "", src: p.src!, order: i + 1, mlsPathKey: p.pathKey }));
    const record = buildListingRecord({ listing, village, gallery, pulledAt: listing.pulled_at ? new Date(listing.pulled_at) : startedAt });
    const fingerprint = recordFingerprint(record);
    const contentChanged = sl.written_fingerprint !== fingerprint;
    const fresh = !!sl.written_at && new Date(sl.written_at) > refreshBefore;
    if (sl.state === "live" && !contentChanged && fresh) {
      unchangedPatches.push({ site_id: site.id, listing_id: sl.listing_id, needs_write: false });
      summary.unchanged += 1;
      continue;
    }
    planned.push({ sl, record, fingerprint, galleryReady: available.length === photos.length, insert: sl.state !== "live", contentChanged });
  }
  if (unchangedPatches.length) await db.upsertSiteListings(unchangedPatches);

  for (const part of db.chunk(planned, WRITE_CHUNK)) {
    if (Date.now() > opts.deadline) {
      run.event("warn", "budget", `${site.name}: out of time with ${planned.length - summary.inserted - summary.updated - summary.failed} listing(s) still to write; the next run continues`, { siteId: site.id });
      break;
    }
    let outcome;
    try {
      outcome = await bulkSaveItems(site.wix_site_id, target, part.map((p) => p.record));
      run.counts.wix_requests += outcome.requests;
    } catch (error) {
      if (error instanceof WixApiError && error.rateLimited) run.counts.wix_rate_limited += 1;
      run.counts.writes_failed += part.length;
      summary.failed += part.length;
      run.event("error", "write_failed", `${site.name}: bulk save of ${part.length} listing(s) failed: ${errorMessage(error)}`, { siteId: site.id });
      continue;
    }
    const patches: Array<Record<string, unknown>> = [];
    for (const r of outcome.results) {
      const p = part[r.originalIndex];
      if (!p) continue;
      if (r.success) {
        patches.push({
          site_id: site.id,
          listing_id: p.sl.listing_id,
          state: "live",
          wix_item_id: r.id ?? p.sl.listing_id,
          written_at: nowIso,
          written_fingerprint: p.fingerprint,
          needs_write: false,
          gallery_ready: p.galleryReady,
          live_at: p.sl.live_at ?? nowIso,
        });
        const fields = { siteId: site.id, listingId: p.sl.listing_id, address: String(p.record.propertyAddress ?? ""), village: String(p.record.village ?? "") };
        if (p.insert) {
          summary.inserted += 1;
          run.counts.inserted += 1;
          run.event(p.galleryReady ? "info" : "warn", "insert", `Written to ${site.name}: ${describeRecord(p.record)}${p.galleryReady ? "" : " (gallery incomplete, photos pending)"}`, fields);
        } else {
          summary.updated += 1;
          run.counts.updated += 1;
          if (p.contentChanged) run.event("info", "update", `Rewritten on ${site.name}: ${describeRecord(p.record)}`, fields);
        }
      } else {
        summary.failed += 1;
        run.counts.writes_failed += 1;
        run.event("error", "write_failed", `${site.name} rejected ${p.sl.listing_id}: ${r.error?.description ?? r.error?.code ?? "unknown error"}`, {
          siteId: site.id, listingId: p.sl.listing_id, details: r.error,
        });
      }
    }
    if (patches.length) await db.upsertSiteListings(patches);
  }

  // ---- removals ----
  const pending = await db.loadPendingRemovals(site.id);
  const stagedOnly = pending.filter((p) => !p.wix_item_id);
  if (stagedOnly.length) {
    await db.upsertSiteListings(stagedOnly.map((p) => ({ site_id: site.id, listing_id: p.listing_id, needs_write: false })));
    for (const p of stagedOnly) {
      summary.unstaged += 1;
      run.counts.unstaged += 1;
      run.event(deleteLevel(p.reason_code), "unstage", `Staged listing dropped before it was written: ${p.reason_detail ?? p.reason_code ?? "no reason"}`, {
        siteId: site.id, listingId: p.listing_id, details: { reasonCode: p.reason_code },
      });
    }
  }
  const withWix = pending.filter((p) => p.wix_item_id);
  if (withWix.length) {
    const liveCount = await db.countLiveSiteListings(site.id);
    const { apply, held, threshold } = planRemovals(withWix, { mode: classifyMode(opts.mode), liveCount, allowMassDelete: opts.allowMassDelete });
    if (held.length) {
      summary.held += held.length;
      run.counts.deletes_skipped += held.length;
      const byReason: Record<string, number> = {};
      for (const h of held) byReason[h.reason_code ?? "unspecified"] = (byReason[h.reason_code ?? "unspecified"] ?? 0) + 1;
      run.event("error", "mass_delete_guard", `${site.name}: ${modeWord(opts.mode)} run wanted to remove ${held.length} of ${liveCount} live listings (guard threshold ${threshold}); nothing was removed. Review the candidates and re-run with allowMassDelete if they are genuine`, {
        siteId: site.id,
        details: { candidates: held.length, threshold, live: liveCount, byReason, sample: held.slice(0, 100).map((h) => ({ id: h.listing_id, reasonCode: h.reason_code, reason: h.reason_detail })) },
      });
    }
    for (const part of db.chunk(apply, WRITE_CHUNK)) {
      if (Date.now() > opts.deadline) {
        run.event("warn", "budget", `${site.name}: out of time before removing ${apply.length - summary.deleted} listing(s); the next run continues`, { siteId: site.id });
        break;
      }
      let outcome;
      try {
        outcome = await bulkRemoveItems(site.wix_site_id, target, part.map((p) => p.wix_item_id!));
        run.counts.wix_requests += outcome.requests;
      } catch (error) {
        if (error instanceof WixApiError && error.rateLimited) run.counts.wix_rate_limited += 1;
        run.counts.writes_failed += part.length;
        summary.failed += part.length;
        run.event("error", "write_failed", `${site.name}: bulk remove of ${part.length} listing(s) failed: ${errorMessage(error)}`, { siteId: site.id });
        continue;
      }
      const patches: Array<Record<string, unknown>> = [];
      for (const r of outcome.results) {
        const p = part[r.originalIndex];
        if (!p) continue;
        const notFound = !r.success && /not.?found/i.test(`${r.error?.code ?? ""} ${r.error?.description ?? ""}`);
        if (r.success || notFound) {
          patches.push({ site_id: site.id, listing_id: p.listing_id, wix_item_id: null, needs_write: false });
          summary.deleted += 1;
          run.counts.deleted += 1;
          run.event(deleteLevel(p.reason_code), "delete", `Removed from ${site.name}: ${p.reason_detail ?? p.reason_code ?? "no reason"}`, {
            siteId: site.id, listingId: p.listing_id, details: { reasonCode: p.reason_code, alreadyGone: notFound },
          });
        } else {
          summary.failed += 1;
          run.counts.writes_failed += 1;
          run.event("error", "write_failed", `${site.name} refused to remove ${p.listing_id}: ${r.error?.description ?? r.error?.code ?? "unknown error"}`, {
            siteId: site.id, listingId: p.listing_id, details: r.error,
          });
        }
      }
      if (patches.length) await db.upsertSiteListings(patches);
    }
  }

  // ---- neighborhood counts: Postgres always; the site's neighborhoods collection once the site is live ----
  try {
    const { changed } = await db.refreshVillageCounts(site.id);
    summary.villagesChanged = changed;
    run.counts.stats_refreshed = true;
  } catch (error) {
    run.event("error", "stats_failed", `${site.name}: neighborhood counts not refreshed: ${errorMessage(error)}`, { siteId: site.id });
  }
  // In shadow mode the Velo pipeline still writes the neighborhood pages' stats and the
  // ads feed's counts; from cutover on that is this run's job (village-stats.ts).
  if (site.write_mode === "live") {
    if (Date.now() > opts.deadline) {
      run.counts.stats_refreshed = false;
      run.event("warn", "budget", `${site.name}: out of time before the neighborhood stats refresh; the pages' ranges and the ads feed lag until the next run`, { siteId: site.id });
    } else {
      try {
        const stats = await refreshVillageStatsOnWix(site, { deadline: opts.deadline });
        run.counts.wix_requests += stats.requests;
        run.counts.stats_refreshed = !stats.remaining;
        if (stats.failed || stats.remaining) {
          run.event("warn", "stats_failed", `${site.name}: neighborhood stats: ${stats.written} of ${stats.changed} changed row(s) written${stats.failed ? `, ${stats.failed} rejected` : ""}${stats.remaining ? ", the rest wait for the next run" : ""}`, {
            siteId: site.id, details: stats,
          });
        }
      } catch (error) {
        run.counts.stats_refreshed = false;
        run.event("error", "stats_failed", `${site.name}: neighborhood stats not written to Wix: ${errorMessage(error)}`, { siteId: site.id });
      }
    }
  }
}

/** Exported for tests: the record and fingerprint a site would write for one listing. */
export function planRecord(listing: LsListingRow, village: VillageWithTerms, gallery: GalleryItem[], pulledAt: Date): { record: WixItemData; fingerprint: string } {
  const record = buildListingRecord({ listing, village, gallery, pulledAt });
  return { record, fingerprint: recordFingerprint(record) };
}
