// Connection check: what a run of each builder connection would bring back
// for review, measured against what a visitor to the builder's site sees.
//
// Run from the Vercel build (floorplan-connection-check.mjs), because that
// is where the builders' sites are reachable. It uses the engine's own code
// end to end — the same URL discovery, the same extractor, the same
// standardizing and quick move-in linking (sync.ts, preparePlans) — and
// writes nothing: no URL is saved, nothing is queued, no status changes.
// Descriptions are not reworded, which is the one Claude call a run makes
// that has nothing to do with what is being checked.
//
// Alongside each run a browser opens the same pages a visitor would and
// counts what is on them: how many plans and homes the community page
// shows, the tabs it offers, the galleries a plan page carries and how
// many pictures each claims. Those counts are the answer key.
//
// Which connections are checked is scripts/floorplan-connection-check.json.
// Everything is printed with the FP-CHECK prefix and read from the build log.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { supabase } from "@/lib/supabase/client";
import { preparePlans, resolveExtractor, URLLESS_BUILDERS } from "@/lib/floorplans/sync";
import { discoverCommunityUrl } from "@/lib/floorplans/discover-url";
import { normKey, type NormalizedPlan, type Room } from "@/lib/floorplans/types";

interface Target {
  builder: string;
  /** A community of that builder's; omitted, the check picks one (a configured URL first, then the most plans). */
  community?: string;
  /** Every community of the builder. */
  all?: boolean;
  /** Extractor params to try instead of the saved ones — a candidate fix, tested before it is saved. */
  params?: Record<string, unknown>;
  /** Skip the extraction and only look at the pages. */
  surveyOnly?: boolean;
  /** Skip the browser survey. */
  noSurvey?: boolean;
}

interface Config {
  concurrency?: number;
  /** Plans printed with every picture; the rest get one line each. */
  detailPlans?: number;
  checks: Target[];
}

const say = (...parts: unknown[]) => console.log("FP-CHECK", ...parts);
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const RUN_LIMIT_MS = 300_000;
const CHECK_TIMEOUT_MS = 420_000;

const config = JSON.parse(
  readFileSync(process.env.FP_CHECK_CONFIG ?? path.join(__dirname, "floorplan-connection-check.json"), "utf8")
) as Config;

// ─── Connections ────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  params: Record<string, unknown>;
  lastPlanCount: number | null;
  lastStatus: string | null;
  builder: { id: string; name: string; extraction_method: string | null; base_url: string | null; engine_config: Record<string, unknown> | null };
  community: { id: string; name: string };
  site: { id: string; name: string | null };
}

async function loadConnections(): Promise<Connection[]> {
  const { data, error } = await supabase
    .from("fp_builder_communities")
    .select(
      "id, active, extractor_params, last_plan_count, last_run_status, fp_builders:builder_id(id, name, extraction_method, base_url, engine_config), fp_communities:community_id(id, name, fp_sites:site_id(id, name))"
    )
    .eq("active", true);
  if (error) throw new Error(`connections: ${error.message}`);
  return (data ?? []).map((row) => {
    const b = row.fp_builders as unknown as Connection["builder"];
    const c = row.fp_communities as unknown as { id: string; name: string; fp_sites: { id: string; name: string | null } };
    return {
      id: row.id,
      params: (row.extractor_params ?? {}) as Record<string, unknown>,
      lastPlanCount: row.last_plan_count,
      lastStatus: row.last_run_status,
      builder: b,
      community: { id: c.id, name: c.name },
      site: c.fp_sites,
    };
  });
}

function pick(all: Connection[], target: Target): Connection[] {
  const mine = all.filter((c) => c.builder.name === target.builder);
  if (!mine.length) return [];
  if (target.all) return mine;
  if (target.community) return mine.filter((c) => c.community.name === target.community);
  const ranked = [...mine].sort(
    (a, b) => Number(Boolean(b.params.url)) - Number(Boolean(a.params.url)) || (b.lastPlanCount ?? 0) - (a.lastPlanCount ?? 0)
  );
  return ranked.slice(0, 1);
}

