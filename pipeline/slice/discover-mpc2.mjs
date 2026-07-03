// MPC discovery round 2 (GitHub Actions):
// (a) Wellen Park /available-homes is server-rendered with ~385 home cards
//     (price/neighborhood/builder/bed/bath/sqft in text). Save the RAW HTML
//     of the card region so the parser can anchor address / detail URL /
//     image / QMI flag / baths precisely.
// (b) Lakewood Ranch /home-finder is JS-driven ("Quick Home Search",
//     Loading…) — render with Playwright and capture the home-search XHR
//     JSON that backs it, so we can source the Lakewood Ranch trouble
//     communities (M/I Sweetwater/Nautique, Neal Signature Waterbury
//     Park/The Alcove).
// Output: pipeline/slice/discovery/mpc2/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.join(import.meta.dirname, 'discovery', 'mpc2');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function prune(node, depth = 0, arrayCap = 5) {
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
  writeFile(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
async function section(name, fn) {
  try { await fn(); console.log(`[${name}] done`); }
  catch (err) { console.log(`[${name}] FAILED: ${err?.stack ?? err}`); await save(`${name}.error.txt`, String(err?.stack ?? err)).catch(() => {}); }
}

await mkdir(OUT, { recursive: true });
const summary = {};

// (a) Wellen Park raw card HTML.
await section('wellenpark-cards', async () => {
  const res = await fetch('https://www.wellenpark.com/available-homes/', {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  summary.wellenpark = { status: res.status, bytes: html.length };
  if (res.status !== 200) throw new Error(`available-homes: ${res.status}`);

  // Find the region around the first price and save a generous window of raw
  // HTML so the card markup (address, <a href>, <img>, QMI badge) is visible.
  const firstPrice = html.search(/\$[\d,]{4,7}/);
  if (firstPrice > 0) {
    await save('wellenpark-card-region.html', html.slice(Math.max(0, firstPrice - 4000), firstPrice + 12_000));
  }
  // Also try to isolate repeated card containers by common class hints.
  const cardMatches = [...html.matchAll(/<(?:article|li|div)[^>]*class=["'][^"']*(?:card|listing|home-result|property|result-item|home-card)[^"']*["'][\s\S]{0,60}/gi)]
    .map((m) => m[0].slice(0, 200));
  await save('wellenpark-card-selectors.json', [...new Set(cardMatches)].slice(0, 20));

  // Structured text records across the WHOLE page (not just an 8KB sample).
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const records = [...text.matchAll(/\$[\d,]{4,7}\s+(.+?)\s+Builder:\s*([A-Za-z/&.\s]+?)\s+(\d(?:\.\d)?)\s*Bed\s+(\d(?:\.\d)?)\s*Bath\s+([\d,]+)\s*sqft/gi)]
    .map((m) => ({ price: m[0].match(/\$[\d,]+/)[0], neighborhood: m[1].trim().slice(0, 80), builder: m[2].trim(), beds: m[3], baths: m[4], sqft: m[5] }));
  await save('wellenpark-parsed-records.json', records);
  const byBuilder = {};
  for (const r of records) byBuilder[r.builder] = (byBuilder[r.builder] ?? 0) + 1;
  summary.wellenpark.records = records.length;
  summary.wellenpark.byBuilder = byBuilder;
  // Community x builder for the trouble builders.
  const trouble = records.filter((r) => /m\/i|ici|neal/i.test(r.builder));
  summary.wellenpark.troubleSample = trouble.slice(0, 12);
});

// (b) Lakewood Ranch home-finder XHR capture via Playwright.
await section('lakewoodranch-xhr', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const calls = [];
  page.on('response', async (r) => {
    try {
      const u = r.url();
      if (/google|gstatic|doubleclick|facebook|hotjar|clarity|cookie|consent|analytics|gtm|youtube|recaptcha|\.(png|jpe?g|webp|svg|gif|css|woff2?)([?#]|$)/i.test(u)) return;
      const ct = r.headers()['content-type'] ?? '';
      if (!ct.includes('json') && !/api|search|home|listing|residenc|graphql|bdx|newhome/i.test(u)) return;
      let body = '';
      try { body = await r.text(); } catch {}
      calls.push({ url: u.slice(0, 240), status: r.status(), type: ct.slice(0, 50), bytes: body.length, body });
    } catch {}
  });
  const urls = [
    'https://www.lakewoodranch.com/home-finder/',
    'https://www.lakewoodranch.com/find-a-home/',
    'https://www.lakewoodranch.com/quick-home-search/',
  ];
  const pages = [];
  for (const url of urls) {
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    pages.push({ url, status: nav?.status() ?? null });
    if (nav && nav.status() === 200) {
      await page.waitForTimeout(6000);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(4000);
      break; // first working home-finder page is enough
    }
  }
  // Save the biggest plan/home-bearing JSON responses.
  let saved = 0;
  const hint = /price|bed|bath|sqft|sq_ft|squarefeet|builder|community|neighborhood|address|residence/i;
  const ranked = calls.filter((c) => c.status === 200 && c.bytes > 500).sort((a, b) => b.bytes - a.bytes);
  for (const c of ranked) {
    if (saved >= 8) break;
    if (!hint.test(c.body)) continue;
    try { await save(`lwr-xhr-${saved}.pruned.json`, { url: c.url, data: prune(JSON.parse(c.body), 0, 4) }); saved++; }
    catch { await save(`lwr-xhr-${saved}.txt`, c.url + '\n\n' + c.body.slice(0, 6000)); saved++; }
  }
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  await save('lakewoodranch-homefinder.text.txt', text.slice(0, 8000));
  await save('lakewoodranch-xhr-calls.json', calls.map(({ body, ...c }) => c));
  summary.lakewoodranch = { pages, jsonCalls: calls.filter((c) => c.type.includes('json')).length, saved, textChars: text.length };
  await browser.close();
});

await save('mpc2-summary.json', summary);
console.log('MPC discovery 2 complete:', JSON.stringify(summary, null, 1));
