// Auto-discovers the builder's community page URL for a connection, so
// onboarding a connection is one click — no URL pasting. Sources: the
// audit's stored URLs, the links on the builder's own area pages (the
// audit found "/florida/manatee-sarasota" for D.R. Horton, which lists
// every community there without naming any in its address), then the
// builder's sitemap and homepage. The best-scoring candidates are
// verified by fetching them: the page has to name the community and read
// like a page of homes for sale, so a story about a family who moved to
// Boca Royale is not taken for Boca Royale (Neal, 2026-09-22).

import { logger } from "@/lib/shared/logger";
import { normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * How long discovery may take in all. It runs inside a connection's first
 * run, which has five minutes for everything, and it now has more places
 * to look than it did; past this it gives up with what it has verified.
 */
const DISCOVERY_MS = 90_000;

async function fetchText(url: string, deadline = Infinity): Promise<string | null> {
  const left = deadline - Date.now();
  if (left < 2_000) return null;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.min(20_000, left)),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Community name variants to match against URLs: with and without the
 * site-area prefix ("Waterside - Wild Blue" → wild-blue), dashless too. */
function nameKeys(communityName: string): string[] {
  const parts = communityName.split(/\s*-\s*/);
  const bases = [communityName, parts[parts.length - 1]];
  const keys = new Set<string>();
  for (const b of bases) {
    const k = normKey(b);
    if (k.length >= 4) {
      keys.add(k);
      keys.add(k.replace(/-/g, ""));
    }
  }
  return [...keys];
}

/**
 * Keys for where the site is ("Lakewood Ranch" → lakewood-ranch), so a
 * builder with a Monterey in California and one at Lakewood Ranch gives
 * the Florida page (2026-09-20: Toll's short /regency/Monterey-CA outscored
 * /luxury-homes-for-sale/Florida/Monterey-at-Lakewood-Ranch on length alone).
 */
function regionKeys(regionHints: string[]): string[] {
  return [...new Set(regionHints.flatMap((h) => nameKeys(h)))];
}

/** Pages that are about a community rather than of it: news, stories, blog posts. */
const ARTICLE_PATH = /\/(?:blog|news|stories|story|press|events?|articles?|media|careers?|reviews?|testimonials?|videos?)(?:\/|$)|\/20\d\d\//i;

/** Path words that say a page lists homes. */
const LISTING_PATH = /\/(?:communit(?:y|ies)|neighborhoods?|new-homes|homes|find-your-home|locations?|where-we-build)(?:\/|$)/i;

function score(url: string, keys: string[], region: string[] = []): number {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return 0;
  }
  if (ARTICLE_PATH.test(path)) return 0;
  const u = normKey(url);
  const segments = path.split("/").map(normKey).filter(Boolean);
  let best = 0;
  for (const k of keys) {
    if (!u.includes(k)) continue;
    let s = k.length * 10 - url.length / 20;
    // The words around the name in the part of the address that holds it:
    // "boca-royale" is the community, "veteran-feels-at-home-at-boca-royale"
    // is a story about someone in it.
    const holder = segments.find((seg) => seg.includes(k) || seg.replace(/-/g, "").includes(k));
    if (holder) {
      const extra = holder.replace(k, "").split("-").filter((w) => w && !/^(at|the|of|in|by|community|homes?|new|fl|florida)$/.test(w)).length;
      s -= extra * 15;
      if (holder === k || holder.replace(/-/g, "") === k) s += 20;
    }
    best = Math.max(best, s);
  }
  if (best <= 0) return 0;
  if (LISTING_PATH.test(path)) best += 10;
  // A page in the site's own market outranks any other page of the name.
  if (region.some((r) => u.includes(r))) best += 100;
  return best;
}

/** The candidate URLs for a community, best first: named for it, and in the site's market where the builder has several of the name. */
export function rankCandidates(urls: string[], communityName: string, regionHints: string[] = []): string[] {
  const keys = nameKeys(communityName);
  const region = regionKeys(regionHints);
  const scored = new Map<string, number>();
  for (const url of urls) {
    const s = score(url, keys, region);
    if (s > 0) scored.set(url, Math.max(scored.get(url) ?? 0, s));
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

/** What a page of homes for sale talks about. */
const HOME_WORDS = [
  /floor ?plans?/,
  /quick move|move-in ready|move in ready|available homes|homes? for sale|inventory/,
  /sq\.? ?ft|square f(?:ee|oo)t/,
  /\bbed(?:room)?s?\b/,
  /\bbath(?:room)?s?\b/,
  /\$\s?\d{3},\d{3}|priced from|starting (?:from|at)|from the \$?\d/,
  /\bgarages?\b/,
  /home ?designs?|\bmodels?\b|\bplans\b/,
];

/**
 * Whether a page reads like a page of homes: several of the things such a
 * page talks about. A news story that names the community names perhaps
 * one of them. A page that draws itself after loading carries none of its
 * words, but its scripts usually carry them anyway. Exported for tests.
 */
export function readsLikeHomes(lowerHtml: string): boolean {
  return HOME_WORDS.filter((re) => re.test(lowerHtml)).length >= 3;
}

/**
 * Whether a page is the community's own: it names the community, and,
 * where the site's market is known, the market too (in the page or in the
 * URL), so a same-named community elsewhere is passed over.
 */
export function pageIsCommunity(url: string, html: string, communityName: string, regionHints: string[] = []): boolean {
  const lower = html.toLowerCase();
  const nameParts = communityName.split(/\s*-\s*/);
  const shortName = nameParts[nameParts.length - 1].toLowerCase();
  if (!lower.includes(shortName)) return false;
  if (!readsLikeHomes(lower)) return false;
  if (!regionHints.length) return true;
  const u = normKey(url);
  return regionHints.some((h) => lower.includes(h.toLowerCase())) || regionKeys(regionHints).some((r) => u.includes(r));
}

async function sitemapUrls(baseUrl: string, keys: string[] = [], deadline = Infinity): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const urls: string[] = [];
  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const xml = await fetchText(origin + path, deadline);
    if (!xml) continue;
    let locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (locs.length && locs.every((l) => /\.xml(\?|$)/.test(l))) {
      // A big builder splits its sitemap by kind; the communities are rarely
      // in the first four (posts, pages, ...).
      const useful = (l: string) =>
        keys.some((k) => normKey(l).includes(k)) ? 2 : /communit|neighborhood|location|home|plan|model|product/i.test(l) ? 1 : 0;
      const children = [...locs].sort((a, b) => useful(b) - useful(a)).slice(0, 8);
      locs = [];
      for (const child of children) {
        const c = await fetchText(child, deadline);
        if (c) locs.push(...[...c.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]));
      }
    }
    if (locs.length) return locs;
  }
  return urls;
}

