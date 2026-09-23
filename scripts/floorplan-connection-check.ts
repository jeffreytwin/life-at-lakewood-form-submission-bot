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
// Each connection's report is kept in fp_connection_checks (migration 074),
// one row per connection per build, so one builder's can be read on its
// own; the build log gets one verdict line per connection. Only on the
// working branch; production never builds this.

import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Browser, Page } from "puppeteer-core";
import { supabase } from "@/lib/supabase/client";
import { extractorFor, preparePlans, readsThroughBrowser, readsWithoutPage, resolveExtractor, RUN_READ_MS } from "@/lib/floorplans/sync";
import { discoverCommunityUrl } from "@/lib/floorplans/discover-url";
import { distill } from "@/lib/floorplans/extractors/claude-extract";
import { firstGallery, payloadGallery } from "@/lib/floorplans/extractors/plan-page";
import { normKey, type NormalizedPlan, type Room } from "@/lib/floorplans/types";

interface Target {
  builder: string;
  /** A community of that builder's; omitted, the check picks one (a configured URL first, then the most plans). */
  community?: string;
  /** Every community of the builder. */
  all?: boolean;
  /** Extractor params to try instead of the saved ones — a candidate fix, tested before it is saved. */
  params?: Record<string, unknown>;
  /** An extraction method to try instead of the builder's saved one ("render_claude" for a page drawn after loading). */
  method?: string;
  /** Read with the generic engine of `method`, not the builder's own (a builder whose own engine has no source for this community). */
  generic?: boolean;
  /** Use the candidate page from floorplan-connection-urls.json even though a page is saved (a saved page that is wrong). */
  preferCandidate?: boolean;
  /** Skip the extraction and only look at the pages. */
  surveyOnly?: boolean;
  /** Skip the browser survey. */
  noSurvey?: boolean;
}

interface Config {
  /** Pages to take apart for reading (anatomy/<slug>.txt): how a page is built, not what it says. */
  anatomy?: string[];
  /** Pages whose markup, as a plain fetch receives it, is printed around the words given: what the readers here actually parse. */
  raw?: { url: string; around: string[]; chars?: number; after?: number; count?: number }[];
  concurrency?: number;
  /** Plans printed with every picture; the rest get one line each. */
  detailPlans?: number;
  checks: Target[];
}

const say = (...parts: unknown[]) => console.log("FP-CHECK", ...parts);
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const RUN_LIMIT_MS = 300_000;
/** This build, as the reports are filed under: the commit and the minute. */
const BUILD = `${(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)} ${new Date().toISOString().slice(0, 16)}`;

async function keep(label: string, report: string, verdict: string | null = null): Promise<void> {
  const { error } = await supabase.from("fp_connection_checks").insert({ build: BUILD, label, verdict, report });
  if (error) say(`could not keep the report for ${label}: ${error.message}`);
}
const CHECK_TIMEOUT_MS = 420_000;

const config = JSON.parse(
  readFileSync(process.env.FP_CHECK_CONFIG ?? path.join(__dirname, "floorplan-connection-check.json"), "utf8")
) as Config;

/**
 * Pages found for the connections that have none saved (scripts/floorplan-
 * connection-urls.json), tried in place of discovery so each can be
 * checked before it is saved. Null: the builder has no page for it.
 */
