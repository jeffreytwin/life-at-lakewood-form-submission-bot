// The photo job (plan decision 4, sequence step 3). MLSGrid serves every
// photo through a signed URL that lives an hour and allows one download, and
// asks consumers to keep their own copy, so a photo is downloaded from
// MLSGrid once, stored once in Supabase Storage, and imported into each
// site's Media Manager from that stored copy. The backlog is whatever the
// sites still lack (db.loadPhotoBacklog); a listing whose stored URLs are no
// longer fresh is re-read from MLSGrid just before its downloads; a failed
// download waits an hour before the next attempt. The job runs inside a
// reconcile (between classify and write, on a budget) and on its own on
// idle ticks, so a backlog drains at the caps without holding up writes.

import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/shared/errors";
import { findMediaFolder, importMediaFromUrl, listMediaFiles, mediaState, WixApiError, WIX_MEDIA_ROOT, type ListMediaFilesOptions, type ListMediaFilesResult } from "@/lib/wix/client";
import { MlsGridClient, MlsGridError } from "@/lib/listings/mlsgrid";
import { normalizeMedia } from "@/lib/listings/normalize";
import * as db from "@/lib/listings/db";
import { startRun, type RunHandle } from "@/lib/listings/runs";
import { wixImageUri } from "@/lib/listings/types";
import type { LsListingMediaInput, LsSite, RunTrigger } from "@/lib/listings/types";

export const PHOTOS_BUCKET = "photos";
export const STORAGE_PREFIX = "listings";
/** A signed MediaURL is good for an hour from retrieval; it is used only while comfortably inside that. */
export const FRESH_URL_MS = 50 * 60_000;
/** The media host allows one download per photo per hour, so a failure waits that long. */
export const RETRY_AFTER_MS = 65 * 60_000;
/** A Wix import that failed is retried after this long. */
export const IMPORT_RETRY_MS = 30 * 60_000;
/**
 * A storage write that failed for a reason of ours -- the Supabase pool
 * under a heavy pass, "Too many connections issued to the database" -- is
 * retried in place with the bytes already in hand, rather than throwing the
 * download away and waiting out the media host's hour for a second copy of
 * what we are already holding. Seconds, not an hour.
 */
export const STORE_RETRY_MS = 2_000;
export const STORE_RETRIES = 3;
/** After this many failed downloads a photo waits a day between attempts. */
export const MAX_DOWNLOAD_ATTEMPTS = 6;
export const LONG_RETRY_MS = 24 * 3600_000;
/** A listing MLSGrid no longer returns is left to the nightly verify; its photos wait this long. */
export const NOT_RETURNED_RETRY_MS = 6 * 3600_000;
/** 2 requests/s is the MLSGrid cap; downloads go one at a time with this gap. */
/**
 * How many photos are in flight at once. The media host's documented limit
 * is one download per photo per hour, not a cap on how many different
 * photos are fetched at a time, so the spacing below is politeness rather
 * than a quota; the transfers themselves are what the wall clock is spent
 * on. Jeff, 2026-09-16: Parrish's 13,000-photo backlog was 33 hours of
 * one-at-a-time work, so each worker keeps its own spacing and four run
 * side by side.
 */
export const DOWNLOAD_CONCURRENCY = 4;
// Four at a time earned a wall of 429s from Wix on the evening of 2026-09-16
// (256 refusals in an hour, ~1,000 per pass at the worst). Two keeps the work
// moving without Wix pushing back; a pass that is told to slow down anyway
// stands down for that location rather than arguing.
export const IMPORT_CONCURRENCY = 2;
export const DOWNLOAD_SPACING_MS = 500;
/**
 * Wix documents 200 requests/minute. Each worker keeps this gap of its own,
 * so the rate across the pool is IMPORT_CONCURRENCY / IMPORT_SPACING_MS: at
 * 600 ms and two workers that is 200/min, the whole allowance and no more.
 *
 * It was 320 ms, which is the right gap for ONE worker and was set when
 * there was one. Two workers at that gap ask for 375/min, and Wix refused
 * about one import in three around the clock (2026-09-17: 60 imported and
 * ~32 refused every five-minute tick on Parrish). Going slower per request
 * is what makes the pass go faster, because a refused request costs a
 * round trip and imports nothing.
 */