/** The plans the site shows today for this builder and community (the Wix import), by name. */
async function sitePlans(conn: Connection): Promise<{ name: string; qmi: boolean }[]> {
  const { data } = await supabase
    .from("fp_legacy_items")
    .select("data")
    .eq("site_id", conn.site.id)
    .eq("collection_id", "FloorPlans");
  const short = conn.community.name.split(/\s*-\s*/).pop()!.toLowerCase();
  const builderWord = conn.builder.name.split(/[\s.]+/)[0].toLowerCase();
  return (data ?? [])
    .map((r) => r.data as Record<string, unknown>)
    .filter((d) => String(d.builder ?? "").toLowerCase().includes(builderWord))
    .filter((d) => String(d.village ?? "").toLowerCase().includes(short))
    .map((d) => ({
      name: String(d.floorPlanName ?? ""),
      qmi: /move/i.test(String(d.newConstructionOrMoveIn ?? "")) || Boolean(d.relatedFloorPlanQuickMoveInOnly),
    }));
}

// ─── The browser survey ─────────────────────────────────────────────────────

let browser: Browser | null = null;
let starting: Promise<Browser> | null = null;
/**
 * One browser for every survey, started once: lanes asking at the same
 * moment would each unpack Chromium into the same file while another was
 * running it (ETXTBSY).
 */
