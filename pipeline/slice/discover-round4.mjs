// Round-4 discovery (GitHub Actions; no egress from the dev sandbox).
// Round 3 learned: Meritage 403'd the thin header profile (round 2's full
// Chrome profile worked — retry with it + polite delays); Mattamy is
// Sitecore JSS with graphQLEndpoint /api/mattamy-homes and a /search page
// that likely server-renders complete QMI/plan card lists; Taylor Morrison
// components fetch GET {origin}/api/sitecore/{controller}/{action}; M/I has
// /api/v1/community/hometypes/{id} but community ids/urls weren't on the
// metro listing; Lee Wetherington's real site is lwhomes.com (WordPress,
// wp-json enabled); DRB is a fully client-rendered SPA whose bundles were
// not on the page host. This round closes each gap.
// Output: pipeline/slice/discovery/round4/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'round4');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// The full profile that got Meritage 200s in round 2.
const FULL_HEADERS = {
  'user-agent': UA,
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
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { ...FULL_HEADERS, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, url: res.url, text, type: res.headers.get('content-type') ?? '' };
  } catch (err) {
    return { status: 0, url, text: '', type: '', error: String(err?.message ?? err) };
  }
}

function prune(node, depth = 0, arrayCap = 4) {
  if (typeof node === 'string') return node.length > 220 ? node.slice(0, 220) + `…(${node.length})` : node;
  if (Array.isArray(node)) {
    const kept = node.slice(0, arrayCap).map((n) => prune(n, depth + 1, arrayCap));
    if (node.length > arrayCap) kept.push(`…(${node.length} items total)`);
    return kept;
  }
  if (node && typeof node === 'object') {
    if (depth > 18) return '…(depth)';
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = prune(v, depth + 1, arrayCap);
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

function grepEndpoints(js, contextChars = 260) {
  const found = [];
  const seen = new Set();
  const patterns = [
    /["'`](https?:\/\/[^"'`\s]{8,200}?(?:api|graphql|search|odata)[^"'`\s]{0,100})["'`]/gi,
    /["'`](\/(?:api|graphql|sitecore|sxa|webapi|umbraco|wp-json)[A-Za-z0-9_\-./?=&{}$]{2,160})["'`]/gi,
    /controller\s*[:=]\s*["']([A-Za-z0-9_-]{3,60})["']\s*,\s*action\s*[:=]\s*["']([A-Za-z0-9_-]{3,60})["']/gi,
    /sc_apikey[=:]\s*["'{]?([A-Fa-f0-9-]{8,40})/gi,
  ];
  for (const re of patterns) {
    for (const m of js.matchAll(re)) {
      const key = m[2] ? `${m[1]}/${m[2]}` : m[1];
      if (seen.has(key) || found.length > 100) continue;
      seen.add(key);
      const start = Math.max(0, m.index - contextChars);
      found.push({ hit: key, context: js.slice(start, m.index + m[0].length + contextChars) });
    }
  }
  return found;
}

/** All script srcs on a page (ANY host), largest-app-bundle heuristics first. */
function scriptSrcs(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const srcs = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    let src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) src = origin + src;
    if (!/^https?:/.test(src)) continue;
    if (/gtm|googletag|analytics|pixel|consent|cookie|recaptcha|youtube|facebook|hotjar|clarity|mouseflow/i.test(src)) continue;
    if (!srcs.includes(src)) srcs.push(src);
  }
  return srcs;
}

await mkdir(OUT, { recursive: true });
const summary = {};

// 1. MERITAGE — round-2 headers + polite pacing; bundle grep + API probes.
await section('meritage', async () => {
  await sleep(2000);
  const page = await get('https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series');
  await save('meritage-page-status.json', { status: page.status, url: page.url, bytes: page.text.length });
  if (page.status !== 200) {
    // One retry after a longer pause — round 3 may have tripped a rate limit.
    await sleep(15_000);
    const retry = await get('https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series');
    await save('meritage-page-status.json', { first: page.status, retry: retry.status, url: retry.url, bytes: retry.text.length });
    if (retry.status !== 200) throw new Error(`series page: ${page.status} then ${retry.status}`);
    page.text = retry.text; page.url = retry.url; page.status = retry.status;
  }
  const srcs = scriptSrcs(page.text, page.url).filter((s) => /meritagehomes|\/_next\//i.test(s));
  const allHits = [];
  for (const src of srcs.slice(0, 16)) {
    await sleep(400);
    const res = await get(src, { 'sec-fetch-dest': 'script', 'sec-fetch-mode': 'no-cors', accept: '*/*' });
    if (res.status !== 200) { allHits.push({ src, status: res.status }); continue; }
    const hits = grepEndpoints(res.text);
    if (hits.length) allHits.push({ src, hits });
  }
  await save('meritage-bundle-grep.json', allHits);
  const candidates = new Set();
  for (const { hits } of allHits) {
    for (const { hit } of hits ?? []) {
      if (/sitecorecontenthub|\.(png|jpe?g|svg|css|woff)|google|matterport/i.test(hit)) continue;
      if (/plan|community|home|search|qmi|inventory|graphql|layout/i.test(hit)) {
        const url = hit.startsWith('http') ? hit : hit.startsWith('/') ? `https://www.meritagehomes.com${hit}` : null;
        if (url && !/[{$]/.test(url)) candidates.add(url);
      }
    }
  }
  const probes = [];
  for (const url of [...candidates].slice(0, 10)) {
    await sleep(800);
    const res = await get(url, { accept: 'application/json', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' });
    const isJson = /json/i.test(res.type) || /^[[{]/.test(res.text.trim());
    probes.push({ url, status: res.status, type: res.type.slice(0, 60), json: isJson, bytes: res.text.length });
    if (res.status === 200 && isJson) {
      try { await save(`meritage-probe-${probes.length - 1}.pruned.json`, prune(JSON.parse(res.text), 0, 5)); } catch {}
    }
  }
  await save('meritage-probes.json', probes);
  summary.meritage = { page: page.status, bundles: srcs.length, candidates: candidates.size, probes: probes.map((p) => ({ url: p.url.slice(0, 80), status: p.status, json: p.json })) };
});

// 2. MATTAMY — does /search server-render the full QMI/plan card lists?
await section('mattamy-search', async () => {
  const results = [];
  for (const [slug, url] of [
    ['qmi-brightmore', 'https://mattamyhomes.com/search?productType=qmi&metro=Sarasota-Bradenton&country=USA&community=Brightmore%20at%20Wellen%20Park&hideMap=true'],
    ['model-brightmore', 'https://mattamyhomes.com/search?productType=model&metro=Sarasota-Bradenton&country=USA&community=Brightmore%20at%20Wellen%20Park&hideMap=true'],
    ['all-wellen', 'https://mattamyhomes.com/search?metro=Sarasota-Bradenton&country=USA&hideMap=true'],
  ]) {
    const page = await get(url);
    const r = { slug, url, status: page.status, bytes: page.text.length };
    if (page.status === 200) {
      const m = page.text.match(/<script[^>]*id=["']__JSS_STATE__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (m) {
        r.jssBytes = m[1].length;
        // Raw only for the first; prune the rest to keep the commit small.
        if (slug === 'qmi-brightmore') await save(`mattamy-search-${slug}.jss-state.json`, m[1]);
        else await save(`mattamy-search-${slug}.jss-state.pruned.json`, prune(JSON.parse(m[1]), 0, 6));
      }
    }
    results.push(r);
    await sleep(700);
  }
  await save('mattamy-search-summary.json', results);
  summary.mattamySearch = results.map(({ slug, status, jssBytes }) => ({ slug, status, jssBytes }));
});

// 3. TAYLOR MORRISON — find the controller/action pairs its floor-plans
//    page calls, then probe them.
await section('taylor-morrison', async () => {
  const page = await get('https://www.taylormorrison.com/fl/tampa/parrish/firethorn/floor-plans');
  if (page.status !== 200) throw new Error(`floor-plans page: ${page.status}`);
  const srcs = scriptSrcs(page.text, page.url).filter((s) => /taylormorrison/i.test(s));
  const controllerHits = [];
  const otherHits = [];
  for (const src of srcs.slice(0, 16)) {
    const res = await get(src, { accept: '*/*' });
    if (res.status !== 200) continue;
    for (const h of grepEndpoints(res.text, 300)) {
      (h.hit.includes('/') && !h.hit.startsWith('/') && !h.hit.startsWith('http') ? controllerHits : otherHits).push({ src: src.slice(-60), ...h });
    }
  }
  await save('taylor-controller-grep.json', { controllerHits: controllerHits.slice(0, 40), otherHits: otherHits.slice(0, 40) });
  // Probe every controller/action pair via the documented fetchData shape.
  const probes = [];
  const pairs = [...new Set(controllerHits.map((h) => h.hit))].slice(0, 12);
  for (const pair of pairs) {
    const url = `https://www.taylormorrison.com/api/sitecore/${pair}`;
    const res = await get(url, { accept: 'application/json', referer: page.url });
    const isJson = /json/i.test(res.type) || /^[[{]/.test(res.text.trim());
    probes.push({ pair, status: res.status, json: isJson, bytes: res.text.length });
    if (res.status === 200 && isJson && res.text.length > 50) {
      try { await save(`taylor-probe-${probes.length - 1}.pruned.json`, { pair, data: prune(JSON.parse(res.text), 0, 5) }); } catch {}
    }
    await sleep(500);
  }
  await save('taylor-probes.json', probes);
  summary.taylorMorrison = { bundles: srcs.length, pairs, probes: probes.map((p) => ({ pair: p.pair, status: p.status, json: p.json, bytes: p.bytes })) };
});

// 4. M/I HOMES — find real community URLs + ids, then hit the hometypes API.
await section('mihomes', async () => {
  const listing = await get('https://www.mihomes.com/new-homes/florida/sarasota-metro/communities');
  const links = new Set();
  if (listing.status === 200) {
    for (const m of listing.text.matchAll(/href=["'](\/new-homes\/florida\/[^"'?#]{5,120})["']/gi)) {
      const href = m[1];
      if (!/sarasota-metro\/(communities|plans-ready-to-build|quick-move-in-homes)$/.test(href)) links.add(href);
    }
  }
  await save('mihomes-links.json', [...links].slice(0, 60));
  const probes = [];
  const pages = [];
  for (const href of [...links].slice(0, 3)) {
    const page = await get(`https://www.mihomes.com${href}`);
    const r = { href, status: page.status };
    if (page.status === 200) {
      const ids = new Set();
      for (const m of page.text.matchAll(/(?:communityId|community_id|community-id|"id")["']?\s*[:=]\s*["']?(\d{2,7})\b/gi)) ids.add(m[1]);
      r.ids = [...ids].slice(0, 12);
      const propBlocks = [...page.text.matchAll(/data-(?:react-)?props=["']([^"']{40,4000})["']/gi)].map((m) => m[1].slice(0, 500));
      if (propBlocks.length) await save(`mihomes-props-${pages.length}.txt`, propBlocks.join('\n\n----\n\n'));
      for (const id of [...ids].slice(0, 4)) {
        const api = await get(`https://www.mihomes.com/api/v1/community/hometypes/${id}`, { accept: 'application/json' });
        const isJson = /json/i.test(api.type) || /^[[{]/.test(api.text.trim());
        probes.push({ id, status: api.status, json: isJson, bytes: api.text.length });
        if (api.status === 200 && isJson && api.text.length > 50) {
          try { await save(`mihomes-hometypes-${id}.pruned.json`, prune(JSON.parse(api.text), 0, 6)); } catch {}
        }
        await sleep(400);
      }
    }
    pages.push(r);
  }
  await save('mihomes-summary.json', { listing: listing.status, links: [...links].slice(0, 30), pages, probes });
  summary.mihomes = { links: links.size, pages, probes };
});

// 5. LEE WETHERINGTON — lwhomes.com is WordPress; enumerate wp-json CPTs.
await section('lwhomes', async () => {
  const types = await get('https://lwhomes.com/wp-json/wp/v2/types', { accept: 'application/json' });
  const out = { typesStatus: types.status };
  let names = [];
  if (types.status === 200) {
    try {
      const parsed = JSON.parse(types.text);
      names = Object.keys(parsed);
      await save('lwhomes-types.json', Object.fromEntries(names.map((n) => [n, { rest_base: parsed[n].rest_base, name: parsed[n].name }])));
    } catch {}
  }
  const interesting = names.length
    ? names.filter((n) => /home|plan|communit|model|property|listing|quick/i.test(n))
    : ['available-homes', 'floorplans', 'floor-plans', 'communities', 'homes'];
  const probes = [];
  for (const t of interesting.slice(0, 6)) {
    const restBase = t; // rest_base usually equals the type slug
    const res = await get(`https://lwhomes.com/wp-json/wp/v2/${restBase}?per_page=20`, { accept: 'application/json' });
    const isJson = /json/i.test(res.type) || /^[[{]/.test(res.text.trim());
    probes.push({ type: t, status: res.status, json: isJson, bytes: res.text.length });
    if (res.status === 200 && isJson && res.text.length > 100) {
      try { await save(`lwhomes-${restBase}.pruned.json`, prune(JSON.parse(res.text), 0, 4)); } catch {}
    }
    await sleep(400);
  }
  out.probes = probes;
  await save('lwhomes-summary.json', out);
  summary.lwhomes = out;
});

// 6. DRB — the SPA bundles live off-host; fetch them from wherever they are.
await section('drb', async () => {
  const page = await get('https://www.drbhomes.com/drbhomes/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire/overview');
  if (page.status !== 200) throw new Error(`overview: ${page.status}`);
  const srcs = scriptSrcs(page.text, page.url);
  await save('drb-script-srcs.json', srcs.slice(0, 30));
  const allHits = [];
  for (const src of srcs.slice(0, 8)) {
    const res = await get(src, { accept: '*/*' });
    if (res.status !== 200) { allHits.push({ src, status: res.status }); continue; }
    const hits = grepEndpoints(res.text);
    if (hits.length) allHits.push({ src: src.slice(-80), bytes: res.text.length, hits: hits.slice(0, 30) });
  }
  await save('drb-bundle-grep.json', allHits);
  summary.drb = { scripts: srcs.length, bundlesWithHits: allHits.filter((h) => h.hits).length };
});

// 7. NEAL SIGNATURE — one cheap wp-json probe through the 403 wall.
await section('neal-signature', async () => {
  const probes = [];
  for (const url of [
    'https://www.nealsignaturehomes.com/wp-json/',
    'https://www.nealsignaturehomes.com/robots.txt',
    'https://nealsignaturehomes.com/wp-json/wp/v2/types',
  ]) {
    const res = await get(url, { accept: 'application/json' });
    probes.push({ url, status: res.status, bytes: res.text.length, head: res.status !== 200 ? res.text.slice(0, 200) : undefined });
    if (res.status === 200 && res.text.length > 100) {
      await save(`neal-sig-probe-${probes.length - 1}.txt`, res.text.slice(0, 4000));
    }
    await sleep(500);
  }
  await save('neal-signature-probes.json', probes);
  summary.nealSignature = probes.map(({ url, status }) => ({ url: url.slice(-40), status }));
});

await save('round4-summary.json', summary);
console.log('round-4 discovery complete:', JSON.stringify(summary, null, 1));