export const IMPORT_SPACING_MS = 600;
/** A 429 that carries no Retry-After: how long to wait before offering the photo again. */
export const RATE_LIMIT_WAIT_MS = 5_000;
/** The longest one refusal is allowed to hold a worker, whatever Retry-After asks for. */
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;
/** Times one photo is re-offered after a refusal before its site stands down for the pass. */
export const RATE_LIMIT_RETRIES = 2;
/**
 * How long Wix gets to fetch a picture before the engine goes looking for
 * it. Its URL import is asynchronous, so a photo is PENDING for a while by
 * design; checking sooner would just find that and cost a folder listing.
 */
export const VERIFY_AFTER_MS = 10 * 60_000;
/** Unverified photos examined per site per pass. */
export const VERIFY_BATCH = 500;
/**
 * Folder pages one pass reads. The scan resumes from where it stopped, so a
 * folder larger than this is covered across passes rather than in one, and
 * no single pass can spend the whole Wix budget on looking.
 */
export const VERIFY_SCAN_PAGES = 20;
/**
 * How long a photo may sit unconfirmed before it is given up on and imported
 * again. Wix reports some files as neither ready nor failed -- an id with no
 * media behind it, which mediaState calls "unknown" -- and such a photo would
 * otherwise be neither shown nor retried, for ever.
 */
export const VERIFY_GIVE_UP_MS = 6 * 3600_000;
/** Listings per backlog page; the job keeps paging while time remains. */
export const BACKLOG_LISTINGS = 60;
/** On a shadow-mode site the Velo pipeline gets this long to fetch a new photo before the engine does. */
export const SHADOW_GRACE_MINUTES = 90;
/** A Media Manager folder lookup that takes longer than this is treated as failed; the site's imports wait for the next pass. */
export const FOLDER_LOOKUP_TIMEOUT_MS = 20_000;

/** Rejects when `work` has not settled within `ms`; the underlying request is abandoned, not cancelled. */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface DownloadResult {
  status: number;
  bytes: Uint8Array | null;
  contentType: string | null;
}

/** The job's IO, injectable for tests. */
export interface PhotoDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  download: (url: string) => Promise<DownloadResult>;
  store: (storagePath: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  publicUrl: (storagePath: string) => string;
  importToWix: (wixSiteId: string, url: string, displayName: string, parentFolderId: string | null) => Promise<{ id: string }>;
  /** The id of a site's root-level Media Manager folder by name, or null when there is none. */
  findFolder: (wixSiteId: string, displayName: string) => Promise<string | null>;
  /** The files in a folder, for confirming Wix holds a picture for an import. */
  listFiles: (wixSiteId: string, parentFolderId: string, options?: ListMediaFilesOptions) => Promise<ListMediaFilesResult>;
  /** Remembers a resolved folder id on the site row. */
  cacheFolder: (siteId: string, folderId: string) => Promise<void>;
}

export interface PhotoSummary {
  /** Listings the pass worked on. */
  listings: number;
  /** Listings re-read from MLSGrid for fresh URLs. */
  refreshed: number;
  downloaded: number;
  /** Downloads whose bytes were already stored under another photo. */
  reused: number;
  imported: number;
  failed: number;
  /** Imports Wix has since been seen holding a picture for; they may now be shown. */
  verified: number;
  /** Imports Wix never fetched; dropped so they are imported again, and never shown. */
  unverified: number;
  /** Storage writes that failed and were retried in place rather than costing the photo an hour. */
  storeRetries: number;
  /** True when the deadline stopped the job with work left. */
  truncated: boolean;
}

export interface PhotoJobOptions {
  run: RunHandle;
  /** Epoch ms; no new download or import starts past it. */
  deadline: number;
  sites?: LsSite[];
  client?: MlsGridClient;
  deps?: Partial<PhotoDeps>;
  maxListings?: number;
  shadowGraceMinutes?: number;
}

export const emptyPhotoSummary = (): PhotoSummary => ({ listings: 0, refreshed: 0, downloaded: 0, reused: 0, imported: 0, failed: 0, verified: 0, unverified: 0, storeRetries: 0, truncated: false });