function surveyBrowser(): Promise<Browser> {
  if (browser?.connected) return Promise.resolve(browser);
  starting ??= (async () => {
    const puppeteer = (await import("puppeteer-core")).default;
    const local = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
    const opened = local
      ? await puppeteer.launch({ executablePath: local, args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true })
      : await (async () => {
          const pack = (await import("@sparticuz/chromium")).default;
          return puppeteer.launch({ executablePath: await pack.executablePath(), args: pack.args, headless: true });
        })();
    browser = opened;
    return opened;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface Seen {
  url: string;
  status: number | null;
  title: string;
  h1: string;
  textChars: number;
  prices: number;
  bigImages: number;
  controls: string[];
  counts: string[];
  planLinks: string[];
  homeLinks: string[];
  addressLines: number;
  galleries: string[];
  error?: string;
}

/** What a visitor sees on a page once it has drawn and been scrolled through. */
async function see(url: string): Promise<Seen> {
  let page: Page | null = null;
  let status: number | null = null;
  try {
    page = await (await surveyBrowser()).newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1440, height: 2000 });
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 }).catch(() => null);
    status = res?.status() ?? null;
    await wait(4_000);
    await page.evaluate(async () => {
      for (let n = 1; n <= 16; n++) {
        if (window.innerHeight * n > document.body.scrollHeight) break;
        window.scrollTo(0, window.innerHeight * n);
        await new Promise((r) => setTimeout(r, 300));
      }
      window.scrollTo(0, 0);
    });
    await wait(1_500);
    const here = page.url();
    const seen = await page.evaluate((base: string) => {
      const text = document.body?.innerText ?? "";
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const controls = [...document.querySelectorAll("button, [role=tab], a[href^='#']")]
        .map((el) => clean((el as HTMLElement).innerText))
        .filter((t) => t && t.length <= 40);
      const counts = [
        ...new Set(
          (text.match(
            /[^\n]{0,30}\b(\d{1,3})\s*(?:floor ?plans?|plans|homes?|quick move-?ins?|move-?in ready|available homes?|homesites|results|models|designs|photos|images|interiors?|exteriors?)\b[^\n]{0,15}|[^\n]{0,30}(?:plans?|homes?|move-?ins?|ready|photos|interiors?|exteriors?|gallery)\s*\(\d{1,3}\)|\+\s?\d{1,3}\s*more/gi
          ) ?? []).map(clean)
        ),
      ].slice(0, 25);
      const origin = new URL(base).origin;
      const basePath = new URL(base).pathname.replace(/\/$/, "");
      const links = [...document.querySelectorAll("a[href]")]
        .map((a) => (a as HTMLAnchorElement).href.split("#")[0].split("?")[0])
        .filter((h) => h.startsWith(origin));
      const unique = [...new Set(links)];
      const under = unique.filter((h) => new URL(h).pathname.startsWith(basePath + "/") && new URL(h).pathname !== basePath + "/");
      const homeLinks = under.filter((h) => /\d{3,}|home-?for-?sale|quick|inventory|move-?in|\/homes?\//i.test(new URL(h).pathname.slice(basePath.length)));
      const planLinks = under.filter((h) => !homeLinks.includes(h));
      const big = [...document.images].filter((i) => i.naturalWidth >= 300 || i.width >= 300).length;
      const galleries = [...document.querySelectorAll("h1,h2,h3,h4,[role=tab],button")]
        .map((el) => clean((el as HTMLElement).innerText))
        .filter((t) => /gallery|photos|interiors?|exteriors?|elevations?|floor ?plans?|virtual|tour/i.test(t) && t.length <= 50);
      return {
        title: clean(document.title).slice(0, 120),
        h1: clean(document.querySelector("h1")?.textContent).slice(0, 120),
        textChars: text.length,
        prices: (text.match(/\$\s?\d{3},\d{3}/g) ?? []).length,
        bigImages: big,
        controls: [...new Set(controls)].slice(0, 40),
        counts,
        planLinks: planLinks.slice(0, 60),
        homeLinks: homeLinks.slice(0, 60),
        addressLines: (text.match(/\b\d{3,6}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(?:St|Street|Dr|Drive|Ave|Avenue|Ln|Lane|Ct|Court|Cir|Circle|Way|Rd|Road|Pl|Place|Blvd|Trl|Trail|Ter|Terrace|Loop|Pkwy|Run|Cv|Cove|Pt|Point|Xing|Crossing)\b/gm) ?? []).length,
        galleries: [...new Set(galleries)].slice(0, 20),
      };
    }, here);
    return { url: here, status, ...seen };
  } catch (error) {
    return {
      url, status, title: "", h1: "", textChars: 0, prices: 0, bigImages: 0, controls: [], counts: [],
      planLinks: [], homeLinks: [], addressLines: 0, galleries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await page?.close().catch(() => {});
  }
}

function describeSeen(label: string, s: Seen): string[] {
  const lines: string[] = [];
  const say = (line: string) => lines.push(line);
  if (s.error) return [`  ${label}: could not open ${s.url}: ${s.error}`];
  say(`  ${label}: ${s.url} [${s.status ?? "?"}] "${s.title}" h1="${s.h1}"`);
  say(`    text ${s.textChars} chars, ${s.prices} prices shown, ${s.bigImages} large pictures, ${s.addressLines} street addresses`);
  if (s.counts.length) say(`    counts on page: ${s.counts.join(" | ")}`);
  if (s.galleries.length) say(`    gallery/tab labels: ${s.galleries.join(" | ")}`);
  const tabs = s.controls.filter((c) => /move|home|plan|avail|ready|inventory|photo|gallery|interior|exterior|more|all/i.test(c));
  if (tabs.length) say(`    controls: ${tabs.slice(0, 25).join(" | ")}`);
  say(`    links under this page: ${s.planLinks.length} plan-like, ${s.homeLinks.length} home-like`);
  const tail = (u: string) => new URL(u).pathname.split("/").filter(Boolean).slice(-2).join("/");
  if (s.planLinks.length) say(`      plan-like: ${s.planLinks.slice(0, 30).map(tail).join(", ")}`);
  if (s.homeLinks.length) say(`      home-like: ${s.homeLinks.slice(0, 30).map(tail).join(", ")}`);
  return lines;
}

// ─── The run ────────────────────────────────────────────────────────────────

const ROOM_CODE: Record<Room, string> = {
  primary: "P", kitchen: "K", living: "L", dining: "D", outdoor: "O", office: "F", hallway: "H",
  stairs: "S", loft: "T", bedroom: "B", bathroom: "A", laundry: "U", closet: "C", other: "?", exterior: "X",
};

function roomsOf(plan: NormalizedPlan): string {
  return plan.galleryImages.map((src) => ROOM_CODE[(plan.galleryMeta?.[src]?.room ?? "other") as Room] ?? "?").join("");
}

const cell = (v: unknown, n = 14) => {
  const s = v == null || v === "" ? "—" : String(v);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

function fileTail(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? url).slice(0, 70);
  } catch {
    return url.slice(-70);
  }
}

interface Outcome {
  label: string;
  verdict: string[];
}

