// Small display helpers shared by the Listings pages.

import { formatDateTimeET } from "@/lib/shared/format-date";

/** Eastern time, like the rest of the Hub. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTimeET(d.toISOString());
}

/** A run mode in the Hub's words: the hourly update, the full verify, or a discovery (stored as incremental / full / discover). */
export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return "?";
  if (mode === "incremental") return "hourly";
  if (mode === "discover") return "discovery";
  return mode;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return fmtDateTime(iso);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function megabytes(bytes: number | null | undefined): string {
  return `${((bytes ?? 0) / 1e6).toFixed(1)} MB`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`;
}

export function levelBadge(level: string): string {
  if (level === "error") return "badge badge-danger";
  if (level === "warn") return "badge badge-warning";
  return "badge badge-muted";
}

export function writeModeBadge(mode: string): { cls: string; label: string } {
  if (mode === "live") return { cls: "badge badge-success", label: "Live" };
  if (mode === "paused") return { cls: "badge badge-muted", label: "Paused" };
  return { cls: "badge badge-info", label: "Shadow" };
}

/** Reads a JSON error body when the response is not ok, else null. */
export async function responseError(res: Response): Promise<string | null> {
  if (res.ok) return null;
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/**
 * The colour each site carries across the Hub: the tints the Email Hub
 * gives the site's inbox (yellow Longboat Key, green Wellen Park, purple
 * Lakewood, teal Parrish), keyed by the site's domain.
 */
const SITE_RGB: Record<string, string> = {
  "lifeinlongboatkey.com": "250, 204, 21", // yellow
  "lifeinwellenpark.com": "52, 211, 153", // green
  "lifeatlakewood.com": "168, 130, 255", // purple
  "lifeatparrish.com": "34, 211, 238", // teal
};

export interface SiteColors {
  /** A very subtle background tint. */
  tint: string;
  /** The left-border accent. */
  accent: string;
  /** The full colour, for the site's name. */
  solid: string;
}

export function siteColors(domain: string | null | undefined): SiteColors | null {
  const rgb = domain ? SITE_RGB[domain.toLowerCase()] : undefined;
  if (!rgb) return null;
  return { tint: `rgba(${rgb}, 0.06)`, accent: `rgba(${rgb}, 0.35)`, solid: `rgb(${rgb})` };
}

/** The Wix CMS page for one of a site's collections; null until the site has a Wix site id. */
export function wixCollectionUrl(wixSiteId: string | null | undefined, collectionId: string): string | null {
  if (!wixSiteId) return null;
  return `https://manage.wix.com/dashboard/${encodeURIComponent(wixSiteId)}/database/data/${encodeURIComponent(collectionId)}`;
}

