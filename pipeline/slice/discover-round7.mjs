// Round-7 discovery (GitHub Actions). Closes the last unknowns per builder:
// - Taylor Morrison: the floor-plans page inlines its dataset (window.TM
//   .client.scDataStore.data, incl. floorPlanCollections) and node fetch
//   reads the page fine — dump the full object for the field mapping, for
//   both the floor-plans and available-homes pages.
// - DRB: api.drbhomes.com/api/v1/public/{plan,inventory} are open and
//   paginated; find the community resource/filters and the Biscayne
//   Landing (Seaire) community id by capturing the SPA's own API calls.
// - Mattamy: the /search?productType=plan page fired no /api/mattamy-homes
//   calls in round 6 — capture ALL JSON XHRs there to find its data source.
// - M/I: the SSC Search API errored (status 0) for node fetch in round 6 —
//   retry with the exact round-5 URL/params and record the error detail.
// - Lee Wetherington: /listings renders thin — capture its XHRs too.
// Output: pipeline/slice/discovery/round7/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.join(import.meta.dirname, 'discovery', 'round7');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function prune(node, depth = 0, arrayCap = 5) {
  if (typeof node === 'string') return node.length > 260 ? node.slice(0, 260) + `…(${node.length})` : node;
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
      headers: { 'user-agent': UA, accept: 'application/json, text/html, */*', ...(init.headers ?? {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, type: res.headers.get('content-type') ?? '', text };
  } catch (err) {
    return { status: 0, type: '', text: '', error: String(err?.cause?.message ?? err?.message ?? err) };
  }
}

/** Extract a balanced JSON object starting at the first "{" after `marker`. */
function extractJsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

await mkdir(OUT, { recursive: true });
const summary = {};

// 1. TAYLOR MORRISON — full inline dataset dumps.
await section('taylor', async () => {
  const results = [];
  for (const [slug, url] of [
    ['floor-plans', 'https://www.taylormorrison.com/fl/tampa/parrish/firethorn/floor-plans'],
    ['available-homes', 'https://www.taylormorrison.com/fl/tampa/parrish/firethorn/available-homes'],
  ]) {
    const res = await nodeFetch(url, { headers: { accept: 'text/html' } });
    const r = { slug, status: res.status, bytes: res.text.length, error: res.error };
    if (res.status === 200) {
      const raw = extractJsonAfter(res.text, 'scDataStore.data =') ?? extractJsonAfter(res.text, 'scDataStore.data=');
      r.scDataBytes = raw?.length ?? 0;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          r.scDataKeys = Object.keys(parsed).length;
          await save(`taylor-${slug}.scdata.pruned.json`, prune(parsed, 0, 6));
          // Also save any entries mentioning floorPlan in full-ish detail.
          for (const [k, v] of Object.entries(parsed)) {
            const s = JSON.stringify(v);
            if (/floorPlanCollections|availableHomes|floorPlanName/i.test(s) && s.length > 3000) {
              await save(`taylor-${slug}.entry-${k.slice(0, 24)}.pruned.json`, prune(v, 0, 8));
            }
          }
        } catch (e) {
          r.parseError = String(e).slice(0, 200);
          await save(`taylor-${slug}.scdata.raw.txt`, raw.slice(0, 30_000));
        }
      }
    }
    results.push(r);
  }
  await save('taylor-summary.json', results);
  summary.taylor = results;
});