async function check(conn: Connection, target: Target): Promise<Outcome> {
  const label = `${conn.builder.name} · ${conn.community.name} (${conn.site.name ?? "?"})`;
  const lines: string[] = [];
  const problems: string[] = [];
  const out = (s: string) => lines.push(s);
  out(`══ ${label} ══ method=${conn.builder.extraction_method} last status="${cell(conn.lastStatus, 90)}"`);

  // The page.
  let params = { ...conn.params, ...(target.params ?? {}) };
  let how = target.params ? "override" : params.url ? "saved" : "none";
  if (!params.url && !URLLESS_BUILDERS.has(conn.builder.name) && !target.surveyOnly) {
    const found = await discoverCommunityUrl(conn.builder, conn.community.name, conn.site.name ? [conn.site.name] : []).catch(() => null);
    if (found) {
      params = { ...params, url: found };
      how = "discovered";
    } else {
      problems.push("no page: URL discovery found nothing");
    }
  }
  out(`  page (${how}): ${params.url ?? "(none — engine works without one)"}`);
  if (Array.isArray(params.listUrls)) out(`  list pages: ${(params.listUrls as string[]).join(" , ")}`);
  if (params.quickMoveInUrl) out(`  homes page: ${params.quickMoveInUrl}`);

  const site = await sitePlans(conn).catch(() => []);
  const siteBase = site.filter((p) => !p.qmi);
  out(`  site today: ${site.length} rows (${siteBase.length} plans, ${site.length - siteBase.length} homes); last_plan_count=${conn.lastPlanCount ?? "—"}`);

  // The extraction.
  let plans: NormalizedPlan[] = [];
  let ms = 0;
  if (!target.surveyOnly) {
    const extractor = resolveExtractor(conn.builder.name, conn.builder.extraction_method);
    const started = Date.now();
    try {
      if (!extractor) throw new Error(`no extractor for ${conn.builder.extraction_method}`);
      const scraped = await Promise.race([
        extractor({ ...params, communityName: conn.community.name, builderName: conn.builder.name }),
        wait(CHECK_TIMEOUT_MS).then(() => {
          throw new Error(`still running after ${CHECK_TIMEOUT_MS / 1000}s`);
        }),
      ]);
      ms = Date.now() - started;
      plans = scraped.length
        ? await preparePlans(scraped, { site: conn.site, community: conn.community, builder: conn.builder }, { rewordDescriptions: false })
        : [];
      if (!plans.length) problems.push("zero plans");
    } catch (error) {
      ms = Date.now() - started;
      problems.push(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (ms > RUN_LIMIT_MS * 0.8) problems.push(`slow: ${Math.round(ms / 1000)}s of the ${RUN_LIMIT_MS / 1000}s a run may take`);

    const base = plans.filter((p) => !p.quickMoveIn);
    const homes = plans.filter((p) => p.quickMoveIn);
    out(`  result: ${plans.length} (${base.length} plans, ${homes.length} homes) in ${Math.round(ms / 1000)}s`);

    // Right page? The names the site already carries should mostly come back.
    if (siteBase.length && base.length) {
      const got = new Set(base.map((p) => normKey(p.name)));
      const matched = siteBase.filter((p) => got.has(normKey(p.name)) || [...got].some((g) => g.includes(normKey(p.name)) || normKey(p.name).includes(g)));
      out(`  names the site has that came back: ${matched.length}/${siteBase.length}${matched.length < siteBase.length ? ` — missing: ${siteBase.filter((p) => !matched.includes(p)).map((p) => p.name).slice(0, 12).join(", ")}` : ""}`);
      if (matched.length / siteBase.length < 0.4) problems.push(`page: only ${matched.length}/${siteBase.length} of the site's plan names came back — wrong page or plans the builder retired`);
    }

    // Facts.
    const missing = (f: (p: NormalizedPlan) => unknown) => base.filter((p) => f(p) == null || f(p) === "").length;
    const gaps = {
      type: missing((p) => p.homeType),
      price: missing((p) => p.price),
      beds: missing((p) => p.beds),
      baths: missing((p) => p.baths),
      sqft: missing((p) => p.sqft),
    };
    const gapText = Object.entries(gaps).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ");
    if (gapText) out(`  facts missing on base plans: ${gapText}`);
    if (base.length && (gaps.type || gaps.beds || gaps.baths)) problems.push(`facts: ${gapText}`);
    else if (base.length && gaps.price > base.length / 2) problems.push(`facts: price missing on ${gaps.price}/${base.length}`);
    const odd = base.filter((p) => (p.price != null && (p.price < 100_000 || p.price > 15_000_000)) || (p.sqft != null && (p.sqft < 400 || p.sqft > 15_000)) || Number(p.beds) > 9);
    if (odd.length) problems.push(`facts: implausible values on ${odd.map((p) => p.name).join(", ")}`);

    // Pictures.
    const noPhotos = base.filter((p) => p.galleryImages.length === 0);
    const onePhoto = base.filter((p) => p.galleryImages.length === 1);
    const noPrints = base.filter((p) => p.blueprintImages.length === 0);
    const unread = plans.filter((p) => p.pageUnread);
    const unplaced = base.filter((p) => {
      const r = roomsOf(p);
      return r.length >= 4 && (r.match(/\?/g) ?? []).length / r.length > 0.5;
    });
    const photoCounts = base.map((p) => p.galleryImages.length).sort((a, b) => a - b);
    out(`  photos per plan: ${photoCounts.join(",") || "—"}; blueprints missing on ${noPrints.length}/${base.length}; pages unread ${unread.length}`);
    if (base.length && noPhotos.length) problems.push(`images: no photos on ${noPhotos.length}/${base.length}`);
    if (base.length && onePhoto.length > base.length / 2) problems.push(`images: only the main photo on ${onePhoto.length}/${base.length}`);
    if (base.length && noPrints.length > base.length / 2) problems.push(`images: no floor plan drawing on ${noPrints.length}/${base.length}`);
    if (unread.length) problems.push(`images: ${unread.length} plan pages could not be read`);
    if (unplaced.length > base.length / 2 && base.length) problems.push(`sorting: most photos unplaced on ${unplaced.length}/${base.length} plans`);
    const printsLookLikePhotos = base.filter((p) => p.blueprintImages.some((u) => /elevation|exterior|kitchen|living|bedroom|rendering/i.test(fileTail(u))));
    if (printsLookLikePhotos.length) problems.push(`images: photos filed as floor plan drawings on ${printsLookLikePhotos.map((p) => p.name).join(", ")}`);
    const shared = new Map<string, number>();
    for (const p of base) for (const u of new Set(p.galleryImages)) shared.set(u, (shared.get(u) ?? 0) + 1);
    const common = [...shared.values()].filter((n) => base.length >= 3 && n >= Math.max(3, base.length * 0.6)).length;
    if (common) problems.push(`images: ${common} pictures appear on most plans (community photos, not the plan's)`);

    // Quick move-ins.
    const unlinked = homes.filter((h) => !h.relatedPlanKey);
    if (homes.length) out(`  homes linked to a plan: ${homes.length - unlinked.length}/${homes.length}`);
    if (unlinked.length) problems.push(`homes: ${unlinked.length}/${homes.length} not tied to a plan (${unlinked.map((h) => h.name).slice(0, 5).join("; ")})`);

    // The table.
    out(`  ${"plan".padEnd(30)} ${"type".padEnd(12)} ${"price".padEnd(11)} bd  ba   sqft  gar    ph  bp tour  order`);
    for (const p of [...base, ...homes]) {
      out(
        `  ${(p.quickMoveIn ? "⌂ " : "") + cell(p.name, p.quickMoveIn ? 26 : 28)}`.padEnd(32) +
          ` ${cell(p.homeType, 12).padEnd(12)} ${cell(p.priceDisplay, 11).padEnd(11)} ${cell(p.beds, 3).padEnd(3)} ${cell(p.baths, 4).padEnd(4)} ${cell(p.sqft, 5).padStart(5)}  ${cell(p.garages, 6).padEnd(6)} ${String(p.galleryImages.length).padStart(2)}  ${String(p.blueprintImages.length).padStart(2)} ${p.virtualTourUrl ? "yes " : "—   "}  ${roomsOf(p).slice(0, 40)}${p.pageUnread ? " UNREAD" : ""}${p.quickMoveIn ? ` → ${p.relatedPlanName ?? "?"} (${p.relatedPlanMatch ?? "—"})` : ""}`
      );
    }
    // A few plans in full, so the pictures themselves can be judged.
    const detail = [...base].sort((a, b) => b.galleryImages.length - a.galleryImages.length).slice(0, config.detailPlans ?? 1);
    for (const p of detail) {
      out(`  ▸ ${p.name}: ${p.sourceUrl}`);
      for (const src of p.galleryImages) {
        const m = p.galleryMeta?.[src];
        out(`      ${ROOM_CODE[(m?.room ?? "other") as Room] ?? "?"} ${cell(m?.caption, 40).padEnd(40)} ${src.slice(0, 160)}`);
      }
      for (const src of p.blueprintImages) out(`      ▦ ${src.slice(0, 180)}`);
      if (p.virtualTourUrl) out(`      tour ${p.virtualTourUrl}`);
    }
  }

  // What a visitor sees.
  if (!target.noSurvey && typeof params.url === "string") {
    for (const s of [params.url, ...((params.listUrls as string[] | undefined) ?? []), ...(params.quickMoveInUrl ? [String(params.quickMoveInUrl)] : [])].filter((u, i, a) => a.indexOf(u) === i).slice(0, 3)) {
      lines.push(...describeSeen("visitor sees", await see(s)));
    }
    const firstPlan = plans.find((p) => !p.quickMoveIn && p.sourceUrl && p.sourceUrl !== params.url);
    const firstHome = plans.find((p) => p.quickMoveIn && p.sourceUrl && p.sourceUrl !== params.url);
    for (const [what, p] of [["plan page", firstPlan], ["home page", firstHome]] as const) {
      if (!p?.sourceUrl) continue;
      const seen = await see(p.sourceUrl);
      lines.push(...describeSeen(`${what} (${p.name}; engine kept ${p.galleryImages.length} photos, ${p.blueprintImages.length} drawings)`, seen));
    }
  }

  return finish();

  function finish(): Outcome {
    const verdict = problems.length ? problems : ["looks healthy"];
    out(`  VERDICT: ${verdict.join(" · ")}`);
    for (const l of lines) say(l);
    return { label, verdict };
  }
}

async function main() {
  say(`start; Claude key ${process.env.ANTHROPIC_API_KEY ? "present" : "MISSING"}, Supabase ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "present" : "MISSING"}`);
  const all = await loadConnections();
  const jobs: { conn: Connection; target: Target }[] = [];
  for (const target of config.checks) {
    const picked = pick(all, target);
    if (!picked.length) say(`no active connection for ${target.builder}${target.community ? ` · ${target.community}` : ""}`);
    for (const conn of picked) jobs.push({ conn, target });
  }
  say(`${jobs.length} connections to check`);
  // Chromium is unpacked once, before anything else can reach for it —
  // the rendering engine unpacks into the same place.
  await surveyBrowser().catch((error) => say(`survey browser would not start: ${error instanceof Error ? error.message : String(error)}`));

  // Rendering builders share one browser per run (render.ts), so they go one
  // at a time; the rest run a few at once.
  const rendered = jobs.filter((j) => j.conn.builder.extraction_method === "render_claude");
  const fetched = jobs.filter((j) => j.conn.builder.extraction_method !== "render_claude");
  const outcomes: Outcome[] = [];
  const lane = async (queue: typeof jobs) => {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        outcomes.push(await check(job.conn, job.target));
      } catch (error) {
        say(`check crashed for ${job.conn.builder.name} · ${job.conn.community.name}: ${error instanceof Error ? error.stack : String(error)}`);
        outcomes.push({ label: `${job.conn.builder.name} · ${job.conn.community.name}`, verdict: ["check crashed"] });
      }
    }
  };
  await Promise.all([
    lane(rendered),
    ...Array.from({ length: Math.max(1, config.concurrency ?? 3) }, () => lane(fetched)),
  ]);

  say("════ SUMMARY ════");
  for (const o of outcomes.sort((a, b) => a.label.localeCompare(b.label))) say(`${o.label}: ${o.verdict.join(" · ")}`);
  await browser?.close().catch(() => {});
}

// FP_CHECK_SEE=<url>: only look at one page, the way the survey does.
const only = process.env.FP_CHECK_SEE;
(only ? see(only).then((s) => describeSeen("visitor sees", s).forEach((l) => say(l))).then(() => browser?.close()) : main())
  .catch((error) => say("failed:", error instanceof Error ? error.stack : String(error)))
  .finally(() => process.exit(0));