const CANDIDATES = (() => {
  try {
    const file = process.env.FP_CHECK_URLS ?? path.join(path.dirname(process.env.FP_CHECK_CONFIG ?? __filename), "floorplan-connection-urls.json");
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown> | null>;
  } catch {
    return {} as Record<string, Record<string, unknown> | null>;
  }
})();

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
  const mine = all
    .filter((c) => c.builder.name === target.builder)
    .map((c) => (target.method ? { ...c, builder: { ...c.builder, extraction_method: target.method } } : c));
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
  // The builder's own word, not a word every builder uses: "Homes by
  // WestBay" matched every "... Homes" on the site.
  const builderWord =
    conn.builder.name
      .toLowerCase()
      .split(/[\s.]+/)
      .find((w) => w.length > 2 && !/^(homes?|by|the|builders?|communities|group|inc|llc)$/.test(w)) ?? conn.builder.name.toLowerCase();
  const mine = (data ?? [])
    .map((r) => r.data as Record<string, unknown>)
    .filter((d) => String(d.builder ?? "").toLowerCase().includes(builderWord));
  // The village named exactly, where there is one: Pulte's "North River
  // Ranch" is not its "Del Webb Explore North River Ranch".
  const village = (d: Record<string, unknown>) => String(d.village ?? "").toLowerCase().trim();
  const exact = mine.filter((d) => village(d) === short || village(d) === conn.community.name.toLowerCase());
  return (exact.length ? exact : mine.filter((d) => village(d).includes(short)))
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
    // Loaded, then up to 15 seconds to go quiet: a page with a chat widget
    // never does, and waiting out 45 seconds a page made the survey the
    // slowest part of a check (D.R. Horton: 13 seconds to read, 5 minutes
    // to survey).
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
    status = res?.status() ?? null;
    await page.waitForNetworkIdle({ idleTime: 500, concurrency: 2, timeout: 15_000 }).catch(() => {});
    await wait(2_000);
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

// ─── Page anatomy ───────────────────────────────────────────────────────────

/**
 * How a page is built, compactly: its headings and the pictures under each,
 * every picture with its caption and size, its tabs and buttons, its links,
 * and where its scripts mention galleries, floor plans and elevations. What
 * a person would look at in the browser's inspector to decide how to read
 * the page, written where it can be read from here.
 */