function defaultDeps(): PhotoDeps {
  return {
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async download(url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { accept: "image/*" } });
        const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        return { status: res.status, bytes, contentType: res.headers.get("content-type") };
      } finally {
        clearTimeout(timer);
      }
    },
    async store(storagePath, bytes, contentType) {
      const { error } = await supabase.storage.from(PHOTOS_BUCKET).upload(storagePath, Buffer.from(bytes), { contentType, upsert: true });
      if (error) throw new Error(`storage upload: ${error.message}`);
    },
    publicUrl: (storagePath) => supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(storagePath).data.publicUrl,
    importToWix: (wixSiteId, url, displayName, parentFolderId) => importMediaFromUrl(wixSiteId, url, displayName, parentFolderId),
    findFolder: async (wixSiteId, displayName) => (await findMediaFolder(wixSiteId, displayName))?.id ?? null,
    listFiles: (wixSiteId, parentFolderId, options) => listMediaFiles(wixSiteId, parentFolderId, options),
    cacheFolder: (siteId, folderId) => db.setSiteMediaFolderId(siteId, folderId),
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();
const notBefore = (m: db.PhotoBacklogRow, now: number): boolean => !m.retry_after || Date.parse(m.retry_after) <= now;
/** Downloaded only when some site lacks the photo: a seeded photo the site already serves is never fetched again. */
const needsDownload = (m: db.PhotoBacklogRow, now: number): boolean => !m.storage_path && m.site_ids.length > 0 && notBefore(m, now);
const needsImport = (m: db.PhotoBacklogRow, now: number): boolean => !!m.storage_path && m.site_ids.length > 0 && notBefore(m, now);

/** Whether the signed URL on the row can still be used (retrieved under FRESH_URL_MS ago). */
export function hasFreshUrl(m: Pick<db.PhotoBacklogRow, "source_url" | "source_url_received_at">, now: number): boolean {
  if (!m.source_url || !m.source_url_received_at) return false;
  const received = Date.parse(m.source_url_received_at);
  return Number.isFinite(received) && now - received < FRESH_URL_MS;
}

export const storagePathFor = (pathKey: string): string => `${STORAGE_PREFIX}/${pathKey}`;

/** The file extension of a path key's last segment, lowercased; null without one. */
function extensionOf(pathKey: string): string | null {
  const last = pathKey.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 && dot < last.length - 1 ? last.slice(dot + 1).toLowerCase() : null;
}