// 2. DRB — filter probing + SPA API capture for the Seaire community id.
await section('drb-probes', async () => {
  const probes = [];
  for (const [slug, url] of [
    ['community-paged', 'https://api.drbhomes.com/api/v1/public/community?limit=25&page=1'],
    ['community-search', 'https://api.drbhomes.com/api/v1/public/community?search=seaire'],
    ['inventory-by-community', 'https://api.drbhomes.com/api/v1/public/inventory?communityId=281&limit=25'],
    ['inventory-filter', 'https://api.drbhomes.com/api/v1/public/inventory?filter.communityId=$eq:281&limit=25'],
    ['plan-by-community', 'https://api.drbhomes.com/api/v1/public/plan?communityId=281&limit=25'],
    ['homesite-params', 'https://api.drbhomes.com/api/v1/public/homesite?communityId=281&limit=25'],
  ]) {
    const res = await nodeFetch(url);
    const isJson = /json/i.test(res.type) || /^[[{]/.test(res.text.trim());
    const p = { slug, url, status: res.status, json: isJson, bytes: res.text.length, error: res.error };
    if (res.status === 200 && isJson && res.text.length > 100) {
      try {
        const parsed = JSON.parse(res.text);
        p.meta = parsed.meta;
        await save(`drb-${slug}.pruned.json`, prune(parsed, 0, 4));
      } catch {}
    } else if (res.text) {
      p.head = res.text.slice(0, 200);
    }
    probes.push(p);
    await new Promise((r) => setTimeout(r, 300));
  }
  await save('drb-probes.json', probes);
  summary.drbProbes = probes.map(({ slug, status, bytes, meta }) => ({ slug, status, bytes, total: meta?.totalItems }));
});

// 3–5. Playwright captures: DRB overview, Mattamy search, lwhomes listings.
const browser = await chromium.launch();

async function captureAllJson(url, { settleMs = 6000, matchHosts = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const calls = [];
  page.on('response', async (res) => {
    try {
      const req = res.request();
      const u = req.url();
      if (/google|gstatic|doubleclick|facebook|hotjar|clarity|mouseflow|bc0a|hubspot|hs-scripts|onetrust|linkedin|youtube|stripe|adsrvr|teads|evergage|acsbapp|flowcode|invoca|segreencolumn|snowplow|\.(png|jpe?g|webp|svg|gif|css|woff2?)([?#]|$)/i.test(u)) return;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('json') && !/api|graphql|search|ajax/i.test(u)) return;
      if (matchHosts && !matchHosts.some((h) => u.includes(h))) return;
      let body = '';
      try { body = await res.text(); } catch {}
      calls.push({
        method: req.method(),
        url: u.slice(0, 250),
        postData: req.postData()?.slice(0, 8000) ?? null,
        status: res.status(),
        type: ct.slice(0, 50),
        bytes: body.length,
        body,
      });
    } catch {}
  });
  const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
  await page.waitForTimeout(settleMs);
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  await context.close();
  return { status: nav?.status() ?? null, calls, text };
}

async function saveCapture(slug, cap, { bodyHint = /price|plan|sqft|bed|home|communit/i } = {}) {
  await save(`${slug}.calls.json`, cap.calls.map(({ body, ...c }) => c));
  let saved = 0;
  for (const c of cap.calls) {
    if (saved >= 8 || c.status !== 200 || c.bytes < 300 || !bodyHint.test(c.body)) continue;
    try {
      await save(`${slug}.capture-${saved}.pruned.json`, { url: c.url, postData: c.postData, data: prune(JSON.parse(c.body), 0, 5) });
      saved += 1;
    } catch {}
  }
  await save(`${slug}.text.txt`, cap.text.slice(0, 6000));
  return saved;
}

await section('drb-capture', async () => {
  const cap = await captureAllJson(
    'https://www.drbhomes.com/drbhomes/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire/overview',
    { settleMs: 8000, matchHosts: ['drbhomes.com'] }
  );
  const saved = await saveCapture('drb-overview', cap);
  summary.drbCapture = { status: cap.status, calls: cap.calls.length, saved };
});

await section('mattamy-capture', async () => {
  const cap = await captureAllJson(
    'https://mattamyhomes.com/search?productType=plan&metro=Sarasota-Bradenton&country=USA&community=Brightmore%20at%20Wellen%20Park&hideMap=true',
    { settleMs: 9000 }
  );
  const saved = await saveCapture('mattamy-search', cap);
  summary.mattamyCapture = { status: cap.status, calls: cap.calls.length, saved, textChars: cap.text.length };
});

await section('lwhomes-capture', async () => {
  const cap = await captureAllJson('https://lwhomes.com/listings/', { settleMs: 8000 });
  const saved = await saveCapture('lwhomes-listings', cap);
  summary.lwhomesCapture = { status: cap.status, calls: cap.calls.length, saved, textChars: cap.text.length };
});

await browser.close();

// 6. M/I — retry the SSC Search API with node fetch, full params, error detail.
await section('mihomes-retry', async () => {
  const results = [];
  for (const [slug, url] of [
    ['plans-simple', 'https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=plans&typeahead_type=markets'],
    ['inventory-simple', 'https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=inventory&typeahead_type=markets'],
  ]) {
    const res = await nodeFetch(url, {
      headers: {
        accept: 'application/json',
        referer: 'https://www.mihomes.com/new-homes/florida/sarasota-metro/plans-ready-to-build',
      },
    });
    const r = { slug, status: res.status, bytes: res.text.length, type: res.type.slice(0, 50), error: res.error };
    if (res.status === 200 && res.text.length > 500) {
      try {
        const parsed = JSON.parse(res.text);
        await save(`mihomes-${slug}.pruned.json`, prune(parsed, 0, 3));
        const communities = parsed.communities ?? [];
        r.communities = Array.isArray(communities) ? communities.length : null;
        const target = Array.isArray(communities)
          ? communities.find((c) => /sweetwater|nautique|palmera/i.test(JSON.stringify(c).slice(0, 5000)))
          : null;
        if (target) await save(`mihomes-${slug}.target.pruned.json`, prune(target, 0, 10));
      } catch (e) { r.parseError = String(e).slice(0, 150); }
    } else if (res.text) {
      r.head = res.text.slice(0, 300);
    }
    results.push(r);
    await new Promise((r2) => setTimeout(r2, 500));
  }
  await save('mihomes-retry.json', results);
  summary.mihomesRetry = results.map(({ slug, status, bytes, error, communities }) => ({ slug, status, bytes, error, communities }));
});

await save('round7-summary.json', summary);
console.log('round-7 discovery complete:', JSON.stringify(summary, null, 1));