const ANATOMY_SCRIPT = `(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const out = [];
  out.push("URL " + location.href);
  out.push("TITLE " + clean(document.title));
  out.push("");
  out.push("== OUTLINE (heading · pictures under it) ==");
  const marks = [...document.querySelectorAll("h1,h2,h3,h4,h5,img")];
  let current = "(top)";
  const counts = new Map();
  const order = ["(top)"];
  for (const el of marks) {
    if (el.tagName === "IMG") counts.set(current, (counts.get(current) || 0) + 1);
    else { current = el.tagName + " " + clean(el.innerText).slice(0, 80); order.push(current); }
  }
  for (const h of order) out.push(h + " · " + (counts.get(h) || 0));
  out.push("");
  out.push("== PICTURES ==");
  let heading = "(top)";
  let n = 0;
  for (const el of marks) {
    if (el.tagName !== "IMG") { heading = clean(el.innerText).slice(0, 40); continue; }
    if (n++ >= 160) break;
    const src = el.currentSrc || el.src || el.getAttribute("data-src") || "";
    if (src.startsWith("data:")) { n--; continue; }
    const set = el.getAttribute("srcset") || el.getAttribute("data-srcset") || "";
    out.push([el.naturalWidth + "x" + el.naturalHeight, "[" + heading + "]", "alt=" + JSON.stringify(clean(el.alt).slice(0, 60)), src.slice(0, 200), set ? "srcset:" + set.split(",").length : ""].join(" "));
  }
  out.push("");
  out.push("== LAZY PICTURES (data-* and <source>) ==");
  let lazy = 0;
  for (const el of document.querySelectorAll("[data-src],[data-srcset],[data-bg],[data-background],[data-lazy],[data-original],[data-image],source[srcset]")) {
    if (lazy++ >= 80) break;
    const attrs = ["data-src", "data-srcset", "data-bg", "data-background", "data-lazy", "data-original", "data-image", "srcset"].map((a) => el.getAttribute(a)).filter(Boolean);
    let heading = "";
    let walk = el;
    for (let n = 0; n < 30 && walk && !heading; n++) { const h = walk.querySelector && walk.querySelector("h1,h2,h3,h4"); if (h) heading = clean(h.innerText).slice(0, 30); walk = walk.parentElement; }
    out.push(el.tagName + " [" + heading + "] alt=" + JSON.stringify(clean(el.getAttribute("alt") || el.getAttribute("title") || "").slice(0, 40)) + " " + String(attrs[0]).slice(0, 200));
  }
  out.push("");
  out.push("== BACKGROUND PICTURES ==");
  let bg = 0;
  for (const el of document.querySelectorAll("*")) {
    const b = getComputedStyle(el).backgroundImage;
    if (b && b.startsWith("url(") && bg++ < 40) out.push(b.slice(0, 200));
  }
  out.push("");
  out.push("== CONTROLS ==");
  out.push([...new Set([...document.querySelectorAll("button,[role=tab],[role=button],a[href^='#'],a[href^='javascript']")].map((e) => clean(e.innerText)).filter((t) => t && t.length < 50))].slice(0, 120).join(" | "));
  out.push("");
  out.push("== LINKS ==");
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href.split("#")[0];
    if (seen.has(href) || !href.startsWith("http")) continue;
    seen.add(href);
    if (seen.size > 200) break;
    out.push(clean(a.innerText).slice(0, 50) + " -> " + href.slice(0, 180));
  }
  out.push("");
  out.push("== IFRAMES ==");
  for (const f of document.querySelectorAll("iframe")) out.push((f.src || "").slice(0, 200));
  out.push("");
  out.push("== SCRIPTS mentioning gallery / floor plan / elevation / image ==");
  const html = document.documentElement.outerHTML;
  const re = /(gallery|floor ?plan|floorplan|elevation|blueprint|interior|photos|images)/gi;
  let m; let hits = 0;
  const scripts = [...document.querySelectorAll("script")].map((s) => s.textContent || "").join("\\n");
  while ((m = re.exec(scripts)) && hits < 60) {
    hits++;
    out.push("… " + scripts.slice(Math.max(0, m.index - 90), m.index + 160).replace(/\\s+/g, " "));
    re.lastIndex = m.index + 400;
  }
  out.push("");
  const nd = document.getElementById("__NEXT_DATA__");
  if (nd) {
    out.push("== NEXT DATA ==");
    try {
      const j = JSON.parse(nd.textContent || "{}");
      const props = (j.props && j.props.pageProps) || {};
      out.push("pageProps keys: " + Object.keys(props).join(", "));
      const apollo = props.initialApolloState;
      if (apollo) {
        const types = {};
        for (const k of Object.keys(apollo)) { const t = k.split(":")[0]; (types[t] = types[t] || []).push(k); }
        for (const t of Object.keys(types)) {
          const first = apollo[types[t][0]];
          out.push(t + " x" + types[t].length + " keys: " + Object.keys(first || {}).join(", "));
          out.push("  " + types[t][0] + ": " + JSON.stringify(first).slice(0, /Plan|Home/.test(t) ? 20000 : 1200));
        }
      }
    } catch (e) { out.push("unreadable: " + e); }
    out.push("");
  }
  out.push("== TEXT ==");
  out.push(clean(document.body ? document.body.innerText : "").slice(0, 6000));
  out.push("");
  out.push("html " + html.length + " chars; scripts " + scripts.length + " chars; json-ld " + document.querySelectorAll("script[type='application/ld+json']").length);
  return out.join("\\n");
})()`;

