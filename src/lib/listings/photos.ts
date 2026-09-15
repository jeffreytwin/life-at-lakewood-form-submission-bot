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
import { importMediaFromUrl } from "@/lib/wix/client";
import { MlsGridClient, MlsGridError } from "@/lib/listings/mlsgrid";
import { normalizeMedia } from "@/lib/listings/normalize";
import * as db from "@/lib/listings/db";
import { startRun, type RunHandle } from "@/lib/listings/runs";
import type { LsListingMediaInput, LsSite, RunTrigger } from "@/lib/listings/types";

export const PHOTOS_BUCKET = "photos";
export const STORAGE_PREFIX = "listings";
/** A signed MediaURL is good for an hour from retrieval; it is used only while comfortably inside that. */
export const FRESH_URL_MS = 50 * 60_000;
/** The media host allows one download per photo per hour, so a failure waits that long. */
export const RETRY_AFTER_MS = 65 * 60_000;
/** A Wix import that failed is retried after this long. */
export const IMPORT_RETRY_MS = 30 * 60_000;
/** After this many failed downloads a photo waits a day between attempts. */
export const MAX_DOWNLOAD_ATTEMPTS = 6;
export const LONG_RETRY_MS = 24 * 3600_000;
/** A listing MLSGrid no longer returns is left to the nightly verify; its photos wait this long. */
export const NOT_RETURNED_RETRY_MS = 6 * 3600_000;
/** 2 requests/s is the MLSGrid cap; downloads go one at a time with this gap. */
export const DOWNLOAD_SPACING_MS = 500;
/** Wix documents 200 requests/minute; imports go one at a time with this gap. */
export const IMPORT_SPACING_MS = 320;
/** Listings per backlog page; the job keeps paging while time remains. */
export const BACKLOG_LISTINGS = 60;
/** On a shadow-mode site the Velo pipeline gets this long to fetch a new photo before the engine does. */
export const SHADOW_GRACE_MINUTES = 90;
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
  importToWix: (wixSiteId: string, url: string, displayName: string) => Promise<{ id: string }>;
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

export const emptyPhotoSummary = (): PhotoSummary => ({ listings: 0, refreshed: 0, downloaded: 0, reused: 0, imported: 0, failed: 0, truncated: false });

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
    importToWix: (wixSiteId, url, displayName) => importMediaFromUrl(wixSiteId, url, displayName),
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

interface DownloadOutcome {
  ok: boolean;
  error?: string;
  retryAt?: number;
}

async function downloadOne(m: db.PhotoBacklogRow, url: string, deps: PhotoDeps, summary: PhotoSummary, run: RunHandle): Promise<DownloadOutcome> {
  const attempt = m.download_attempts + 1;
  const at = deps.now();
  try {
    const res = await deps.download(url);
    if (res.status !== 200 || !res.bytes || !res.bytes.byteLength) {
      throw new Error(`HTTP ${res.status}${res.status === 429 ? " (the media host allows one download per photo per hour)" : ""}`);
    }
    if (res.contentType && !res.contentType.toLowerCase().startsWith("image/")) throw new Error(`unexpected content type ${res.contentType}`);
    const hash = createHash("sha256").update(res.bytes).digest("hex");
    let storagePath = await db.findStoredByHash(hash);
    if (storagePath) summary.reused += 1;
    else {
      storagePath = storagePathFor(m.path_key);
      await deps.store(storagePath, res.bytes, res.contentType ?? contentTypeFor(m.path_key));
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
    const retryAt = at + (attempt >= MAX_DOWNLOAD_ATTEMPTS ? LONG_RETRY_MS : RETRY_AFTER_MS);
    await db.updateListingMedia(m.media_id, {
      download_attempts: attempt,
      last_attempt_at: iso(at),
      retry_after: iso(retryAt),
      last_error: message.slice(0, 500),
    });
    m.retry_after = iso(retryAt);
    summary.failed += 1;
    run.counts.images_failed += 1;
    return { ok: false, error: message, retryAt };
  }
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
  let client: MlsGridClient | null = opts.client ?? null;
  const overdue = (): boolean => deps.now() > opts.deadline;

  async function processListing(listingId: string, media: db.PhotoBacklogRow[], urls: Map<string, string> | undefined): Promise<boolean> {
    let truncated = false;
    const downloads = { failed: 0, lastError: "", retryAt: 0 };
    const importedMedia = new Map<string, Set<string>>();
    const importErrors = new Map<string, string>();
    try {
      for (const m of media) {
        const at = deps.now();
        if (!needsDownload(m, at)) continue;
        const url = hasFreshUrl(m, at) ? m.source_url : (urls?.get(m.path_key) ?? null);
        if (!url) continue; // no fresh URL this pass, or the re-read no longer lists the photo
        if (overdue()) {
          truncated = true;
          return truncated;
        }
        const outcome = await downloadOne(m, url, deps, summary, run);
        if (!outcome.ok) {
          downloads.failed += 1;
          downloads.lastError = outcome.error ?? "";
          downloads.retryAt = outcome.retryAt ?? 0;
        }
        await deps.sleep(DOWNLOAD_SPACING_MS);
      }
      for (const m of media) {
        if (!needsImport(m, deps.now())) continue;
        for (const siteId of m.site_ids) {
          const site = sites.get(siteId);
          if (!site?.wix_site_id || !m.storage_path) continue;
          if (overdue()) {
            truncated = true;
            return truncated;
          }
          const name = displayNameFor(listingId, m.position, m.path_key);
          try {
            const file = await deps.importToWix(site.wix_site_id, deps.publicUrl(m.storage_path), name);
            const uri = `wix:image://v1/${file.id}/${encodeURIComponent(name)}`;
            await db.upsertSiteMedia([{ site_id: siteId, media_id: m.media_id, wix_file_id: file.id, wix_image_uri: uri, origin: "imported" }]);
            const done = importedMedia.get(siteId) ?? new Set<string>();
            done.add(m.media_id);
            importedMedia.set(siteId, done);
            summary.imported += 1;
            run.counts.images_imported += 1;
          } catch (error) {
            const message = errorMessage(error);
            importErrors.set(siteId, message);
            summary.failed += 1;
            run.counts.images_failed += 1;
            await db.updateListingMedia(m.media_id, {
              last_error: `import to ${site.name}: ${message}`.slice(0, 500),
              last_attempt_at: iso(deps.now()),
              retry_after: iso(deps.now() + IMPORT_RETRY_MS),
            });
          }
          await deps.sleep(IMPORT_SPACING_MS);
        }
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
        run.event("error", "photos_failed", `${sites.get(siteId)?.name ?? siteId}: importing photos for ${listingId} failed: ${message}`, { siteId, listingId });
      }
      if (downloads.failed) {
        run.event("warn", "photos_failed", `${listingId}: ${downloads.failed} of ${total} photo download(s) failed (${downloads.lastError}); next attempt after ${iso(downloads.retryAt)}`, {
          listingId,
          details: { retryAfter: iso(downloads.retryAt) },
        });
      }
    }
    return truncated;
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
  if (!probe.length) return { ...emptyPhotoSummary(), runKey: null, status: "skipped" };
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
