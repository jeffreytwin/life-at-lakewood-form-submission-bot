// MPC discovery round 5 (GitHub Actions), fetch-only: find Lakewood Ranch's
// server-rendered home list. LWR is the same developer/platform as Wellen
// Park (which renders <article data-comp=property> cards), but /home-finder/
// doesn't. Try the parallel paths (LWR uses /our-homes/…) and the WordPress
// admin-ajax home-search action, grepping each for the property cards or a
// JSON home array. If found, the existing mpc-aggregator extractor handles
// LWR with source config; this reaches M/I Sweetwater/Nautique + Neal
// Signature Waterbury Park/The Alcove. Output: discovery/mpc5/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'mpc5');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(url, opts = {}) {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*', ...(opts.headers ?? {}) },
      body: opts.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, url: res.url, type: res.headers.get('content-type') ?? '', text: await res.text().catch(() => '') };
  } catch (err) {
    return { status: 0, url, type: '', text: '', error: String(err?.cause?.message ?? err?.message ?? err) };
  }
}
const save = (name, data) =>
  writeFile(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));

const cardCount = (html) => (html.match(/data-comp=["']property["']/gi) ?? []).length;
const troubleHits = (html) => {
  const low = html.toLowerCase();
  const out = {};
  for (const t of ['sweetwater', 'nautique', 'waterbury', 'alcove', 'mi-homes', 'ici-homes', 'neal-signature', 'data-builder-name']) {
    const n = (low.match(new RegExp(t.replace(/[/]/g, '.'), 'g')) ?? []).length;
    if (n) out[t] = n;
  }
  return out;
};

await mkdir(OUT, { recursive: true });
const summary = { pages: {}, ajax: {} };

// 1. Candidate server-rendered home-list pages on LWR.
const paths = [
  '/our-homes/', '/our-homes/homes/', '/our-homes/quick-move-in/', '/our-homes/homes-for-sale/',
  '/homes/', '/homes-for-sale/', '/quick-move-in-homes/', '/available-homes/', '/find-a-home/',
  '/our-homes/villages/', '/our-homes/builders/', '/new-homes/', '/homefinder/',
];
for (const p of paths) {
  const r = await get('https://www.lakewoodranch.com' + p);
  const cards = r.status === 200 ? cardCount(r.text) : 0;
  const hits = r.status === 200 ? troubleHits(r.text) : {};
  summary.pages[p] = { status: r.status, finalUrl: r.url, bytes: r.text.length, cards, hits };
  if (cards > 0) {
    // Found the server-rendered list — save the card region + builder/neighborhood vocab.
    const first = r.text.search(/data-comp=["']property["']/i);
    await save(`lwr${p.replace(/\//g, '_')}card-region.html`, r.text.slice(Math.max(0, first - 3000), first + 8000));
    const builders = [...new Set([...r.text.matchAll(/data-builder-name=["']([^"']+)["']/gi)].map((m) => m[1]))];
    const neighborhoods = [...new Set([...r.text.matchAll(/data-neighborhood=["']([^"']+)["']/gi)].map((m) => m[1]))];
    summary.pages[p].builders = builders;
    summary.pages[p].neighborhoods = neighborhoods;
  }
  await new Promise((res) => setTimeout(res, 250));
}

// 2. WordPress admin-ajax home-search actions (common plugin pattern).
for (const action of ['get_homes', 'home_search', 'homefinder', 'filter_homes', 'load_homes', 'property_search', 'homes', 'search_homes']) {
  for (const method of ['GET', 'POST']) {
    const url = `https://www.lakewoodranch.com/wp-admin/admin-ajax.php?action=${action}`;
    const r = await get(url, method === 'POST'
      ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `action=${action}` }
      : {});
    const isData = r.status === 200 && r.text.length > 50 && r.text.trim() !== '0' && /price|builder|home|bed|data-comp/i.test(r.text);
    summary.ajax[`${method} ${action}`] = { status: r.status, bytes: r.text.length, isData };
    if (isData) await save(`lwr-ajax-${action}-${method}.txt`, r.text.slice(0, 20_000));
    await new Promise((res) => setTimeout(res, 200));
  }
}

await save('mpc5-summary.json', summary);
console.log('MPC discovery 5 complete:', JSON.stringify(summary, null, 1));