/** The anatomy of a JSON answer: where its pictures are, and the shape around them. */
async function jsonAnatomy(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return `status ${res.status}; not JSON (${text.length} chars): ${text.slice(0, 1500)}`;
  }
  const out: string[] = [`status ${res.status}; ${text.length} chars of JSON`, "", "== PICTURES (path = value) =="];
  const shapes: string[] = [];
  const samples: string[] = [];
  // A picture by its extension, or by the media stores that write none
  // (Mattamy's ".../42159-50420/tpa-sunstone-anclote-kitchen1-jpg").
  const isPicture = (v: string) => /^https?:/i.test(v) && /\.(?:jpe?g|png|webp|svg|gif)(?:\?|$)|[-_](?:jpe?g|png|webp)(?:\?|$)|dfsmedia|\/-\/media\//i.test(v);
  const holdsPicture = (v: unknown): boolean => JSON.stringify(v ?? "").match(/"(https?:[^"]+)"/g)?.some((m) => isPicture(m.slice(1, -1))) ?? false;
  const walk = (value: unknown, at: string, depth: number) => {
    if (typeof value === "string") {
      if (isPicture(value) && out.length < 300) out.push(`${at} = ${value.slice(0, 200)}`);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (depth <= 12 && shapes.length < 400) shapes.push(`${at} [${value.length}]`);
      if (value.length && typeof value[0] === "object" && holdsPicture(value[0]) && samples.length < 20) {
        samples.push(`${at}[0] of ${value.length}: ${JSON.stringify(value[0]).slice(0, 1500)}`);
      }
      value.forEach((v, i) => walk(v, `${at}[${i}]`, depth + 1));
      return;
    }
    const keys = Object.keys(value);
    if (depth <= 12 && shapes.length < 400) shapes.push(`${at} {${keys.slice(0, 25).join(", ")}}`);
    for (const k of keys) walk((value as Record<string, unknown>)[k], `${at}.${k}`, depth + 1);
  };
  walk(data, "$", 0);
  // The first item of the first list, whole: a feed's record is what a reader is written from.
  const firstList = (value: unknown, depth: number): unknown[] | null => {
    if (Array.isArray(value)) return value.length ? value : null;
    if (!value || typeof value !== "object" || depth > 3) return null;
    for (const v of Object.values(value)) {
      const found = firstList(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const items = firstList(data, 0);
  // Every key, with each list cut to its first two entries.
  const brief = (_key: string, value: unknown) =>
    Array.isArray(value) && value.length > 2 ? [...value.slice(0, 2), `…${value.length - 2} more`] : value;
  const whole = items ? [`== FIRST ITEM (of ${items.length}; lists cut to two) ==`, JSON.stringify(items[0], brief, 1).slice(0, 16_000)] : [];
  // What the labelling fields say across the whole feed: a picture's type, a plan's kind.
  const labels = new Map<string, Set<string>>();
  const collect = (value: unknown, key: string) => {
    if (typeof value === "string" && /type|category|kind|status/i.test(key) && value.length < 80) {
      const seen = labels.get(key) ?? new Set<string>();
      if (seen.size < 30) seen.add(value);
      labels.set(key, seen);
    } else if (Array.isArray(value)) value.forEach((v) => collect(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collect(v, k);
  };
  collect(data, "$");
  whole.push("", "== LABELS ==", ...[...labels].map(([k, v]) => `${k}: ${[...v].join(" | ")}`));
  out.push("", ...whole, "", "== SAMPLES (first item of each list of pictures) ==", ...samples, "", "== SHAPE ==", ...shapes, "", "== BEGINS ==", text.slice(0, 3000));
  return out.join("\n");
}

/**
 * A page's markup as a plain fetch receives it, around the words given —
 * a caption, a price, a plan's name — and what the readers here make of
 * the page: how long Claude's copy of it is, and which pictures the
 * gallery readers take.
 */
async function rawAround(url: string, around: string[], chars = 1500, after = 0, count = 3): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(45_000) });
    const html = await res.text();
    const out = [`status ${res.status}; ${html.length} chars; answered from ${res.url}`];
    const text = distill(html, res.url || url);
    out.push("", `== CLAUDE IS HANDED (${text.length} chars) ==`, text.slice(0, 2500));
    const gallery = firstGallery(html, res.url || url);
    out.push("", `== FIRST GALLERY (${gallery.first.length}; ${gallery.drop.size} dropped) ==`, ...gallery.first.slice(0, 40).map((i) => `${i.src} alt=${JSON.stringify(i.alt)}`));
    const carried = payloadGallery(html, res.url || url);
    out.push("", `== PAYLOAD GALLERY (${carried.length}) ==`, ...carried.slice(0, 40).map((i) => `${i.src}${i.outside ? " (outside)" : ""}`));
    for (const words of around) {
      let from = after;
      for (let n = 0; n < count; n++) {
        const at = html.indexOf(words, from);
        if (at < 0) {
          if (n === 0) out.push("", `== "${words}" not in the markup ==`);
          break;
        }
        out.push("", `== "${words}" #${n + 1} at ${at} ==`, html.slice(Math.max(0, at - chars), at + chars));
        from = at + words.length;
      }
    }
    return out.join("\n");
  } catch (error) {
    return `could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function anatomy(url: string): Promise<string> {
  if (/\/api\/|\.json(?:\?|$)/i.test(url)) return jsonAnatomy(url).catch((e) => `could not read ${url}: ${e instanceof Error ? e.message : String(e)}`);
  let page: Page | null = null;
  try {
    page = await (await surveyBrowser()).newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1440, height: 2000 });
    // The data a page asks for after it loads: where a builder keeps its
    // plans when the markup does not carry them.
    const calls: string[] = [];
    page.on("response", (r) => {
      const type = r.headers()["content-type"] ?? "";
      if (/json/i.test(type) && calls.length < 80) calls.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 400)}`);
    });
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 }).catch(() => null);
    await wait(4_000);
    await page.evaluate(`(async () => { for (let n = 1; n <= 16; n++) { if (innerHeight * n > document.body.scrollHeight) break; scrollTo(0, innerHeight * n); await new Promise((r) => setTimeout(r, 300)); } scrollTo(0, 0); })()`);
    await wait(1_500);
    const fetched = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30_000) })
      .then(async (r) => `${r.status}, ${(await r.text()).length} chars`)
      .catch((e) => `failed: ${e instanceof Error ? e.message : String(e)}`);
    const body = String(await page.evaluate(ANATOMY_SCRIPT));
    return `status ${res?.status() ?? "?"}; plain fetch ${fetched}\n\n== JSON CALLS ==\n${calls.join("\n") || "(none)"}\n\n` + body;
  } catch (error) {
    return `could not open ${url}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await page?.close().catch(() => {});
  }
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

/** Whether Claude can be asked anything at all: a one-token question, so an empty account is known before forty runs fail on it. */
async function claudeAnswers(): Promise<string | null> {
  try {
    await new Anthropic().messages.create({ model: "claude-sonnet-5", max_tokens: 1, messages: [{ role: "user", content: "ok" }] });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 200) : String(error);
  }
}

/** Engines that read pages through Claude; the rest parse a builder's own data. */
const NEEDS_CLAUDE = new Set(["fetch_claude", "render_claude"]);
let claudeDown: string | null = null;

async function check(conn: Connection, target: Target): Promise<Outcome & { report: string }> {
  const label = `${conn.builder.name} · ${conn.community.name} (${conn.site.name ?? "?"})`;
  const lines: string[] = [];
  const problems: string[] = [];
  const out = (s: string) => lines.push(s);
  out(`══ ${label} ══ method=${conn.builder.extraction_method} last status="${cell(conn.lastStatus, 90)}"`);

  // The page: one given for this check, else the saved one, else a
  // candidate found for it, else discovery.
  const candidateKey = `${conn.builder.name} · ${conn.community.name}`;
  const candidate = CANDIDATES[candidateKey];
  if (!target.params && candidate === null && !conn.params.url) {
    problems.push("no page: the builder has no page for this community — it may not build there");
    return finish();
  }
  const useCandidate = !target.params && candidate && (!conn.params.url || target.preferCandidate);
  let params = { ...conn.params, ...(target.params ?? {}), ...(useCandidate ? candidate : {}) };
  let how = target.params ? "override" : useCandidate ? "candidate" : params.url ? "saved" : "none";
  if (!params.url && !readsWithoutPage(conn.builder.name, params) && !target.surveyOnly) {
    const found = await discoverCommunityUrl(conn.builder, conn.community.name, conn.site.name ? [conn.site.name] : [], (line) =>
      out(`    discovery: ${line}`)
    ).catch((error) => {
      out(`    discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
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

  // What Claude is handed for each list page, when the engine fetches it:
  // a page that fetches differently from how it looks is the usual reason
  // a run finds nothing.
  if (conn.builder.extraction_method === "fetch_claude" && !target.surveyOnly) {
    const pages = [...((params.listUrls as string[] | undefined) ?? (params.url ? [String(params.url)] : [])), ...(params.quickMoveInUrl ? [String(params.quickMoveInUrl)] : [])];
    for (const page of pages.slice(0, 3)) {
      try {
        const res = await fetch(page, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
        const html = await res.text();
        const text = distill(html, res.url || page);
        out(`  Claude is handed ${page}: ${res.status}, ${html.length} chars of HTML → ${text.length} chars of text, ${(text.match(/\[IMG /g) ?? []).length} pictures, ${(text.match(/\[LINK /g) ?? []).length} links, ${(text.match(/\$\s?\d{3},\d{3}/g) ?? []).length} prices`);
        out(`    begins: ${text.slice(0, 700)}`);
        const at = text.search(/floor ?plans?|quick move|move-in/i);
        if (at > 700) out(`    around the plans: ${text.slice(Math.max(0, at - 100), at + 900)}`);
      } catch (error) {
        out(`  Claude is handed ${page}: fetch failed (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }

  const site = await sitePlans(conn).catch(() => []);
  const siteBase = site.filter((p) => !p.qmi);
  out(`  site today: ${site.length} rows (${siteBase.length} plans, ${site.length - siteBase.length} homes); last_plan_count=${conn.lastPlanCount ?? "—"}`);

  // The extraction.
  let plans: NormalizedPlan[] = [];
  let ms = 0;
  const claudeBuilder = NEEDS_CLAUDE.has(conn.builder.extraction_method ?? "") && !["M/I Homes", "ICI Homes", "Neal Signature Homes", "Toll Brothers", "Taylor Morrison", "Lennar", "Meritage Homes", "Mattamy Homes", "DRB Homes"].includes(conn.builder.name);
  if (claudeDown && claudeBuilder && !target.surveyOnly) {
    problems.push("not extracted: Claude is unavailable this run");
    out(`  extraction skipped: Claude unavailable (${claudeDown})`);
  }
  if (!target.surveyOnly && !(claudeDown && claudeBuilder)) {
    const extractor = target.generic
      ? resolveExtractor("", conn.builder.extraction_method)
      : extractorFor(conn.builder.name, conn.builder.extraction_method, params);
    const started = Date.now();
    try {
      if (!extractor) throw new Error(`no extractor for ${conn.builder.extraction_method}`);
      const scraped = await Promise.race([
        // The same reading time a run has (sync.ts).
        extractor({ ...params, communityName: conn.community.name, builderName: conn.builder.name, runDeadline: started + RUN_READ_MS }),
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
    // Not a fault of the run: the photo sorter (sort-queue.ts) looks at
    // these once they are queued and puts them in order. Noted, not held
    // against the connection.
    if (unplaced.length) out(`  left to the photo sorter: most photos unplaced on ${unplaced.length}/${base.length} plans`);
    const printsLookLikePhotos = base.filter((p) => p.blueprintImages.some((u) => /elevation|exterior|kitchen|living|bedroom|rendering/i.test(fileTail(u))));
    if (printsLookLikePhotos.length) problems.push(`images: photos filed as floor plan drawings on ${printsLookLikePhotos.map((p) => p.name).join(", ")}`);
    const shared = new Map<string, number>();
    for (const p of base) for (const u of new Set(p.galleryImages)) shared.set(u, (shared.get(u) ?? 0) + 1);
    const common = [...shared.values()].filter((n) => base.length >= 3 && n >= Math.max(3, base.length * 0.6)).length;
    if (common) problems.push(`images: ${common} pictures appear on most plans (community photos, not the plan's)`);

    // Quick move-ins.
    const unlinked = homes.filter((h) => !h.relatedPlanKey);
    if (homes.length) out(`  homes linked to a plan: ${homes.length - unlinked.length}/${homes.length}`);
    // A community that sells only homes has no plans to tie them to (Meritage's Salt Meadows).
    if (!base.length && homes.length && siteBase.length) problems.push(`plans: none came back, though the site shows ${siteBase.length} for this community`);
    else if (base.length && unlinked.length) problems.push(`homes: ${unlinked.length}/${homes.length} not tied to a plan (${unlinked.map((h) => h.name).slice(0, 5).join("; ")})`);

    // The table.
    out(`  ${"plan".padEnd(30)} ${"type".padEnd(12)} ${"price".padEnd(11)} bd  ba   sqft  gar    ph  bp tour  order`);
    for (const p of [...base, ...homes]) {
      out(
        `  ${(p.quickMoveIn ? "⌂ " : "") + cell(p.name, p.quickMoveIn ? 26 : 28)}`.padEnd(32) +
          ` ${cell(p.homeType, 12).padEnd(12)} ${cell(p.priceDisplay, 11).padEnd(11)} ${cell(p.beds, 3).padEnd(3)} ${cell(p.baths, 4).padEnd(4)} ${cell(p.sqft, 5).padStart(5)}  ${cell(p.garages, 6).padEnd(6)} ${String(p.galleryImages.length).padStart(2)}  ${String(p.blueprintImages.length).padStart(2)} ${p.virtualTourUrl ? "yes " : "—   "}  ${roomsOf(p).slice(0, 40)}${p.pageUnread ? " UNREAD" : ""}${p.quickMoveIn ? ` → ${p.relatedPlanName ?? "?"} (${p.relatedPlanMatch ?? "—"}) ${p.sourceUrl ?? ""}` : ""}`
      );
    }
    // A few plans in full, so the pictures themselves can be judged.
    // And the first plan the check found fault with, whatever its size.
    const faulted = [...printsLookLikePhotos, ...base.filter((p) => p.galleryImages.length <= 1)].slice(0, 1);
    const detail = [...new Set([...[...base].sort((a, b) => b.galleryImages.length - a.galleryImages.length).slice(0, config.detailPlans ?? 1), ...faulted])];
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

  function finish(): Outcome & { report: string } {
    const verdict = problems.length ? problems : ["looks healthy"];
    out(`  VERDICT: ${verdict.join(" · ")}`);
    say(`${label}: ${verdict.join(" · ")}`);
    return { label, verdict, report: lines.join("\n") };
  }
}

async function main() {
  say(`start; Claude key ${process.env.ANTHROPIC_API_KEY ? "present" : "MISSING"}, Supabase ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "present" : "MISSING"}`);
  claudeDown = await claudeAnswers();
  say(claudeDown ? `Claude is unavailable — pages will be surveyed but not extracted: ${claudeDown}` : "Claude answers");
  for (const url of config.anatomy ?? []) {
    await keep(`anatomy: ${url}`, await anatomy(url));
    say(`anatomy of ${url} kept`);
  }
  for (const { url, around, chars, after, count } of config.raw ?? []) {
    await keep(`raw: ${url}`, await rawAround(url, around, chars, after, count));
    say(`markup of ${url} kept`);
  }
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

  // Rendering builders share one browser (render.ts, withRenderer), two at
  // a time so seven of them fit in a build; the rest run a few at once.
  const browsed = (j: (typeof jobs)[number]) =>
    readsThroughBrowser(j.conn.builder.name, j.conn.builder.extraction_method, { ...j.conn.params, ...(j.target.params ?? {}) });
  const rendered = jobs.filter(browsed);
  const fetched = jobs.filter((j) => !browsed(j));
  const outcomes: Outcome[] = [];
  const lane = async (queue: typeof jobs) => {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        const outcome = await check(job.conn, job.target);
        await keep(outcome.label, outcome.report, outcome.verdict.join(" · "));
        outcomes.push(outcome);
      } catch (error) {
        say(`check crashed for ${job.conn.builder.name} · ${job.conn.community.name}: ${error instanceof Error ? error.stack : String(error)}`);
        outcomes.push({ label: `${job.conn.builder.name} · ${job.conn.community.name}`, verdict: ["check crashed"] });
      }
    }
  };
  await Promise.all([
    lane(rendered),
    lane(rendered),
    ...Array.from({ length: Math.max(1, config.concurrency ?? 3) }, () => lane(fetched)),
  ]);

  say("════ SUMMARY ════");
  const summary = outcomes
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((o) => `${o.label}: ${o.verdict.join(" · ")}`);
  for (const line of summary) say(line);
  await keep("~summary", summary.join("\n"));
  await browser?.close().catch(() => {});
}

// FP_CHECK_SEE=<url>: only look at one page, the way the survey does.
const only = process.env.FP_CHECK_SEE;
(only ? see(only).then((s) => describeSeen("visitor sees", s).forEach((l) => say(l))).then(() => browser?.close()) : main())
  .catch((error) => say("failed:", error instanceof Error ? error.stack : String(error)))
  .finally(() => process.exit(0));
