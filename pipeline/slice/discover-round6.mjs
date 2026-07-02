// Round-6 discovery (GitHub Actions). Round 5 (Playwright) found every
// remaining data source; this round captures the request shapes and tests
// whether plain Node fetch can call them (the nightly runs on Vercel with
// Node fetch, so replayability decides json_api vs Playwright-in-Actions):
//
// - Meritage: plan grid + QMIs come from discover.sitecorecloud.io (POST)
//   and apim-…azure-api.net/cache/sf/web-lots (GET). Capture the requests
//   on the master + classic pages, then replay both with Node fetch.
// - Mattamy: plans list lives on /search?productType=plan&… which queries
//   the Sitecore GraphQL endpoint /api/mattamy-homes. Capture the GraphQL
//   POST body, replay with Node fetch.
// - Taylor Morrison: 37 plans render with no data XHR → the dataset is in
//   an inline script (window.scData). Node-fetch the page and dump it.
// - M/I: GET /sitecore/api/ssc/MIHomes-Project-Website-Api/Search
//   (searchtype=plans|inventory) returned 500 KB in round 5. Node-fetch
//   both and dump deep prunes for the field mapping.
// - DRB: api.drbhomes.com/api/v1/public/division is open. Enumerate the
//   other public resources.
// - Lee Wetherington: lwhomes.com/listings + model-homes text samples
//   (fetch_claude prep).
// Output: pipeline/slice/discovery/round6/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.join(import.meta.dirname, 'discovery', 'round6');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function prune(node, depth = 0, arrayCap = 4) {
  if (typeof node === 'string') return node.length > 240 ? node.slice(0, 240) + `…(${node.length})` : node;
  if (Array.isArray(node)) {
    const kept = node.slice(0, arrayCap).map((n) => prune(n, depth + 1, arrayCap));
    if (node.length > arrayCap) kept.push(`…(${node.length} items total)`);
    return kept;
  }
  if (node && typeof node === 'object') {
    if (depth > 20) return '…(depth)';
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

async function nodeFetch(url, init = {}) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'user-agent': UA, accept: 'application/json, */*', ...(init.headers ?? {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, type: res.headers.get('content-type') ?? '', text };
  } catch (err) {
    return { status: 0, type: '', text: '', error: String(err?.message ?? err) };
  }
}

await mkdir(OUT, { recursive: true });
const summary = {};

// ---------- Playwright captures: Meritage + Mattamy request shapes ----------

const browser = await chromium.launch();

/** Render a page and capture matching request/response pairs. */
async function captureRequests(url, matchers, { settleMs = 6000, scroll = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();
  const captured = [];
  page.on('response', async (res) => {
    const req = res.request();
    const reqUrl = req.url();
    if (!matchers.some((m) => m.test(reqUrl))) return;
    let body = '';
    try { body = await res.text(); } catch { /* unavailable */ }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers())) {
      if (!/^(cookie|user-agent|sec-|accept-encoding)/i.test(k)) headers[k] = v.slice(0, 300);
    }
    captured.push({
      method: req.method(),
      url: reqUrl,
      headers,
      postData: req.postData()?.slice(0, 20_000) ?? null,
      status: res.status(),
      responseBytes: body.length,
      responseBody: body.slice(0, 400_000),
    });
  });
  const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
  await page.waitForTimeout(settleMs);
  if (scroll) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(3000);
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(3000);
  }
  const status = nav?.status() ?? null;
  await context.close();
  return { status, captured };
}

const MERITAGE_APIS = [/discover\.sitecorecloud\.io/i, /azure-api\.net/i];

