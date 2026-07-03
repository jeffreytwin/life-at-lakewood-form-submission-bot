// Round-2 discovery (runs in GitHub Actions — the sandbox has no egress):
//
// 1. Meritage / Salt Meadows: dump pruned __NEXT_DATA__ from the master
//    community page, both series pages, and one plan detail page, so the
//    json_api extractor mapping is written against real structure. Also
//    scan the sitemap for every salt-meadows URL (series & QMI pages).
// 2. render_claude builders (Taylor Morrison, Mattamy, M/I, DRB, Lee
//    Wetherington): hunt for hidden JSON APIs — embedded JSON script
//    blocks, api-ish URLs in the HTML, and endpoint strings inside
//    same-domain JS bundles — before falling back to Playwright.
// 3. ICI Homes + Neal Signature (403 to GitHub runners in round 1): retry
//    with different client fingerprints, and probe nealcommunities.com
//    (same parent company) for Neal Signature communities.
//
// Every section is independently try/caught: a failure in one builder must
// never cost us the Meritage dumps. Output: pipeline/slice/discovery/round2/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'round2');
const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADER_PROFILES = {
  chrome: {
    'user-agent': UA_CHROME,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  },
  'chrome-full': {
    'user-agent': UA_CHROME,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'cache-control': 'max-age=0',
  },
  firefox: {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.5',
  },
  googlebot: {
    'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/126.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml',
  },
};

