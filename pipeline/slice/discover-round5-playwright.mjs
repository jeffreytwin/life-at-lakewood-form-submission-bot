// Round-5 discovery: Playwright network capture (GitHub Actions).
// Rounds 2–4 established that Meritage/Taylor Morrison/M-I/DRB render their
// plan grids client-side, and Meritage's WAF now 403s Node's fetch TLS
// fingerprint outright. Real Chrome solves both: render each target page,
// record every JSON XHR/fetch response, and save the plan-bearing ones —
// that surfaces each site's hidden data API in one pass, and doubles as a
// WAF probe for the hard-blocked builders (ICI, Neal Signature).
// Requires: `npm i --no-save playwright` + `npx playwright install chromium`
// (done by the workflow). Output: pipeline/slice/discovery/round5/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.join(import.meta.dirname, 'discovery', 'round5');

const TARGETS = [
  { slug: 'meritage-classic', url: 'https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series' },
  { slug: 'meritage-premier', url: 'https://www.meritagehomes.com/state/fl/tampa/salt-meadows-premier-series' },
  { slug: 'taylor-firethorn-floorplans', url: 'https://www.taylormorrison.com/fl/tampa/parrish/firethorn/floor-plans' },
  { slug: 'mihomes-plans', url: 'https://www.mihomes.com/new-homes/florida/sarasota-metro/plans-ready-to-build' },
  { slug: 'mihomes-qmi', url: 'https://www.mihomes.com/new-homes/florida/sarasota-metro/quick-move-in-homes' },
  { slug: 'drb-seaire-floorplans', url: 'https://www.drbhomes.com/drbhomes/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire/floorplans' },
  { slug: 'mattamy-brightmore', url: 'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/brightmore' },
  { slug: 'lwhomes-home', url: 'https://lwhomes.com/', collectLinks: true },
  { slug: 'ici-home', url: 'https://www.icihomes.com/', collectLinks: true },
  { slug: 'neal-signature-home', url: 'https://www.nealsignaturehomes.com/', collectLinks: true },
];

const PLAN_HINT = /price|sqft|squarefeet|bedroom|floorplan|floor_plan|quickmove|homesite|inventory|\$\d{3},\d{3}/i;
const API_URL = /api|graphql|search|\.json|odata|sitecore|layout/i;
const SKIP_URL = /google|gstatic|doubleclick|facebook|hotjar|clarity|mouseflow|bc0a|hs-scripts|hubspot|cookielaw|onetrust|newrelic|sitecorecontenthub|\.(png|jpe?g|webp|svg|gif|css|woff2?)([?#]|$)/i;

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

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const summary = {};

for (const target of TARGETS) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();
  const responses = [];
  let saved = 0;

  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (SKIP_URL.test(url)) return;
      const ct = res.headers()['content-type'] ?? '';
      const looksJson = ct.includes('json');
      if (!looksJson && !API_URL.test(url)) return;
      const entry = { url: url.slice(0, 220), status: res.status(), type: ct.slice(0, 50) };
      if (looksJson && res.status() === 200 && saved < 10) {
        const body = await res.text().catch(() => '');
        entry.bytes = body.length;
        if (body.length > 400 && PLAN_HINT.test(body)) {
          const idx = saved++;
          entry.savedAs = `${target.slug}.capture-${idx}.pruned.json`;
          try {
            await save(entry.savedAs, { url, data: prune(JSON.parse(body), 0, 5) });
          } catch {
            await save(`${target.slug}.capture-${idx}.txt`, body.slice(0, 8000));
          }
        }
      }
      responses.push(entry);
    } catch { /* response body unavailable (redirect etc.) */ }
  });

  const result = { url: target.url };
  try {
    const nav = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    result.status = nav?.status() ?? null;
    // Let the SPA settle + trigger lazy content.
    await page.waitForTimeout(4000);
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(3000);
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(3000);

    const text = await page.evaluate(() => document.body?.innerText ?? '');
    result.textChars = text.length;
    result.prices = (text.match(/\$\s?\d{3},\d{3}/g) ?? []).length;
    result.sqfts = (text.match(/\b[\d,]{3,6}\s*(?:sq\.?\s*ft|sqft|square\s+feet)/gi) ?? []).length;
    await save(`${target.slug}.text.txt`, `prices=${result.prices} sqfts=${result.sqfts} chars=${result.textChars}\n\n${text.slice(0, 8000)}`);

    if (target.collectLinks) {
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .map((a) => ({ href: a.href, text: (a.textContent ?? '').trim().slice(0, 60) }))
          .filter((l) => /communit|home|plan|move|quick|available|model/i.test(l.href + ' ' + l.text))
          .slice(0, 40)
      );
      await save(`${target.slug}.links.json`, links);
      result.links = links.length;
    }
  } catch (err) {
    result.error = String(err?.message ?? err).slice(0, 300);
  }
  await save(`${target.slug}.responses.json`, responses.slice(0, 80));
  result.jsonResponses = responses.filter((r) => r.type?.includes('json')).length;
  result.captures = saved;
  summary[target.slug] = result;
  console.log(`[${target.slug}]`, JSON.stringify(result));
  await context.close();
}

await browser.close();
await save('round5-summary.json', summary);
console.log('round-5 playwright discovery complete');
