// Phase 0 site reconnaissance.
//
// Fetches each of our live community sites' homepages, discovers internal
// pages that look build/builder/floor-plan related, fetches those too, and
// writes snapshots + link maps under pipeline/audit/snapshots/ for offline
// analysis. Runs in GitHub Actions (the dev sandbox has no egress to these
// domains). Plain Node 20, no dependencies.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SITES = ['lifeatlakewood.com', 'lifeinwellenpark.com', 'lifeatparrish.com'];

const OUT_ROOT = path.join(import.meta.dirname, 'snapshots');
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_PAGES_PER_SITE = 18;
const FETCH_TIMEOUT_MS = 30_000;

const LINK_KEYWORDS =
  /build|builder|floor|plan|village|communit|home|quick|move|model|new-construction/i;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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
  const html = await res.text();
  return { status: res.status, finalUrl: res.url, html };
}

// Extract internal links (same host or relative) with their anchor text.
function extractInternalLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Map();
  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    let href = m[1].trim();
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    url.search = '';
    url.hash = '';
    const text = m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const key = url.href;
    if (!links.has(key)) links.set(key, { url: key, text });
    else if (text && !links.get(key).text) links.get(key).text = text;
  }
  return [...links.values()];
}

function slugFor(url) {
  const p = new URL(url).pathname.replace(/\/+$/, '');
  if (!p || p === '') return 'homepage';
  return p.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'homepage';
}

async function snapshotSite(domain) {
  const siteDir = path.join(OUT_ROOT, domain);
  await mkdir(siteDir, { recursive: true });
  const results = [];
  const fetched = new Set();

  async function grab(url, label) {
    if (fetched.size >= MAX_PAGES_PER_SITE) return null;
    const normalized = url.replace(/\/+$/, '') || url;
    if (fetched.has(normalized)) return null;
    fetched.add(normalized);
    const slug = slugFor(url);
    const entry = { url, label, slug };
    try {
      const { status, finalUrl, html } = await fetchPage(url);
      entry.status = status;
      entry.finalUrl = finalUrl;
      entry.bytes = Buffer.byteLength(html);
      entry.title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const links = extractInternalLinks(html, finalUrl);
      await writeFile(path.join(siteDir, `${slug}.html`), html.slice(0, MAX_HTML_BYTES));
      await writeFile(path.join(siteDir, `${slug}.links.json`), JSON.stringify(links, null, 2));
      entry.linkCount = links.length;
      results.push(entry);
      return links;
    } catch (err) {
      entry.error = String(err?.message ?? err);
      results.push(entry);
      return null;
    }
  }

  const homeLinks = (await grab(`https://${domain}/`, 'homepage')) ?? [];
  const candidates = homeLinks.filter(
    (l) => LINK_KEYWORDS.test(l.url) || LINK_KEYWORDS.test(l.text),
  );
  // Prioritize shorter paths (top-level nav pages) over deep links.
  candidates.sort((a, b) => new URL(a.url).pathname.length - new URL(b.url).pathname.length);
  for (const link of candidates) {
    await grab(link.url, `keyword-match: ${link.text || '(no text)'}`);
  }
  return results;
}

const summary = { generatedBy: 'pipeline/audit/fetch-sites.mjs', sites: {} };
for (const domain of SITES) {
  console.log(`\n=== ${domain} ===`);
  summary.sites[domain] = await snapshotSite(domain);
  for (const r of summary.sites[domain]) {
    console.log(`  [${r.error ? 'ERR' : r.status}] ${r.url} ${r.error ?? `(${r.linkCount} links)`}`);
  }
}
await mkdir(OUT_ROOT, { recursive: true });
await writeFile(path.join(OUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\nDone. Snapshots written to pipeline/audit/snapshots/');