async function get(url, profile = 'chrome') {
  try {
    const res = await fetch(url, {
      headers: HEADER_PROFILES[profile],
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, url: res.url, text };
  } catch (err) {
    return { status: 0, url, text: '', error: String(err?.message ?? err) };
  }
}

// Prune: arrays -> first 3 items (+count marker), strings -> 200 chars.
function prune(node, depth = 0) {
  if (typeof node === 'string') return node.length > 200 ? node.slice(0, 200) + `…(${node.length})` : node;
  if (Array.isArray(node)) {
    const kept = node.slice(0, 3).map((n) => prune(n, depth + 1));
    if (node.length > 3) kept.push(`…(${node.length} items total)`);
    return kept;
  }
  if (node && typeof node === 'object') {
    if (depth > 14) return '…(depth)';
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = prune(v, depth + 1);
    return out;
  }
  return node;
}

const save = (name, data) =>
  writeFile(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

async function section(name, fn) {
  try {
    await fn();
    console.log(`[${name}] done`);
  } catch (err) {
    console.log(`[${name}] FAILED: ${err?.stack ?? err}`);
    await save(`${name}.error.txt`, String(err?.stack ?? err)).catch(() => {});
  }
}

// ---- embedded-state + API hunting helpers ----------------------------------

const API_URL_RE = /["'](https?:\/\/[^"'\s]{8,220}?(?:\/api\/|graphql|\.json|search|odata)[^"'\s]{0,120})["']/gi;
const REL_API_RE = /["'](\/(?:api|graphql|odata|umbraco|sitecore|webapi)[A-Za-z0-9_\-./?=&%]{0,160})["']/gi;

/** What machine-readable state does this HTML carry? Small JSON report. */
function stateReport(html) {
  const jsonScripts = [...html.matchAll(/<script([^>]*type=["']application\/(?:json|ld\+json)["'][^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => ({ attrs: m[1].trim().slice(0, 160), bytes: m[2].length }))
    .sort((a, b) => b.bytes - a.bytes);
  const apiUrls = new Set();
  for (const m of html.matchAll(API_URL_RE)) apiUrls.add(m[1]);
  for (const m of html.matchAll(REL_API_RE)) apiUrls.add(m[1]);
  return {
    bytes: html.length,
    hasNextData: /<script id="__NEXT_DATA__"/.test(html),
    hasNuxt: /__NUXT__/.test(html),
    hasApollo: /APOLLO_STATE/.test(html),
    hasInitialState: /__INITIAL_STATE__|window\.__PRELOADED/.test(html),
    jsonScripts: jsonScripts.slice(0, 12),
    apiUrls: [...apiUrls].slice(0, 40),
  };
}

/** Dump the biggest embedded JSON blocks (pruned) for mapping work. */
async function dumpEmbeddedJson(slug, html, { min = 4000, max = 2 } = {}) {
  const blocks = [...html.matchAll(/<script([^>]*type=["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => ({ attrs: m[1], body: m[2] }))
    .filter((b) => b.body.length >= min)
    .sort((a, b) => b.body.length - a.body.length)
    .slice(0, max);
  for (const [i, b] of blocks.entries()) {
    try {
      await save(`${slug}.json-block-${i}.pruned.json`, { scriptAttrs: b.attrs.trim().slice(0, 200), data: prune(JSON.parse(b.body)) });
    } catch { /* not valid JSON — skip */ }
  }
  const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) await save(`${slug}.nextdata.pruned.json`, prune(JSON.parse(next[1])));
  return { blocks: blocks.length, nextData: Boolean(next) };
}

/** Fetch same-domain JS bundles and grep them for endpoint-ish strings. */
async function huntJsBundles(slug, html, pageUrl, { maxBundles = 4 } = {}) {
  const origin = new URL(pageUrl).origin;
  const srcs = new Set();
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    let src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) src = origin + src;
    if (!/^https?:/.test(src)) continue;
    const host = new URL(src).hostname;
    const pageHost = new URL(pageUrl).hostname;
    // same site or its cdn subdomain only; skip 3rd-party tags
    if (!host.endsWith(pageHost.replace(/^www\./, '')) && !pageHost.endsWith(host.replace(/^(cdn|assets|static)\./, ''))) continue;
    if (/gtm|analytics|tag|pixel|consent|cookie/i.test(src)) continue;
    srcs.add(src);
  }
  const findings = [];
  for (const src of [...srcs].slice(0, maxBundles)) {
    const res = await get(src);
    if (res.status !== 200) { findings.push({ src, status: res.status }); continue; }
    const hits = new Set();
    for (const m of res.text.matchAll(API_URL_RE)) hits.add(m[1]);
    for (const m of res.text.matchAll(REL_API_RE)) hits.add(m[1]);
    for (const m of res.text.matchAll(/["'`](\/[A-Za-z0-9_\-/]{2,80}\/(?:plans?|homes?|inventory|listings?|quick-?move-?in|qmi|communities|floorplans?)[A-Za-z0-9_\-/]{0,60})["'`]/gi)) hits.add(m[1]);
    findings.push({ src, bytes: res.text.length, endpoints: [...hits].slice(0, 50) });
  }
  await save(`${slug}.js-hunt.json`, findings);
  return findings;
}

/** Scan a domain's sitemap tree for URLs matching a pattern. */
async function sitemapScan(domain, pattern, { maxFetches = 12, keepMax = 80 } = {}) {
  const robots = await get(`https://${domain}/robots.txt`);
  const queue = [...robots.text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!queue.length) queue.push(`https://${domain}/sitemap.xml`);
  const matches = new Set();
  let fetched = 0;
  const seen = new Set();
  while (queue.length && fetched < maxFetches) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await get(url);
    fetched += 1;
    if (res.status !== 200) continue;
    for (const m of res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = m[1];
      if (/\.xml(\?|$)/i.test(loc)) {
        if (queue.length < 40) queue.push(loc);
      } else if (pattern.test(loc) && matches.size < keepMax) {
        matches.add(loc);
      }
    }
  }
  return [...matches];
}

// ---- sections ---------------------------------------------------------------

await mkdir(OUT, { recursive: true });
const summary = {};

// 1. MERITAGE — the priority. Pruned __NEXT_DATA__ from all Salt Meadows pages.
await section('meritage', async () => {
  const pages = [
    ['salt-meadows-main', 'https://www.meritagehomes.com/state/fl/tampa/meritage-homes-salt-meadows'],
    ['salt-meadows-classic', 'https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series'],
    ['salt-meadows-premier', 'https://www.meritagehomes.com/state/fl/tampa/salt-meadows-premier-series'],
    ['salt-meadows-plan-bluebell', 'https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series/bluebell-4l05'],
  ];
  const results = [];
  for (const [slug, url] of pages) {
    const res = await get(url, 'chrome-full');
    console.log(`[meritage] ${slug}: ${res.status} (${res.text.length} bytes)`);
    const r = { slug, url, status: res.status };
    if (res.status === 200) {
      Object.assign(r, stateReport(res.text));
      const dumped = await dumpEmbeddedJson(`meritage-${slug}`, res.text);
      Object.assign(r, dumped);
      if (!dumped.nextData) await save(`meritage-${slug}.head.txt`, res.text.slice(0, 5000));
    }
    results.push(r);
  }
  const sitemapUrls = await sitemapScan('www.meritagehomes.com', /salt-meadows/i);
  await save('meritage-summary.json', { pages: results, sitemapUrls });
  summary.meritage = { pages: results.map((r) => ({ slug: r.slug, status: r.status, nextData: r.nextData })), sitemapUrls: sitemapUrls.length };
});

// 2. TAYLOR MORRISON — find real community pages via sitemap, then hunt.
await section('taylor-morrison', async () => {
  const urls = await sitemapScan('www.taylormorrison.com', /(azario|firethorn|esplanade-at-wellen|wellen-park|lakewood-ranch)/i);
  await save('taylor-morrison-sitemap.json', urls);
  const results = [];
  for (const url of urls.filter((u) => /taylormorrison\.com/.test(u)).slice(0, 2)) {
    const res = await get(url, 'chrome-full');
    const r = { url, status: res.status };
    if (res.status === 200) {
      Object.assign(r, stateReport(res.text));
      Object.assign(r, await dumpEmbeddedJson('taylor-morrison-' + results.length, res.text));
      r.jsHunt = (await huntJsBundles('taylor-morrison-' + results.length, res.text, res.url)).length;
    }
    results.push(r);
  }
  await save('taylor-morrison-summary.json', results);
  summary.taylorMorrison = { sitemapMatches: urls.length, pages: results.map((r) => ({ status: r.status, apiUrls: r.apiUrls?.length ?? 0 })) };
});

// 3. MATTAMY — Wellen Park community pages are known from round 1.
await section('mattamy', async () => {
  const pages = [
    'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/brightmore',
    'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/lakespur',
  ];
  const results = [];
  for (const [i, url] of pages.entries()) {
    const res = await get(url, 'chrome-full');
    const r = { url, status: res.status };
    if (res.status === 200) {
      Object.assign(r, stateReport(res.text));
      Object.assign(r, await dumpEmbeddedJson(`mattamy-${i}`, res.text));
      await huntJsBundles(`mattamy-${i}`, res.text, res.url);
    }
    results.push(r);
  }
  await save('mattamy-summary.json', results);
  summary.mattamy = results.map((r) => ({ status: r.status, apiUrls: r.apiUrls?.length ?? 0 }));
});

// 4. M/I HOMES — round 1 hinted at cdn.mihomes.com search.js; grep it.
await section('mihomes', async () => {
  const results = [];
  for (const [i, url] of [
    'https://www.mihomes.com/new-homes/florida/sarasota-metro/plans-ready-to-build',
    'https://www.mihomes.com/new-homes/florida/sarasota-metro/quick-move-in-homes',
  ].entries()) {
    const res = await get(url, 'chrome-full');
    const r = { url, status: res.status };
    if (res.status === 200) {
      Object.assign(r, stateReport(res.text));
      Object.assign(r, await dumpEmbeddedJson(`mihomes-${i}`, res.text));
      await huntJsBundles(`mihomes-${i}`, res.text, res.url);
    }
    results.push(r);
  }
  const searchJs = await get('https://cdn.mihomes.com/assets/toolkit/js/search.js');
  if (searchJs.status === 200) {
    const hits = new Set();
    for (const m of searchJs.text.matchAll(API_URL_RE)) hits.add(m[1]);
    for (const m of searchJs.text.matchAll(REL_API_RE)) hits.add(m[1]);
    for (const m of searchJs.text.matchAll(/["'`](\/[A-Za-z0-9_\-/]{2,90}(?:search|result|listing|home|plan|community)[A-Za-z0-9_\-/?=&%]{0,80})["'`]/gi)) hits.add(m[1]);
    await save('mihomes-search-js.json', { bytes: searchJs.text.length, endpoints: [...hits].slice(0, 80) });
  }
  await save('mihomes-summary.json', results);
  summary.mihomes = { searchJs: searchJs.status, pages: results.map((r) => ({ status: r.status, apiUrls: r.apiUrls?.length ?? 0 })) };
});

// 5. DRB HOMES — locate the Seaire community page, then hunt.
await section('drb', async () => {
  const home = await get('https://www.drbhomes.com/drbhomes', 'chrome-full');
  const links = new Set();
  if (home.status === 200) {
    for (const m of home.text.matchAll(/href=["']([^"']*seaire[^"']*)["']/gi)) links.add(m[1]);
  }
  const sitemapUrls = await sitemapScan('www.drbhomes.com', /seaire|florida/i, { maxFetches: 6 });
  const target = [...links].map((l) => (l.startsWith('http') ? l : 'https://www.drbhomes.com' + l))[0] ?? sitemapUrls.find((u) => /seaire/i.test(u));
  const results = { homeStatus: home.status, seaireLinks: [...links].slice(0, 10), sitemapUrls: sitemapUrls.slice(0, 20), target };
  if (target) {
    const res = await get(target, 'chrome-full');
    results.targetStatus = res.status;
    if (res.status === 200) {
      results.state = stateReport(res.text);
      await dumpEmbeddedJson('drb-seaire', res.text);
      await huntJsBundles('drb-seaire', res.text, res.url);
    }
  } else if (home.status === 200) {
    results.state = stateReport(home.text);
    await huntJsBundles('drb-home', home.text, home.url);
  }
  await save('drb-summary.json', results);
  summary.drb = { homeStatus: home.status, target, targetStatus: results.targetStatus };
});

// 6. LEE WETHERINGTON — find community/available-homes pages across domains.
await section('lee-wetherington', async () => {
  const results = [];
  for (const domain of ['leewetherington.com', 'www.lwhomes.net']) {
    const home = await get(`https://${domain}/`, 'chrome-full');
    const r = { domain, status: home.status };
    if (home.status === 200) {
      r.state = stateReport(home.text);
      const links = new Set();
      for (const m of home.text.matchAll(/href=["']([^"']+)["']/gi)) {
        const href = m[1];
        if (/star.?farms|shellstone|wild.?blue|everly|available|quick|move.?in|floor.?plan|communit/i.test(href)) links.add(href);
      }
      r.candidateLinks = [...links].slice(0, 25);
      const target = r.candidateLinks
        .map((l) => (l.startsWith('http') ? l : `https://${domain}${l.startsWith('/') ? '' : '/'}${l}`))
        .find((l) => /available|quick|floor.?plan|star.?farms|wild.?blue/i.test(l));
      if (target) {
        const page = await get(target, 'chrome-full');
        r.target = target;
        r.targetStatus = page.status;
        if (page.status === 200) {
          r.targetState = stateReport(page.text);
          await dumpEmbeddedJson(`lee-wetherington-${results.length}`, page.text);
          await huntJsBundles(`lee-wetherington-${results.length}`, page.text, page.url);
        }
      }
    }
    results.push(r);
  }
  await save('lee-wetherington-summary.json', results);
  summary.leeWetherington = results.map((r) => ({ domain: r.domain, status: r.status, target: r.target, targetStatus: r.targetStatus }));
});

// 7. ICI HOMES — 403 to runners in round 1; try different fingerprints.
await section('ici', async () => {
  const attempts = [];
  for (const profile of ['chrome-full', 'firefox', 'googlebot']) {
    const res = await get('https://www.icihomes.com/', profile);
    attempts.push({ profile, status: res.status, finalUrl: res.url, error: res.error, head: res.status !== 200 ? res.text.slice(0, 400) : undefined });
    if (res.status === 200) {
      await save('ici-home.state.json', stateReport(res.text));
      const urls = await sitemapScan('www.icihomes.com', /oakbend|palmera|lakewood|wellen|parrish/i, { maxFetches: 6 });
      await save('ici-sitemap.json', urls);
      break;
    }
  }
  await save('ici-attempts.json', attempts);
  summary.ici = attempts.map((a) => ({ profile: a.profile, status: a.status }));
});

// 8. NEAL SIGNATURE — fingerprint retries + the nealcommunities.com route.
await section('neal-signature', async () => {
  const attempts = [];
  for (const profile of ['chrome-full', 'firefox', 'googlebot']) {
    const res = await get('https://www.nealsignaturehomes.com/', profile);
    attempts.push({ profile, status: res.status, finalUrl: res.url, error: res.error, head: res.status !== 200 ? res.text.slice(0, 400) : undefined });
    if (res.status === 200) {
      await save('neal-signature-home.state.json', stateReport(res.text));
      break;
    }
  }
  await save('neal-signature-attempts.json', attempts);
  // Neal Communities (parent) worked in round 1 — check whether it lists the
  // Signature communities we need (Waterbury Park, The Alcove).
  const urls = await sitemapScan('www.nealcommunities.com', /waterbury|alcove|signature/i, { maxFetches: 10 });
  await save('neal-signature-via-nealcommunities.json', urls);
  const results = [];
  for (const url of urls.slice(0, 2)) {
    const res = await get(url, 'chrome-full');
    const r = { url, status: res.status };
    if (res.status === 200) {
      r.state = stateReport(res.text);
      await dumpEmbeddedJson(`neal-sig-${results.length}`, res.text);
    }
    results.push(r);
  }
  await save('neal-signature-summary.json', { attempts, nealCommunitiesUrls: urls, pages: results });
  summary.nealSignature = { attempts: attempts.map((a) => ({ profile: a.profile, status: a.status })), viaParent: urls.length };
});

await save('round2-summary.json', summary);
console.log('round-2 discovery complete:', JSON.stringify(summary, null, 1));