await section('meritage-capture', async () => {
  const results = {};
  const all = [];
  for (const [slug, url] of [
    ['master', 'https://www.meritagehomes.com/state/fl/tampa/meritage-homes-salt-meadows'],
    ['classic', 'https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series'],
  ]) {
    const { status, captured } = await captureRequests(url, MERITAGE_APIS, { settleMs: 8000 });
    results[slug] = { status, calls: captured.length };
    all.push(...captured);
    // Requests (shape) and responses (pruned) separately, capped.
    await save(`meritage-${slug}.requests.json`, captured.map(({ responseBody, ...r }) => r));
    for (const [i, c] of captured.entries()) {
      if (i >= 6) break;
      try {
        await save(`meritage-${slug}.response-${i}.pruned.json`, { url: c.url, data: prune(JSON.parse(c.responseBody), 0, 6) });
      } catch {
        if (c.responseBody) await save(`meritage-${slug}.response-${i}.txt`, c.responseBody.slice(0, 6000));
      }
    }
  }
  summary.meritageCapture = results;

  // Node-fetch replay: take the first discover POST + first web-lots GET
  // just captured and re-issue them with plain fetch.
  const replays = [];
  const discover = all.find((c) => /discover\.sitecorecloud/.test(c.url) && c.method === 'POST');
  const webLots = all.find((c) => /web-lots/.test(c.url));
  if (discover) {
    const res = await nodeFetch(discover.url, {
      method: 'POST',
      headers: { 'content-type': discover.headers['content-type'] ?? 'application/json', origin: 'https://www.meritagehomes.com', referer: 'https://www.meritagehomes.com/' },
      body: discover.postData ?? undefined,
    });
    replays.push({ api: 'discover', status: res.status, bytes: res.text.length, json: /^[[{]/.test(res.text.trim()) });
    if (res.status === 200 && res.text.length > 400) {
      try { await save('meritage-replay-discover.pruned.json', prune(JSON.parse(res.text), 0, 6)); } catch {}
    }
  }
  if (webLots) {
    const res = await nodeFetch(webLots.url, {
      headers: { origin: 'https://www.meritagehomes.com', referer: 'https://www.meritagehomes.com/', ...(webLots.headers['ocp-apim-subscription-key'] ? { 'ocp-apim-subscription-key': webLots.headers['ocp-apim-subscription-key'] } : {}) },
    });
    replays.push({ api: 'web-lots', status: res.status, bytes: res.text.length, json: /^[[{]/.test(res.text.trim()) });
    if (res.status === 200 && res.text.length > 400) {
      try { await save('meritage-replay-weblots.pruned.json', prune(JSON.parse(res.text), 0, 6)); } catch {}
    }
  }
  await save('meritage-replays.json', replays);
  summary.meritageReplays = replays;
});

await section('mattamy-capture', async () => {
  const url = 'https://mattamyhomes.com/search?productType=plan&metro=Sarasota-Bradenton&country=USA&community=Brightmore%20at%20Wellen%20Park&hideMap=true';
  const { status, captured } = await captureRequests(url, [/api\/mattamy-homes/i], { settleMs: 8000 });
  await save('mattamy-search.requests.json', captured.map(({ responseBody, ...r }) => r));
  for (const [i, c] of captured.entries()) {
    if (i >= 6) break;
    try {
      await save(`mattamy-search.response-${i}.pruned.json`, { url: c.url, postData: c.postData?.slice(0, 3000), data: prune(JSON.parse(c.responseBody), 0, 6) });
    } catch {}
  }
  summary.mattamyCapture = { status, calls: captured.length };

  // Replay the first GraphQL call with Node fetch.
  const gql = captured.find((c) => c.method === 'POST' && c.postData);
  if (gql) {
    const res = await nodeFetch(gql.url, {
      method: 'POST',
      headers: { 'content-type': gql.headers['content-type'] ?? 'application/json', ...(gql.headers.sc_apikey ? { sc_apikey: gql.headers.sc_apikey } : {}), origin: 'https://mattamyhomes.com', referer: url },
      body: gql.postData,
    });
    summary.mattamyReplay = { status: res.status, bytes: res.text.length };
    if (res.status === 200 && res.text.length > 400) {
      try { await save('mattamy-replay-graphql.pruned.json', prune(JSON.parse(res.text), 0, 6)); } catch {}
    }
  }
});

await browser.close();

// ---------- Node-fetch-only sections ----------

// Taylor Morrison: dump the inline data the floor-plans page ships.
await section('taylor-inline', async () => {
  const res = await nodeFetch('https://www.taylormorrison.com/fl/tampa/parrish/firethorn/floor-plans', {
    headers: { accept: 'text/html' },
  });
  summary.taylorInline = { status: res.status, bytes: res.text.length };
  if (res.status !== 200) throw new Error(`page: ${res.status}`);
  // Inline assignments that could carry the dataset.
  const patterns = [
    [/window\.scData\s*=\s*({[\s\S]*?});?\s*<\/script>/, 'scData'],
    [/scData\s*=\s*({[\s\S]{500,}?});\s*\n/, 'scData-var'],
    [/window\.__data\s*=\s*({[\s\S]*?});?\s*<\/script>/, 'window-data'],
  ];
  let dumped = 0;
  for (const [re, label] of patterns) {
    const m = res.text.match(re);
    if (!m) continue;
    try {
      await save(`taylor-inline-${label}.pruned.json`, prune(JSON.parse(m[1]), 0, 6));
      dumped += 1;
    } catch {
      await save(`taylor-inline-${label}.raw.txt`, m[1].slice(0, 12_000));
      dumped += 1;
    }
  }
  // Fallback: locate big inline scripts mentioning floorPlan and save heads.
  if (!dumped) {
    const blocks = [...res.text.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1])
      .filter((b) => /floorPlan/i.test(b) && b.length > 2000)
      .sort((a, b) => b.length - a.length);
    summary.taylorInline.candidateScripts = blocks.length;
    for (const [i, b] of blocks.slice(0, 3).entries()) {
      await save(`taylor-inline-script-${i}.txt`, b.slice(0, 20_000));
    }
  }
  summary.taylorInline.dumped = dumped;
});

// M/I: deep dumps of the Search API for the field mapping.
await section('mihomes-api', async () => {
  const results = [];
  for (const [slug, type] of [['plans', 'plans'], ['inventory', 'inventory']]) {
    const url = `https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=${type}&typeahead_type=markets&`;
    const res = await nodeFetch(url, { headers: { referer: 'https://www.mihomes.com/new-homes/florida/sarasota-metro/plans-ready-to-build' } });
    results.push({ slug, status: res.status, bytes: res.text.length });
    if (res.status === 200 && res.text.length > 500) {
      try {
        const parsed = JSON.parse(res.text);
        await save(`mihomes-search-${slug}.pruned.json`, prune(parsed, 0, 3));
        // Also dump one full community entry (Sweetwater/Nautique/Palmera if present).
        const communities = parsed.communities ?? parsed.Communities ?? [];
        const target = communities.find?.((c) => /sweetwater|nautique|palmera/i.test(JSON.stringify(c).slice(0, 3000)));
        if (target) await save(`mihomes-search-${slug}.target-community.json`, JSON.stringify(target).slice(0, 200_000));
      } catch { /* ignore */ }
    }
  }
  await save('mihomes-api-summary.json', results);
  summary.mihomesApi = results;
});

// DRB: enumerate the public API.
await section('drb-api', async () => {
  const probes = [];
  for (const resource of [
    'division', 'community', 'communities', 'neighborhood', 'neighborhoods',
    'floorplan', 'floorplans', 'homesite', 'homesites', 'home', 'homes',
    'inventory', 'model', 'models', 'lot', 'lots', 'plan', 'plans',
  ]) {
    const url = `https://api.drbhomes.com/api/v1/public/${resource}`;
    const res = await nodeFetch(url);
    const isJson = /json/i.test(res.type) || /^[[{]/.test(res.text.trim());
    probes.push({ resource, status: res.status, json: isJson, bytes: res.text.length });
    if (res.status === 200 && isJson && res.text.length > 200) {
      try { await save(`drb-public-${resource}.pruned.json`, prune(JSON.parse(res.text), 0, 3)); } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await save('drb-api-probes.json', probes);
  summary.drbApi = probes.filter((p) => p.status === 200).map((p) => p.resource);
});

// Lee Wetherington: sample the WP pages for fetch_claude.
await section('lwhomes-pages', async () => {
  const results = [];
  for (const [slug, url] of [
    ['listings', 'https://lwhomes.com/listings/'],
    ['model-homes', 'https://lwhomes.com/model-homes/'],
    ['where-we-build', 'https://lwhomes.com/where-we-build/'],
  ]) {
    const res = await nodeFetch(url, { headers: { accept: 'text/html' } });
    const r = { slug, status: res.status, bytes: res.text.length };
    if (res.status === 200) {
      const stripped = res.text
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      r.prices = (stripped.match(/\$\s?\d{3},\d{3}/g) ?? []).length;
      r.sqfts = (stripped.match(/\b[\d,]{3,6}\s*(?:sq\.?\s*ft|sqft|square\s+feet)/gi) ?? []).length;
      r.chars = stripped.length;
      await save(`lwhomes-${slug}.text.txt`, `prices=${r.prices} sqfts=${r.sqfts} chars=${r.chars}\n\n${stripped.slice(0, 7000)}`);
      const links = new Set();
      for (const m of res.text.matchAll(/href=["'](https?:\/\/lwhomes\.com\/[^"'#?]+)["']/gi)) {
        if (/listing|home|star|shellstone|wild|everly|communit/i.test(m[1])) links.add(m[1]);
      }
      r.links = [...links].slice(0, 25);
    }
    results.push(r);
  }
  await save('lwhomes-pages-summary.json', results);
  summary.lwhomesPages = results.map(({ slug, status, prices, sqfts, chars }) => ({ slug, status, prices, sqfts, chars }));
});

await save('round6-summary.json', summary);
console.log('round-6 discovery complete:', JSON.stringify(summary, null, 1));
