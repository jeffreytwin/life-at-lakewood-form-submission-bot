// Phase 2 verification: the listings engine core against a site's shadow
// collection. Spawned by scripts/listings-engine-phase2.mjs (which holds the
// branch guard) under tsx, so it runs the engine's own modules rather than a
// re-implementation. Every step is isolated and reported with timings; the
// process always exits 0.
//
// Steps: census of the live and shadow collections; optional shadow reset;
// village import from the Wix Villages collection; media seed from the live
// galleries (read-only); a full run and a bounded incremental run when
// MLSGRID_API_KEY is set; shadow-vs-live comparison by _id; engine snapshot
// (site listing states, newest runs, newest warn/error events).

import { supabase } from "@/lib/supabase/client";
import { loadActiveSites, selectAll } from "@/lib/listings/db";
import { importVillagesFromWix } from "@/lib/listings/villages";
import { seedSiteMediaFromLive } from "@/lib/listings/media-seed";
import { runReconcile, type ReconcileResult } from "@/lib/listings/reconcile";
import { summarize } from "@/lib/listings/tick";
import { bulkRemoveItems, queryAllItems, type WixDataItem, type WixItemData } from "@/lib/wix/client";
import { errorMessage } from "@/lib/shared/errors";
import type { LsSite } from "@/lib/listings/types";

const TAG = "LS2";
const t0 = Date.now();
const log = (message: string) => console.log(`${TAG} +${((Date.now() - t0) / 1000).toFixed(1)}s ${message}`);
const js = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return String(value);
  }
};

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const started = Date.now();
  try {
    const out = await fn();
    log(`${name}: ok in ${Date.now() - started} ms`);
    return out;
  } catch (error) {
    log(`${name}: FAILED after ${Date.now() - started} ms: ${errorMessage(error)}`);
    return null;
  }
}

interface Census {
  items: WixDataItem[];
  ids: Set<string>;
  mfrKeyed: number;
}

const itemId = (item: WixDataItem): string => item.id ?? String(item.data._id ?? "");

async function census(site: LsSite, collectionId: string, includeDrafts: boolean): Promise<Census> {
  const items = await queryAllItems(site.wix_site_id!, collectionId, { includeDrafts });
  const ids = new Set(items.map(itemId).filter(Boolean));
  return { items, ids, mfrKeyed: [...ids].filter((id) => id.startsWith("MFR")).length };
}

const COMPARED_FIELDS = ["propertyAddress", "village", "listingPrice", "standardStatus", "bedrooms", "bathrooms", "listingPrimaryImage"] as const;

function galleryLength(data: WixItemData): number {
  return Array.isArray(data.listingImageGallery) ? data.listingImageGallery.length : 0;
}

function compare(live: WixDataItem[], shadow: WixDataItem[]) {
  const shadowById = new Map(shadow.map((s) => [itemId(s), s.data]));
  const liveIds = new Set(live.map(itemId));
  let same = 0;
  const diffs: Record<string, number> = {};
  const samples: string[] = [];
  const liveOnly: string[] = [];
  for (const l of live) {
    const id = itemId(l);
    const s = shadowById.get(id);
    if (!s) {
      liveOnly.push(id);
      continue;
    }
    const changed: string[] = COMPARED_FIELDS.filter((f) => js(l.data[f]) !== js(s[f]));
    if (galleryLength(l.data) !== galleryLength(s)) changed.push("gallery length");
    if (!changed.length) {
      same += 1;
      continue;
    }
    for (const c of changed) diffs[c] = (diffs[c] ?? 0) + 1;
    if (samples.length < 10) samples.push(`${id}: ${changed.join(", ")}`);
  }
  const shadowOnly = shadow.map(itemId).filter((id) => !liveIds.has(id));
  return { same, diffs, samples, liveOnly, shadowOnly };
}