export function fmtPrice(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** How a run was started, in the Hub's words (the stored values stay cron / hub / manual / http). */
export function triggerLabel(trigger: string): { label: string; title: string } {
  switch (trigger) {
    case "cron":
      return { label: "auto", title: "Started by the schedule: an hourly update, a full verify once a day, and the rest of a discovery" };
    case "hub":
      return { label: "manual", title: "Started from this Hub: Run Hourly, Run Full, Run Discovery, or Apply held removals" };
    case "manual":
      return { label: "build check", title: "Started by the verification script that runs during a Vercel build of the engine branch" };
    case "http":
      return { label: "API", title: "Started by an API call with the admin key" };
    default:
      return { label: trigger, title: "" };
  }
}

export interface RunOutcomeInput {
  status: string;
  writes_failed: number;
  errors: number;
  warnings: number;
  images_failed?: number;
  error_message?: string | null;
}

/**
 * The badge a run gets. The stored status says whether the pass completed
 * (the scheduler's concern); this says whether everything it tried worked.
 */
export function runOutcome(run: RunOutcomeInput): { label: string; cls: string; title: string } {
  if (run.status === "running") return { label: "running", cls: "badge badge-info", title: "Still in progress" };
  if (run.status === "error") {
    return { label: "failed", cls: "badge badge-danger", title: run.error_message ? `Stopped: ${run.error_message}` : "The run stopped before finishing its pass" };
  }
  const imagesFailed = run.images_failed ?? 0;
  if (run.writes_failed > 0 || run.errors > 0 || imagesFailed > 0) {
    const why: string[] = [];
    if (run.writes_failed > 0) why.push(`${run.writes_failed} write(s) failed and are retried on the next run`);
    if (imagesFailed > 0) why.push(`${imagesFailed} photo download(s) or import(s) failed and are retried later`);
    if (run.errors > 0) why.push(`${run.errors} error(s) recorded`);
    return { label: "partial", cls: "badge badge-warning", title: `The run finished its pass, but ${why.join("; ")}` };
  }
  return { label: "ok", cls: "badge badge-success", title: run.warnings > 0 ? `${run.warnings} warning(s), nothing failed` : "Everything the run tried succeeded" };
}

export interface SiteNames {
  name: string;
  domain: string;
  target_collection_id?: string | null;
  live_collection_id?: string | null;
}

/**
 * Entries written before 2026-09-15 name a location by its domain or a Wix
 * collection id; show the location name instead. Whole tokens only, longest
 * first, so HousesforSale never eats HousesforSale2.
 */
export function humanizeMessage(message: string, sites: SiteNames[]): string {
  const tokens = sites
    .flatMap((s) => [s.target_collection_id, s.live_collection_id, s.domain].filter((t): t is string => !!t).map((t) => ({ token: t, name: s.name })))
    .sort((a, b) => b.token.length - a.token.length);
  let out = message;
  for (const { token, name } of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g"), name);
  }
  return out;
}

export interface PlainErrorInput {
  kind: string;
  message: string;
  listing_id?: string | null;
  address?: string | null;
}

export interface PlainError {
  /** One plain sentence: what is wrong. */
  problem: string;
  /** One plain sentence: what the person looking at it should do. */
  nextStep: string;
}

const ASK_ADMIN = "Let the site admin know if it stays here.";

/**
 * The overview's Errors panel is read by people who do not know the
 * engine: one plain sentence for the problem, one for the next step. The
 * full message stays in the Change Log (Details).
 */
export function plainError(e: PlainErrorInput, location: string | null): PlainError {
  const where = location ?? "the site";
  const msg = e.message ?? "";
  const repeated = /not clearing on its own/.test(msg) ? " This has happened several times." : "";
  const quoted = msg.match(/"([^"]+)"/)?.[1];
  const listing = e.address ? "this listing" : e.listing_id ? `listing ${e.listing_id}` : "this listing";

  switch (e.kind) {
    case "download_failed":
      return {
        problem: `Some photos for ${listing} can't be downloaded from the MLS.${repeated}`,
        nextStep: "Check the listing's photos in the MLS. The updater tries again tomorrow.",
      };
    case "import_failed":
    case "photos_failed":
      return {
        problem: `Photos for ${listing} aren't uploading to ${where}.${repeated}`,
        nextStep: `The updater keeps retrying. ${ASK_ADMIN}`,
      };
    case "folder_missing":
      if (/could not look up/.test(msg)) {
        return { problem: `Wix isn't answering when the updater looks for the photo folder on ${where}.${repeated}`, nextStep: `The updater keeps retrying. ${ASK_ADMIN}` };
      }
      return {
        problem: `The photo folder${quoted ? ` "${quoted}"` : ""} is missing on ${where}, so its photos are waiting.`,
        nextStep: "Create that folder in the Wix Media Manager, or ask the site admin to.",
      };
    case "write_failed":
      if (/shadow mode targets the live collection/.test(msg)) {
        return { problem: `${where} is set up wrong: its test collection points at the live one, so nothing was written.`, nextStep: "The site admin needs to fix the location's settings." };
      }
      if (/bulk save/.test(msg)) return { problem: `Listings aren't being saved to ${where}.${repeated}`, nextStep: `Wix isn't accepting saves right now. ${ASK_ADMIN}` };
      if (/bulk remove/.test(msg)) return { problem: `Sold or withdrawn listings aren't being removed from ${where}.${repeated}`, nextStep: `Wix isn't accepting removals right now. ${ASK_ADMIN}` };
      if (/refused to remove/.test(msg)) return { problem: `Wix would not remove ${listing} from ${where}.`, nextStep: "Open Details to see what Wix said, and let the site admin know." };
      return { problem: `Wix would not save ${listing} on ${where}.`, nextStep: "Open Details to see what Wix said, and let the site admin know." };
    case "mass_delete_guard": {
      const m = msg.match(/remove (\d+) of (\d+)/);
      const n = m ? `${m[1]} of the ${m[2]}` : "a large share of the";
      return {
        problem: `The updater wanted to remove ${n} live listings from ${where} at once, so it removed none.`,
        nextStep: "Check whether those listings really left the MLS, then let the site admin decide.",
      };
    }
    case "photos_broken":
      return {
        problem: `Too many photos on ${where} look wrong to the checker, so nothing was touched.${repeated}`,
        nextStep: "The site admin needs to look before any photos are fetched again.",
      };
    case "gallery_unusable":
      return {
        problem: `Some photos for ${listing} can't be shown on ${where}, so they were left off the listing.${repeated}`,
        nextStep: "The site admin needs to look: the photos are in Wix but the listing cannot use them.",
      };
    case "stats_failed":
      return { problem: `Neighborhood counts on ${where} aren't updating.${repeated}`, nextStep: `The updater retries every run. ${ASK_ADMIN}` };
    case "run_error": {
      const stage = msg.match(/Run failed at (\w+)/)?.[1];
      const during =
        stage === "fetch" || stage === "pull" ? " while reading the MLS feed"
        : stage === "write" || stage === "sites" ? " while saving to Wix"
        : stage === "photos" ? " while handling photos"
        : "";
      const why = /MLSGrid 4\d\d/.test(msg) ? " The MLS feed refused the request." : /Wix API[^:]*:? ?4\d\d/.test(msg) ? " Wix refused the request." : "";
      return { problem: `An update stopped early${during}.${why}${repeated}`, nextStep: `The next update tries again. ${ASK_ADMIN}` };
    }
    default:
      return { problem: msg, nextStep: "Open Details to see what happened." };
  }
}
