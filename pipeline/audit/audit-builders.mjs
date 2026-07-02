// Phase 0 builder-website audit.
//
// For each builder in builders.json: resolve its working domain, fetch the
// homepage plus community-relevant pages (link matches and sitemap matches),
// and record extraction signals — embedded JSON state, API endpoint hints,
// visible price/sqft content — as evidence for classifying the builder as
// json_api / fetch_claude / render_claude. Runs in GitHub Actions (open
// egress); results are committed back to the branch. Plain Node, no deps.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CONFIG = JSON.parse(
  await readFile(path.join(import.meta.dirname, 'builders.json'), 'utf8'),
);
const OUT = path.join(import.meta.dirname, 'builder-audit');
const FETCH_TIMEOUT_MS = 20_000;
const MAX_CANDIDATE_PAGES = 4;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, finalUrl: res.url, html: await res.text() };
}

function signals(html) {
  const scripts = [...html.matchAll(/<script[\s\S]*?<\/script>/gi)].map((m) => m[0]).join('\n');
  const apiUrls = new Set();
  for (const m of scripts.matchAll(/["'](https?:\/\/[^"']{10,200}?(?:api|graphql|algolia|search)[^"']{0,120})["']/gi)) {
    apiUrls.add(m[1]);
    if (apiUrls.size >= 12) break;
  }
  for (const m of scripts.matchAll(/["'](\/[a-z0-9_-]{0,40}api\/[^"']{3,150})["']/gi)) {
    apiUrls.add(m[1]);
    if (apiUrls.size >= 18) break;
  }
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return {
    bytes: html.length,
    hasNextData: html.includes('__NEXT_DATA__'),
    hasNuxt: html.includes('__NUXT__'),
    hasApollo: html.includes('__APOLLO_STATE__'),
    hasLdJson: /application\/ld\+json/.test(html),
    hasAngular: /ng-version=/.test(html),
    hasWix: html.includes('wix-warmup-data'),
    apiHints: [...apiUrls],
    visiblePriceCount: (stripped.match(/\$\s?\d{3},\d{3}/g) ?? []).length,
    visibleSqftCount: (stripped.match(/sq\.?\s?ft/gi) ?? []).length,
    visibleTextChars: stripped.replace(/\s+/g, ' ').trim().length,
  };
}

function internalLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(m[1].trim(), base);
      if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
      url.search = '';
      url.hash = '';
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!out.has(url.href)) out.set(url.href, { url: url.href, text });
    } catch {
      /* ignore bad hrefs */
    }
  }
  return [...out.values()];
}

async function sitemapMatches(origin, keywords) {
  const urls = [];
  for (const smPath of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const { status, html } = await fetchPage(origin + smPath);
      if (status !== 200) continue;
      // Follow one level of sitemap index (first few child maps only).
      const locs = [...html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      let pageLocs = locs;
      if (locs.length && locs.every((l) => /\.xml(\?|$)/.test(l))) {
        pageLocs = [];
        for (const child of locs.slice(0, 5)) {
          try {
            const c = await fetchPage(child);
            if (c.status === 200) {
              pageLocs.push(...[...c.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]));
            }
          } catch {
            /* skip child map */
          }
        }
      }
      for (const loc of pageLocs) {
        if (keywords.some((k) => norm(loc).includes(k))) urls.push(loc);
        if (urls.length >= 25) break;
      }
      if (urls.length) return { found: true, path: smPath, matches: urls };
    } catch {
      /* try next sitemap path */
    }
  }
  return { found: false, matches: urls };
}

await mkdir(OUT, { recursive: true });
const summary = [];

for (const builder of CONFIG.builders) {
  const keywords = [
    ...builder.communities.map(norm),
    ...CONFIG.regionKeywords.map(norm),
  ].filter(Boolean);
  const report = { name: builder.name, slug: builder.slug, pages: [] };
  console.log(`\n=== ${builder.name} ===`);

  for (const domain of builder.domains) {
    try {
      const home = await fetchPage(`https://${domain}/`);
      if (home.status >= 400) {
        report.domainAttempts = [...(report.domainAttempts ?? []), { domain, status: home.status }];
        continue;
      }
      report.domain = domain;
      report.homeStatus = home.status;
      report.finalUrl = home.finalUrl;
      const homeSignals = signals(home.html);
      report.pages.push({ url: home.finalUrl, label: 'homepage', status: home.status, ...homeSignals });

      const origin = new URL(home.finalUrl).origin;
      const links = internalLinks(home.html, home.finalUrl);
      const candidates = links
        .filter((l) => keywords.some((k) => norm(l.url).includes(k) || norm(l.text).includes(k)))
        .slice(0, MAX_CANDIDATE_PAGES);
      report.candidateLinks = candidates;

      report.sitemap = await sitemapMatches(origin, keywords);
      const toFetch = candidates.length
        ? candidates.map((c) => c.url)
        : report.sitemap.matches.slice(0, 2);
      for (const url of toFetch.slice(0, MAX_CANDIDATE_PAGES)) {
        try {
          const page = await fetchPage(url);
          report.pages.push({ url, label: 'community-page', status: page.status, ...signals(page.html) });
        } catch (err) {
          report.pages.push({ url, label: 'community-page', error: String(err?.message ?? err) });
        }
      }
      break; // working domain found
    } catch (err) {
      report.domainAttempts = [...(report.domainAttempts ?? []), { domain, error: String(err?.message ?? err) }];
    }
  }

  if (!report.domain) report.error = 'no working domain';
  await writeFile(path.join(OUT, `${builder.slug}.json`), JSON.stringify(report, null, 2));
  const s = report.pages[0];
  summary.push({
    name: builder.name,
    slug: builder.slug,
    domain: report.domain ?? null,
    error: report.error ?? null,
    pagesFetched: report.pages.length,
    candidateLinks: report.candidateLinks?.length ?? 0,
    sitemapMatches: report.sitemap?.matches?.length ?? 0,
    homeSignals: s
      ? {
          hasNextData: s.hasNextData, hasNuxt: s.hasNuxt, hasApollo: s.hasApollo, hasWix: s.hasWix,
          apiHints: s.apiHints.length, visiblePriceCount: s.visiblePriceCount, visibleTextChars: s.visibleTextChars,
        }
      : null,
  });
  console.log(`  ${report.domain ?? 'FAILED'} | pages=${report.pages.length} candidates=${report.candidateLinks?.length ?? 0} sitemap=${report.sitemap?.matches?.length ?? 0}`);
}

await writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nDone. ${summary.filter((s) => !s.error).length}/${summary.length} builders reachable.`);