function report(result: ReconcileResult): void {
  const s = summarize(result);
  log(
    `  ${result.mode} ${result.status} at stage ${result.stage}${result.truncated ? " (truncated)" : ""}: ` +
      `fetched ${result.fetched}, relevant ${result.relevant}, missing ${result.missing}; ` +
      `mlsgrid ${result.mlsgrid.requests} req ${(result.mlsgrid.bytes / 1e6).toFixed(1)} MB` +
      `${result.mlsgrid.rateLimited ? ` (${result.mlsgrid.rateLimited} rate-limited)` : ""}; counts ${js(s.counts)}`
  );
  for (const site of result.sites) log(`  ${site.domain} -> ${site.target}: ${js(site)}`);
  if (result.error) log(`  error: ${result.error}`);
}

async function main(): Promise<void> {
  log(`starting (branch ${process.env.VERCEL_GIT_COMMIT_REF ?? "(none)"}, MLSGRID_API_KEY ${process.env.MLSGRID_API_KEY ? "present" : "missing"})`);
  const domain = process.env.LS_PHASE2_SITE_DOMAIN || "lifeinlongboatkey.com";
  const site = (await loadActiveSites()).find((s) => s.domain === domain);
  if (!site) {
    log(`no active ls_sites row for ${domain}; nothing to do`);
    return;
  }
  log(`site ${site.domain} (${site.id}): wix ${site.wix_site_id}, mode ${site.write_mode}, target ${site.target_collection_id}, live ${site.live_collection_id}, cities ${js(site.market_cities)}`);
  if (!site.wix_site_id) {
    log("site has no wix_site_id; nothing to do");
    return;
  }
  const shadowIsSeparate = site.target_collection_id !== site.live_collection_id;
  if (site.write_mode !== "live" && !shadowIsSeparate) {
    log(`refusing to continue: write_mode ${site.write_mode} but the target is the live collection`);
    return;
  }

  // ---- 1. census ----
  const before = await step("census", async () => {
    const live = await census(site, site.live_collection_id, false);
    const shadow = await census(site, site.target_collection_id, true);
    const overlap = [...shadow.ids].filter((id) => live.ids.has(id)).length;
    log(`  live ${site.live_collection_id}: ${live.items.length} items, ${live.mfrKeyed} keyed by ListingId`);
    log(`  shadow ${site.target_collection_id}: ${shadow.items.length} items, ${shadow.mfrKeyed} keyed by ListingId, ${overlap} share an _id with live`);
    return { live, shadow };
  });

  // ---- 1b. optional reset of the shadow collection (never the live one) ----
  if (process.env.LS_PHASE2_RESET_SHADOW === "1") {
    if (!shadowIsSeparate) log("reset shadow: refused, target is the live collection");
    else if (!before) log("reset shadow: skipped, census failed");
    else {
      await step("reset shadow", async () => {
        const ids = [...before.shadow.ids];
        if (ids.length) {
          const out = await bulkRemoveItems(site.wix_site_id!, site.target_collection_id, ids, { includeDrafts: true });
          log(`  removed ${out.totalSuccesses} of ${ids.length} (${out.requests} request(s), ${out.totalFailures} failed)`);
        } else {
          log("  shadow already empty");
        }
        const { error } = await supabase
          .from("ls_site_listings")
          .update({ wix_item_id: null, written_at: null, written_fingerprint: null, needs_write: true })
          .eq("site_id", site.id)
          .neq("state", "removed");
        if (error) throw new Error(`forget written state: ${errorMessage(error)}`);
      });
    }
  }

  // ---- 2. villages ----
  await step("villages import", async () => {
    const r = await importVillagesFromWix(site, "Villages");
    log(`  ${r.villages} villages, ${r.terms} terms, ${r.conflicts.length} conflict(s), ${r.skippedRows} row(s) skipped`);
    for (const c of r.conflicts.slice(0, 10)) {
      log(`  conflict: "${c.term}"${c.street_term ? ` with street "${c.street_term}"` : ""} under ${c.village} already belongs to another village`);
    }
  });

  // ---- 3. media seed from the live galleries (read-only on Wix) ----
  await step("media seed", async () => {
    const r = await seedSiteMediaFromLive(site);
    log(`  ${r.liveItems} live items, ${r.galleryItems} gallery items (${r.unkeyed} unkeyed), ${r.placeholders} placeholder listing(s), ${r.mediaRows} media row(s), ${r.siteMediaRows} site media row(s) added, ${r.refreshed} URI(s) refreshed`);
  });

  // ---- 4. runs ----
  if (!process.env.MLSGRID_API_KEY) {
    log("MLSGRID_API_KEY is not set: skipping the full and incremental runs (add it to the Vercel environment and redeploy)");
  } else {
    const budget = Number(process.env.LS_PHASE2_RUN_BUDGET_MS) || 200_000;
    const full = await step("full run", () => runReconcile({ mode: "full", trigger: "manual", deadline: Date.now() + budget }));
    if (full) report(full);
    const maxPages = Number(process.env.LS_PHASE2_MAX_PAGES) || 10;
    const incremental = await step("incremental run", () => runReconcile({ mode: "incremental", trigger: "manual", deadline: Date.now() + budget, maxPages }));
    if (incremental) report(incremental);
  }

  // ---- 5. shadow vs live ----
  await step("shadow vs live", async () => {
    const live = await census(site, site.live_collection_id, false);
    const shadow = await census(site, site.target_collection_id, true);
    const c = compare(live.items, shadow.items);
    log(`  live ${live.items.length}, shadow ${shadow.items.length}: ${c.same} identical on the compared fields, differences ${Object.keys(c.diffs).length ? js(c.diffs) : "none"}, ${c.liveOnly.length} live-only, ${c.shadowOnly.length} shadow-only`);
    for (const s of c.samples) log(`  differs ${s}`);
    if (c.liveOnly.length) log(`  live-only sample: ${c.liveOnly.slice(0, 10).join(", ")}`);
    if (c.shadowOnly.length) log(`  shadow-only sample: ${c.shadowOnly.slice(0, 10).join(", ")}`);
  });

  // ---- 6. engine snapshot ----
  await step("engine snapshot", async () => {
    const states = await selectAll<{ state: string; gallery_ready: boolean; needs_write: boolean }>("load site listing states", (from, to) =>
      supabase.from("ls_site_listings").select("state, gallery_ready, needs_write").eq("site_id", site.id).order("id").range(from, to)
    );
    const counts: Record<string, number> = {};
    for (const row of states) {
      counts[row.state] = (counts[row.state] ?? 0) + 1;
      if (row.state !== "removed" && !row.gallery_ready) counts.galleryPending = (counts.galleryPending ?? 0) + 1;
      if (row.needs_write) counts.needsWrite = (counts.needsWrite ?? 0) + 1;
    }
    const { count: inFeed } = await supabase.from("ls_listings").select("listing_id", { count: "exact", head: true }).eq("in_feed", true);
    const { data: runs } = await supabase
      .from("ls_sync_runs")
      .select("run_key, status, stage, duration_ms, inserted, updated, deleted, unstaged, deletes_skipped, writes_failed, warnings, errors, mlsgrid_request_count, mlsgrid_bytes, wix_requests")
      .order("started_at", { ascending: false })
      .limit(5);
    const { data: events } = await supabase
      .from("ls_sync_events")
      .select("at, level, kind, listing_id, message")
      .neq("level", "info")
      .order("at", { ascending: false })
      .limit(20);
    log(`  site listings ${js(counts)}; listings in feed ${inFeed ?? 0}`);
    for (const r of runs ?? []) log(`  run ${js(r)}`);
    for (const e of (events ?? []) as { at: string; level: string; kind: string; listing_id: string | null; message: string }[]) {
      log(`  event ${e.at} ${e.level} ${e.kind} ${e.listing_id ?? "-"}: ${e.message}`);
    }
  });

  log("done.");
}

main()
  .catch((error) => log(`fatal: ${errorMessage(error)}`))
  .finally(() => process.exit(0));