export function contentTypeFor(pathKey: string): string {
  const ext = extensionOf(pathKey);
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

/** The Media Manager file name: "<ListingId>-<position>.<ext>". */
export function displayNameFor(listingId: string, position: number, pathKey: string): string {
  return `${listingId}-${position}.${extensionOf(pathKey) ?? "jpg"}`;
}

type FolderResult = { ok: true; id: string | null } | { ok: false };

interface DownloadOutcome {
  ok: boolean;
  error?: string;
  retryAt?: number;
  /** The photo has now failed MAX_DOWNLOAD_ATTEMPTS times and waits a day between tries. */
  exhausted?: boolean;
}

async function downloadOne(m: db.PhotoBacklogRow, url: string, deps: PhotoDeps, summary: PhotoSummary, run: RunHandle): Promise<DownloadOutcome> {
  const attempt = m.download_attempts + 1;
  const at = deps.now();
  // Set once the bytes have arrived: from there a failure is not the
  // photo's, and must not spend one of its attempts (see below).
  let spent = false;
  try {
    const res = await deps.download(url);
    if (res.status !== 200 || !res.bytes || !res.bytes.byteLength) {
      throw new Error(`HTTP ${res.status}${res.status === 429 ? " (the media host allows one download per photo per hour)" : ""}`);
    }
    if (res.contentType && !res.contentType.toLowerCase().startsWith("image/")) throw new Error(`unexpected content type ${res.contentType}`);
    const hash = createHash("sha256").update(res.bytes).digest("hex");
    // The bytes are here, so the photo's one download for this hour is spent
    // whatever happens next. A failure from here on is ours -- the storage
    // write or the row that records it -- so it is worth another go straight
    // away instead of costing the photo an hour and an attempt.
    spent = true;
    let storagePath: string | null = null;
    for (let tries = 0; ; tries += 1) {
      try {
        storagePath = await db.findStoredByHash(hash);
        if (storagePath) summary.reused += 1;
        else {
          storagePath = storagePathFor(m.path_key);
          await deps.store(storagePath, res.bytes, res.contentType ?? contentTypeFor(m.path_key));
        }
        break;
      } catch (error) {
        if (tries >= STORE_RETRIES) throw error;
        summary.storeRetries += 1;
        await deps.sleep(STORE_RETRY_MS * (tries + 1));
      }
    }
    await db.updateListingMedia(m.media_id, {
      storage_path: storagePath,
      content_hash: hash,
      byte_size: res.bytes.byteLength,
      source_url: null, // spent: one download per URL, and MLSGrid asks that it never be kept
      download_attempts: attempt,
      last_attempt_at: iso(at),
      retry_after: null,
      last_error: null,
    });
    m.storage_path = storagePath;
    m.retry_after = null;
    summary.downloaded += 1;
    run.counts.images_downloaded += 1;
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    // A storage failure that outlived its retries leaves the photo waiting
    // the media host's hour all the same -- its download is spent and only a
    // fresh one can replace it -- but it does not count against the six
    // attempts that drop a photo to a daily retry. Those are for a photo the
    // MLS will not give us; this one it gave us, and we dropped it.
    const attempts = spent ? m.download_attempts : attempt;
    const retryAt = at + (attempts >= MAX_DOWNLOAD_ATTEMPTS ? LONG_RETRY_MS : RETRY_AFTER_MS);
    await db.updateListingMedia(m.media_id, {
      download_attempts: attempts,
      last_attempt_at: iso(at),
      retry_after: iso(retryAt),
      last_error: message.slice(0, 500),
    });
    m.retry_after = iso(retryAt);
    summary.failed += 1;
    run.counts.images_failed += 1;
    return { ok: false, error: message, retryAt, exhausted: attempts >= MAX_DOWNLOAD_ATTEMPTS };
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight. Work is handed
 * out in order; nothing new starts once `stop()` is true. Returns true when
 * it stopped early, so the caller can mark the pass truncated.
 *
 * Each worker keeps its own spacing, so the rate across the pool is the
 * per-worker rate times `limit`.
 */
export async function pool<T>(
  items: T[],
  limit: number,
  stop: () => boolean,
  worker: (item: T) => Promise<void>
): Promise<boolean> {
  let next = 0;
  let stopped = false;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (stop()) {
        stopped = true;
        return;
      }
      // Single-threaded: taking an index needs no lock.
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return stopped;
}

/**
 * Works the photo backlog until it is empty or the deadline passes: fresh
 * URLs where needed, then downloads, then each site's imports, listing by
 * listing so a listing that completes is flagged for its write at once.
 */
export async function runPhotoJob(opts: PhotoJobOptions): Promise<PhotoSummary> {
  const deps: PhotoDeps = { ...defaultDeps(), ...opts.deps };
  const { run } = opts;
  const summary = emptyPhotoSummary();
  const sites = new Map((opts.sites ?? (await db.loadActiveSites())).map((s) => [s.id, s]));
  const handled = new Set<string>();
  // Where a site's imports go: null = Wix's default location, a string = the
  // folder named on the site row, resolved once per site and cached on the
  // row. A named folder that cannot be found holds the site's imports (one
  // error per pass) rather than scattering photos outside it.
  // One lookup per site per pass, held as a promise so the concurrent
  // importers below share it instead of each asking Wix for the folder.
  const folderLookups = new Map<string, Promise<FolderResult>>();
  async function folderFor(site: LsSite): Promise<FolderResult> {
    if (!site.media_folder_name) return { ok: true, id: null };
    if (site.media_folder_id) return { ok: true, id: site.media_folder_id };
    const started = folderLookups.get(site.id);
    if (started) return started;
    const lookup = lookUpFolder(site, site.media_folder_name);
    folderLookups.set(site.id, lookup);
    return lookup;
  }
  async function lookUpFolder(site: LsSite, folderName: string): Promise<FolderResult> {
    try {
      const id = await withTimeout(deps.findFolder(site.wix_site_id!, folderName), FOLDER_LOOKUP_TIMEOUT_MS, `Media Manager folder lookup for ${site.name}`);
      if (id) {
        await deps.cacheFolder(site.id, id);
        return { ok: true, id };
      }
      run.event("error", "folder_missing", `${site.name}: Media Manager folder "${site.media_folder_name}" not found among the root folders; its photos wait until it exists`, { siteId: site.id });
    } catch (error) {
      run.event("warn", "folder_missing", `${site.name}: could not look up Media Manager folder "${site.media_folder_name}" (${errorMessage(error)}); its photos wait for the next pass`, { siteId: site.id });
    }
    return { ok: false };
  }
  let client: MlsGridClient | null = opts.client ?? null;
  const overdue = (): boolean => deps.now() > opts.deadline;

  /**
   * Which of the site's imports Wix actually holds a picture for.
   *
   * Wix's URL import is asynchronous, so a file id coming back means only
   * that the URL was accepted. Until this has seen a picture the photo has
   * no verified_at and is kept out of every gallery, which is what makes
   * "never show a broken photo" true by construction rather than by
   * cleanup. A file Wix has given up on (FAILED, or READY with no image) is
   * forgotten here so the next pass imports it again; one still PENDING is
   * left for the next pass.
   *
   * The folder listing is the bulk read -- one request per hundred files,
   * against one per file -- and it runs only when something has been
   * waiting longer than VERIFY_AFTER_MS, so a photo imported moments ago
   * does not trigger a walk of the whole folder to be told it is pending.
   */
  async function verifyImportedPhotos(site: LsSite): Promise<void> {
    if (!site.wix_site_id) return;
    let waiting: db.UnverifiedSiteMedia[];
    try {
      waiting = await db.loadUnverifiedSiteMedia(site.id, VERIFY_BATCH);
    } catch (error) {
      run.event("warn", "photos_broken", `${site.name}: could not read the photos waiting on Wix (${errorMessage(error)}); the next pass tries again`, { siteId: site.id });
      return;
    }
    if (!waiting.length) return;
    // Nothing has been waiting long enough to be worth a folder listing:
    // Wix is still within its normal fetch window for all of them.
    const oldest = Date.parse(waiting[0].imported_at);
    if (Number.isFinite(oldest) && deps.now() - oldest < VERIFY_AFTER_MS) return;

    const folder = await folderFor(site);
    if (!folder.ok) return;
    // Resume where the last scan stopped. Without this the listing restarts
    // at the top every pass, which during a backfill is a walk of the whole
    // folder every five minutes -- growing with the folder, and spending the
    // account-wide Wix budget the imports need (migration 054).
    const listing = await deps.listFiles(site.wix_site_id, folder.id ?? WIX_MEDIA_ROOT, {
      deadline: opts.deadline,
      startOffset: site.media_scan_offset,
      maxPages: VERIFY_SCAN_PAGES,
    });
    await db.setSiteMediaScanOffset(site.id, listing.nextOffset);
    const byId = new Map(listing.files.map((f) => [f.id, f]));

    const verified: string[] = [];
    const dead: string[] = [];
    let pending = 0;
    for (const row of waiting) {
      const file = row.wix_file_id ? byId.get(row.wix_file_id) : undefined;
      // Not in the listing at all: it may be on a page the deadline cut
      // short, so it keeps waiting rather than being called broken.
      if (!file) continue;
      const state = mediaState(file);
      if (state === "ready") {
        verified.push(row.id);
        continue;
      }
      if (state === "broken") {
        dead.push(row.id);
        continue;
      }
      // Still pending, or one of Wix's ids with nothing behind it. Give it a
      // while, then import it again rather than leave a photo that will
      // never be shown and never be retried.
      const waitedFor = deps.now() - Date.parse(row.imported_at);
      if (Number.isFinite(waitedFor) && waitedFor > VERIFY_GIVE_UP_MS) dead.push(row.id);
      else pending += 1;
    }

    if (verified.length) {
      await db.markSiteMediaVerified(verified, new Date(deps.now()));
      summary.verified += verified.length;
    }
    if (dead.length) {
      const listings = await db.dropSiteMedia(dead);
      summary.unverified += dead.length;
      if (listings.length) {
        await db.upsertSiteListings(listings.map((listing_id) => ({ site_id: site.id, listing_id, needs_write: true, gallery_ready: false })));
      }
      run.event("warn", "photos_broken", `${site.name}: Wix never fetched ${dead.length} photo(s) it accepted; they are out of the galleries and will be imported again across ${listings.length} listing(s)`, {
        siteId: site.id,
        details: { dropped: dead.length, listings: listings.length },
      });
    }
    if (listing.truncated && pending) {
      run.event("info", "photos_broken", `${site.name}: ${pending} photo(s) still waiting on Wix and the folder listing did not finish; the next pass continues`, { siteId: site.id });
    }
  }

  // Sites Wix has told to slow down, and would not stop telling: their
  // imports stop for the rest of the pass. This used to live inside
  // processListing, so it reset on every listing and each one re-tested Wix,
  // collected a refusal and abandoned its remaining photos -- which is how a
  // pass with a four-minute budget finished in thirty seconds having
  // imported sixty photos.
  const slowDown = new Map<string, string>();

  /** How long a refusal asks the engine to wait, bounded so one cannot eat the pass. */
  function rateLimitWait(error: WixApiError): number {
    const asked = error.retryAfterSeconds != null ? error.retryAfterSeconds * 1000 : RATE_LIMIT_WAIT_MS;
    return Math.min(Math.max(asked, IMPORT_SPACING_MS), RATE_LIMIT_MAX_WAIT_MS);
  }

  /**
   * A site Wix will not stop refusing: no more imports for it this pass, said
   * once as a warning. Never an error -- there is nothing for a person to do
   * about a rate limit, and the photos stay due with no cool-down, so the
   * next pass picks them straight up.
   */
  function standDown(site: LsSite, message: string): void {
    if (slowDown.has(site.id)) return;
    slowDown.set(site.id, message);
    run.event("warn", "rate_limited", `${site.name}: Wix kept asking the engine to slow down (${message}); its remaining photos wait for the next pass`, { siteId: site.id });
  }

  async function processListing(listingId: string, media: db.PhotoBacklogRow[], urls: Map<string, string> | undefined): Promise<boolean> {
    let truncated = false;
    const downloads = { failed: 0, exhausted: 0, lastError: "", retryAt: 0 };
    const missingDimensions = new Set<string>();
    const importedMedia = new Map<string, Set<string>>();
    const importErrors = new Map<string, string>();
    try {
      const pendingDownloads: Array<{ m: db.PhotoBacklogRow; url: string }> = [];
      for (const m of media) {
        const at = deps.now();
        if (!needsDownload(m, at)) continue;
        const url = hasFreshUrl(m, at) ? m.source_url : (urls?.get(m.path_key) ?? null);
        if (!url) continue; // no fresh URL this pass, or the re-read no longer lists the photo
        pendingDownloads.push({ m, url });
      }
      if (await pool(pendingDownloads, DOWNLOAD_CONCURRENCY, overdue, async ({ m, url }) => {
        const outcome = await downloadOne(m, url, deps, summary, run);
        if (!outcome.ok) {
          downloads.failed += 1;
          downloads.lastError = outcome.error ?? "";
          downloads.retryAt = outcome.retryAt ?? 0;
          if (outcome.exhausted) downloads.exhausted += 1;
        }
        await deps.sleep(DOWNLOAD_SPACING_MS);
      })) {
        // Out of time mid-listing: its imports wait for the next pass, same as before.
        truncated = true;
        return truncated;
      }
      const pendingImports: Array<{ m: db.PhotoBacklogRow; site: LsSite }> = [];
      for (const m of media) {
        if (!needsImport(m, deps.now())) continue;
        if (!m.storage_path) continue;
        for (const siteId of m.site_ids) {
          const site = sites.get(siteId);
          if (!site?.wix_site_id) continue;
          pendingImports.push({ m, site });
        }
      }
      if (await pool(pendingImports, IMPORT_CONCURRENCY, overdue, async ({ m, site }) => {
        // Without the MLS dimensions the URI would be one Wix cannot render, so the
        // photo waits for a re-read rather than writing a gallery nothing can show.
        if (!m.image_width || !m.image_height) {
          missingDimensions.add(m.media_id);
          return;
        }
        if (slowDown.has(site.id)) return;
        const folder = await folderFor(site);
        if (!folder.ok) return;
        const name = displayNameFor(listingId, m.position, m.path_key);
        // A refusal is Wix asking for less, not a fault in the photo: wait as
        // long as it asks and offer the same photo again. Only when it keeps
        // refusing, or the wait would run past the deadline, does the site
        // stand down -- skipping straight on would leave the photo for a later
        // pass that is no likelier to be welcome.
        for (let attempt = 0; ; attempt += 1) {
          try {
            const file = await deps.importToWix(site.wix_site_id!, deps.publicUrl(m.storage_path!), name, folder.id);
            const uri = wixImageUri(file.id, name, m.image_width, m.image_height);
            if (!uri) {
              missingDimensions.add(m.media_id);
              return;
            }
            // verified_at stays null: Wix has the URL, not necessarily the
          // picture. verifyImportedPhotos decides, and until it does this
          // photo is not in any gallery (migration 053).
          await db.upsertSiteMedia([{ site_id: site.id, media_id: m.media_id, wix_file_id: file.id, wix_image_uri: uri, origin: "imported", verified_at: null }]);
            // No await between these three, so the concurrent workers cannot lose one another's entries.
            const done = importedMedia.get(site.id) ?? new Set<string>();
            done.add(m.media_id);
            importedMedia.set(site.id, done);
            summary.imported += 1;
            run.counts.images_imported += 1;
            break;
          } catch (error) {
            const message = errorMessage(error);
            if (error instanceof WixApiError && error.rateLimited) {
              run.counts.wix_rate_limited += 1;
              const waitMs = rateLimitWait(error);
              if (attempt >= RATE_LIMIT_RETRIES || deps.now() + waitMs > opts.deadline || slowDown.has(site.id)) {
                standDown(site, message);
                return;
              }
              await deps.sleep(waitMs);
              continue;
            }
            importErrors.set(site.id, message);
            summary.failed += 1;
            run.counts.images_failed += 1;
            await db.updateListingMedia(m.media_id, {
              last_error: `import to ${site.name}: ${message}`.slice(0, 500),
              last_attempt_at: iso(deps.now()),
              retry_after: iso(deps.now() + IMPORT_RETRY_MS),
            });
            return;
          }
        }
        await deps.sleep(IMPORT_SPACING_MS);
      })) {
        truncated = true;
      }
    } finally {
      // Whatever was imported is flagged for the site's next write, even when the deadline cut the listing short.
      if (importedMedia.size) {
        await db.upsertSiteListings([...importedMedia.keys()].map((site_id) => ({ site_id, listing_id: listingId, needs_write: true })));
      }
      const total = media.length;
      for (const [siteId, done] of importedMedia) {
        const site = sites.get(siteId);
        const pending = media.filter((m) => !m.storage_path || (m.site_ids.includes(siteId) && !done.has(m.media_id))).length;
        run.event(
          "info",
          "photos",
          `${site?.name ?? siteId}: ${done.size} photo(s) imported for ${listingId}${pending ? ` (${pending} of ${total} still pending)` : ` (gallery complete, ${total} photo${total === 1 ? "" : "s"})`}`,
          { siteId, listingId }
        );
      }
      for (const [siteId, message] of importErrors) {
        run.event("warn", "import_failed", `${sites.get(siteId)?.name ?? siteId}: importing photos for ${listingId} failed: ${message}; retried in ${Math.round(IMPORT_RETRY_MS / 60_000)} min`, { siteId, listingId });
      }
      if (missingDimensions.size) {
        await db.coolDownListingMedia(listingId, new Date(deps.now() + NOT_RETURNED_RETRY_MS), "MLSGrid did not give the photo's dimensions");
        run.event("warn", "import_failed", `${listingId}: ${missingDimensions.size} photo(s) have no dimensions in the MLS record, so Wix could not be given a usable image; waiting for the next re-read`, {
          listingId,
          details: { mediaIds: [...missingDimensions].slice(0, 20) },
        });
      }
      if (downloads.failed) {
        // A download that keeps failing is retried hourly on its own; only a photo that has used up
        // its hourly attempts (a dead or changed URL, most likely) is worth a person's attention.
        const gaveUp = downloads.exhausted > 0;
        const tail = gaveUp
          ? `${downloads.exhausted} photo(s) failed ${MAX_DOWNLOAD_ATTEMPTS} times and now retry daily; check the listing's photos in the MLS`
          : `next attempt after ${iso(downloads.retryAt)}`;
        run.event(gaveUp ? "error" : "warn", "download_failed", `${listingId}: ${downloads.failed} of ${total} photo download(s) failed (${downloads.lastError}); ${tail}`, {
          listingId,
          details: { retryAfter: iso(downloads.retryAt), exhausted: downloads.exhausted },
        });
      }
    }
    return truncated;
  }

  // Before anything else: settle what Wix did with the last pass's imports,
  // so a photo it never fetched leaves the galleries rather than sitting in
  // one. Cheap when there is nothing waiting.
  for (const site of sites.values()) {
    if (overdue()) break;
    try {
      await verifyImportedPhotos(site);
    } catch (error) {
      run.event("warn", "photos_broken", `${site.name}: could not confirm what Wix holds for its imports (${errorMessage(error)}); the next pass tries again`, { siteId: site.id });
    }
  }

  for (;;) {
    if (overdue()) {
      summary.truncated = true;
      break;
    }
    const rows = (await db.loadPhotoBacklog(opts.maxListings ?? BACKLOG_LISTINGS, opts.shadowGraceMinutes ?? SHADOW_GRACE_MINUTES)).filter((r) => !handled.has(r.listing_id));
    if (!rows.length) break;
    const groups = new Map<string, db.PhotoBacklogRow[]>();
    for (const r of rows) {
      const list = groups.get(r.listing_id) ?? [];
      list.push(r);
      groups.set(r.listing_id, list);
    }

    // Fresh URLs for listings whose pending downloads have none: one MLSGrid request per 50 listings.
    const now = deps.now();
    const stale = [...groups].filter(([, media]) => media.some((m) => needsDownload(m, now) && !hasFreshUrl(m, now))).map(([id]) => id);
    const fresh = new Map<string, Map<string, string>>();
    if (stale.length) {
      try {
        client ??= new MlsGridClient();
        const result = await client.fetchByIds(stale, { deadline: opts.deadline });
        const receivedAt = new Date(deps.now());
        const returned = new Set<string>();
        const inputs: LsListingMediaInput[] = [];
        for (const raw of result.items) {
          if (!raw || typeof raw.ListingId !== "string") continue;
          returned.add(raw.ListingId);
          const media = normalizeMedia(raw, receivedAt);
          inputs.push(...media);
          fresh.set(raw.ListingId, new Map(media.filter((m) => m.source_url).map((m) => [m.path_key, m.source_url as string])));
        }
        if (returned.size) await db.replaceListingMedia(inputs, [...returned]);
        summary.refreshed += returned.size;
        for (const id of result.verifiedIds) {
          if (returned.has(id)) continue;
          await db.coolDownListingMedia(id, new Date(deps.now() + NOT_RETURNED_RETRY_MS), "MLSGrid did not return the listing");
          run.event("warn", "photos_failed", `${id}: MLSGrid did not return the listing, so its photos cannot be fetched; the nightly verify decides whether it left the feed`, { listingId: id });
          groups.delete(id);
          handled.add(id);
        }
        if (result.truncated) {
          summary.truncated = true;
          for (const id of stale) if (!returned.has(id)) groups.delete(id);
        }
      } catch (error) {
        run.event("warn", "photos_failed", `Could not re-read ${stale.length} listing(s) from MLSGrid for fresh photo URLs: ${errorMessage(error)}`);
        for (const id of stale) {
          groups.delete(id);
          handled.add(id);
        }
        if (error instanceof MlsGridError && error.rateLimited) {
          summary.truncated = true;
          break;
        }
      }
    }

    let stopped = false;
    for (const [listingId, media] of groups) {
      if (overdue()) {
        stopped = true;
        break;
      }
      handled.add(listingId);
      summary.listings += 1;
      if (await processListing(listingId, media, fresh.get(listingId))) {
        stopped = true;
        break;
      }
    }
    if (stopped) {
      summary.truncated = true;
      break;
    }
  }
  return summary;
}

export interface StandalonePhotoOptions {
  trigger: RunTrigger;
  deadline: number;
  client?: MlsGridClient;
  deps?: Partial<PhotoDeps>;
  maxListings?: number;
  shadowGraceMinutes?: number;
}

export type StandalonePhotoResult = PhotoSummary & { runKey: string | null; status: "ok" | "error" | "skipped"; error?: string };

/** The photo job as its own run (mode photos): what an idle tick does, and what "run photos" starts. */
export async function runStandalonePhotoJob(opts: StandalonePhotoOptions): Promise<StandalonePhotoResult> {
  const grace = opts.shadowGraceMinutes ?? SHADOW_GRACE_MINUTES;
  const probe = await db.loadPhotoBacklog(1, grace);
  if (!probe.length) {
    // An empty import backlog is not an idle engine. Since migration 053 a
    // photo reaches a gallery only once Wix has been seen holding a picture
    // for it, so a listing whose imports all succeeded sits in 'staged' with
    // gallery_ready = false until a verification pass confirms them -- and
    // verification runs at the head of runPhotoJob, which this was skipping.
    // That left it to the hourly reconcile: an hour's wait for work whose
    // clock is ten minutes, in precisely the common case, because the
    // backlog empties the moment the imports finish.
    const sites = await db.loadActiveSites();
    const waiting = await db.countPhotosAwaitingVerification(
      sites.map((s) => s.id),
      new Date(Date.now() - VERIFY_AFTER_MS)
    );
    if (!waiting) return { ...emptyPhotoSummary(), runKey: null, status: "skipped" };
  }
  const run = await startRun({ mode: "photos", trigger: opts.trigger });
  try {
    await run.checkpoint("photos");
    const summary = await runPhotoJob({ run, deadline: opts.deadline, client: opts.client, deps: opts.deps, maxListings: opts.maxListings, shadowGraceMinutes: grace });
    run.stage = summary.truncated ? "truncated" : "done";
    await run.finish("ok");
    return { ...summary, runKey: run.runKey, status: "ok" };
  } catch (error) {
    const message = errorMessage(error);
    await run.finish("error", { stage: "photos", message, stack: error instanceof Error ? error.stack : undefined });
    return { ...emptyPhotoSummary(), runKey: run.runKey, status: "error", error: message };
  }
}