/** Links on a page, made absolute and kept to the builder's own site. */
function linksOn(html: string, pageUrl: string): string[] {
  const origin = new URL(pageUrl).hostname.replace(/^www\./, "");
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], pageUrl);
      if (u.hostname.replace(/^www\./, "") === origin) out.add(u.href.split("?")[0]);
    } catch {
      // not a link
    }
  }
  return [...out];
}

export async function discoverCommunityUrl(
  builder: { base_url: string | null; engine_config: Record<string, unknown> | null },
  communityName: string,
  /** Where the site is ("Lakewood Ranch"): a page in that market wins over a same-named community elsewhere. */
  regionHints: string[] = [],
  /** Told each step, for a person working out why nothing was found (the connection check). */
  trace: (line: string) => void = () => {}
): Promise<string | null> {
  if (!builder.base_url) {
    trace("no base URL for the builder");
    return null;
  }
  const keys = nameKeys(communityName);
  const region = regionKeys(regionHints);
  const candidates = new Map<string, number>();
  const tried = new Set<string>();
  const deadline = Date.now() + DISCOVERY_MS;
  const get = (url: string) => fetchText(url, deadline);

  const addCandidates = (urls: string[]) => {
    for (const url of urls) {
      const s = score(url, keys, region);
      if (s > 0) candidates.set(url, Math.max(candidates.get(url) ?? 0, s));
    }
  };

  // Verify the best untried candidates: the page must be the community's own.
  const verify = async (limit: number): Promise<string | null> => {
    const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
    trace(`${candidates.size} candidates; best: ${ranked.slice(0, 6).map((u) => `${u} (${Math.round(candidates.get(u)!)})`).join(" , ") || "none"}`);
    for (const url of ranked.filter((u) => !tried.has(u)).slice(0, limit)) {
      tried.add(url);
      const html = await get(url);
      if (!html) {
        trace(`  ${url}: would not load`);
        continue;
      }
      if (pageIsCommunity(url, html, communityName, regionHints)) {
        logger.info("Discovered community URL", { communityName, url });
        trace(`  ${url}: taken`);
        return url;
      }
      const lower = html.toLowerCase();
      const shortName = communityName.split(/\s*-\s*/).pop()!.toLowerCase();
      trace(`  ${url}: passed over (${!lower.includes(shortName) ? "does not name the community" : !readsLikeHomes(lower) ? "does not read like homes for sale" : "not in the site's market"}; ${html.length} chars)`);
      logger.info("Skipped a page that is not the community's own", { communityName, url });
    }
    return null;
  };

  // 1. Audit-stored candidates (community pages + sitemap matches), and the
  //    links on the builder's area pages the audit found — an area page
  //    lists its communities without naming any of them in its own address.
  const cfg = builder.engine_config ?? {};
  const stored = [...((cfg.candidateUrls as string[]) ?? []), ...((cfg.sitemapMatches as string[]) ?? [])];
  addCandidates(stored);
  const hubs = stored.filter((u) => score(u, keys, region) === 0 && !ARTICLE_PATH.test(u)).slice(0, 4);
  for (const hub of hubs) {
    const html = await get(hub);
    const links = html ? linksOn(html, hub) : [];
    trace(`area page ${hub}: ${html ? `${links.length} links` : "would not load"}`);
    addCandidates(links);
  }
  const fromStored = await verify(4);
  if (fromStored) return fromStored;

  // 2. Sitemap sweep.
  const mapped = await sitemapUrls(builder.base_url, keys, deadline);
  trace(`sitemap: ${mapped.length} addresses`);
  addCandidates(mapped);
  const fromSitemap = await verify(4);
  if (fromSitemap) return fromSitemap;

  // 3. Homepage links, and the links on any page of them that looks like a
  //    list of communities.
  const home = await get(builder.base_url);
  if (home) {
    const links = linksOn(home, builder.base_url);
    trace(`homepage: ${links.length} links`);
    addCandidates(links);
    const lists = links.filter((u) => /communit|where-we-build|locations?|find-(?:a|your)-home|new-homes/i.test(u) && score(u, keys, region) === 0).slice(0, 4);
    for (const list of lists) {
      const html = await get(list);
      const found = html ? linksOn(html, list) : [];
      trace(`list page ${list}: ${html ? `${found.length} links` : "would not load"}`);
      addCandidates(found);
    }
  } else {
    trace("homepage would not load");
  }
  const last = await verify(4);
  if (!last) trace(Date.now() > deadline ? "ran out of time" : "nothing verified");
  return last;
}
