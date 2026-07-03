// MPC-aggregator discovery (GitHub Actions): can the master-planned-community
// sites lakewoodranch.com and wellenpark.com serve as an alternate source for
// the builders whose own sites block us (M/I, ICI Homes, Neal Signature)?
// These are different origins from the builders, so their WAF/fingerprint
// blocks don't apply. Goal: confirm reachability from a runner, find the
// homes/floorplan/quick-move-in pages, detect embedded JSON vs server-render,
// and check whether the trouble-builder communities carry per-plan data
// (price/beds/baths/sqft/images) rather than just community-level ranges.
// Output: pipeline/slice/discovery/mpc/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'mpc');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

// Communities we track for the trouble builders, to grep for in aggregator data.
const TROUBLE = {
  'M/I Homes': ['Sweetwater', 'Nautique', 'Palmera'],
  'ICI Homes': ['Oakbend', 'Palmera'],
  'Neal Signature Homes': ['Waterbury Park', 'The Alcove'],
};
const ALL_TROUBLE_TERMS = [
  'sweetwater', 'nautique', 'palmera', 'oakbend', 'waterbury', 'alcove',
  'm/i', 'mi homes', 'ici', 'neal signature',
];

const SITES = [
  {
    slug: 'lakewoodranch',
    origin: 'https://www.lakewoodranch.com',
    seeds: [
      '/', '/homes', '/homes-for-sale', '/find-your-home', '/new-homes',
      '/floor-plans', '/quick-move-in', '/builders', '/neighborhoods',
      '/homefinder', '/home-finder', '/available-homes',
    ],
  },
  {
    slug: 'wellenpark',
    origin: 'https://www.wellenpark.com',
    seeds: [
      '/', '/homes', '/homes-for-sale', '/find-your-home', '/new-homes',
      '/floor-plans', '/quick-move-in', '/builders', '/neighborhoods',
      '/homefinder', '/home-finder', '/available-homes', '/find-a-home',
    ],
  },
];

async function get(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const text = await res.text().catch(() => '');
    return { status: res.status, url: res.url, text, type: res.headers.get('content-type') ?? '' };
  } catch (err) {
    return { status: 0, url, text: '', type: '', error: String(err?.cause?.message ?? err?.message ?? err) };
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
    if (depth > 16) return '…(depth)';
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = prune(v, depth + 1, arrayCap);
    return out;
  }
  return node;
}

const save = (name, data) =>
  writeFile(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

async function section(name, fn) {
  try { await fn(); console.log(`[${name}] done`); }
  catch (err) { console.log(`[${name}] FAILED: ${err?.stack ?? err}`); await save(`${name}.error.txt`, String(err?.stack ?? err)).catch(() => {}); }
}

function stripText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function report(html, pageUrl) {
  const text = stripText(html);
  const apiUrls = new Set();
  for (const m of html.matchAll(/["'](https?:\/\/[^"'\s]{8,200}?(?:\/api\/|graphql|\.json|search|odata|bdx|newhomesource|homefinder)[^"'\s]{0,120})["']/gi)) apiUrls.add(m[1]);
  for (const m of html.matchAll(/["'](\/(?:api|graphql|umbraco|sitecore|_next\/data|wp-json)[A-Za-z0-9_\-./?=&%]{0,140})["']/gi)) apiUrls.add(m[1]);
  const jsonScripts = [...html.matchAll(/<script([^>]*type=["']application\/(?:json|ld\+json)["'][^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => ({ attrs: m[1].trim().slice(0, 120), bytes: m[2].length }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
  const troubleHits = {};
  const low = (html + ' ' + text).toLowerCase();
  for (const t of ALL_TROUBLE_TERMS) {
    const n = (low.match(new RegExp(t.replace(/[/]/g, '.'), 'g')) ?? []).length;
    if (n) troubleHits[t] = n;
  }
  // Builder mentions generally (is this an aggregator that names builders?).
  const builderMentions = {};
  for (const b of ['m/i', 'ici', 'neal', 'toll', 'mattamy', 'taylor morrison', 'lennar', 'pulte', 'homes by westbay', 'dream finders', 'stock', 'meritage', 'lee wetherington']) {
    const n = (low.match(new RegExp(b.replace(/[/]/g, '.'), 'g')) ?? []).length;
    if (n) builderMentions[b] = n;
  }
  return {
    status: 200,
    bytes: html.length,
    textChars: text.length,
    prices: (text.match(/\$\s?\d{3}(,\d{3})?/g) ?? []).length,
    sqfts: (text.match(/\b[\d,]{3,6}\s*(?:sq\.?\s*ft|sqft|square\s+feet)/gi) ?? []).length,
    hasNextData: /<script id="__NEXT_DATA__"/.test(html),
    hasApollo: /APOLLO_STATE|__APOLLO/.test(html),
    hasNuxt: /__NUXT__/.test(html),
    apiUrls: [...apiUrls].slice(0, 30),
    jsonScripts,
    troubleHits,
    builderMentions,
  };
}

await mkdir(OUT, { recursive: true });
const summary = {};

for (const site of SITES) {
  await section(site.slug, async () => {
    const siteOut = { origin: site.origin, seeds: {}, sitemap: {}, discoveredLinks: [] };

    // 1. Probe seed paths; keep the ones that return HTML.
    const good = [];
    for (const seed of site.seeds) {
      const res = await get(site.origin + seed);
      siteOut.seeds[seed] = { status: res.status, bytes: res.text.length, finalUrl: res.url, error: res.error };
      if (res.status === 200 && res.text.length > 2000) good.push({ seed, res });
    }

    // 2. From the homepage (and any good page), collect internal links that
    //    look home/builder/floorplan related.
    const linkSet = new Set();
    for (const { res } of good) {
      for (const m of res.text.matchAll(/href=["']([^"'#?]+)["']/gi)) {
        let href = m[1];
        if (href.startsWith('/')) href = site.origin + href;
        if (!href.startsWith(site.origin)) continue;
        if (/home|builder|floor.?plan|quick.?move|move.?in|available|neighborhood|new-homes|residence|for-sale|find/i.test(href)) {
          linkSet.add(href.split('#')[0]);
        }
      }
    }
    siteOut.discoveredLinks = [...linkSet].slice(0, 60);

    // 3. Sitemap scan for trouble-community + home/plan URLs.
    const robots = await get(site.origin + '/robots.txt');
    const maps = [...robots.text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    if (!maps.length) maps.push(site.origin + '/sitemap.xml');
    const smMatches = new Set();
    let fetched = 0;
    const queue = [...maps];
    const seen = new Set();
    while (queue.length && fetched < 10) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      seen.add(u);
      const r = await get(u);
      fetched++;
      if (r.status !== 200) continue;
      for (const m of r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const loc = m[1];
        if (/\.xml(\?|$)/i.test(loc)) { if (queue.length < 30) queue.push(loc); }
        else if (/home|builder|floor.?plan|quick|available|neighborhood|new-home|for-sale|sweetwater|nautique|palmera|oakbend|waterbury|alcove/i.test(loc) && smMatches.size < 120) smMatches.add(loc);
      }
    }
    siteOut.sitemap = { maps, matches: [...smMatches].slice(0, 120) };

    // 4. Deep-report the most promising pages: homepage + any home/floorplan
    //    seed that worked, plus up to 4 sitemap home/plan pages.
    const targets = [];
    for (const { seed, res } of good) targets.push({ label: seed.replace(/[/]/g, '_') || 'home', res });
    const extraUrls = [...smMatches].filter((u) => /home|floor.?plan|quick|available|residence/i.test(u)).slice(0, 4);
    for (const u of extraUrls) targets.push({ label: 'sm_' + u.split('/').filter(Boolean).pop().slice(0, 30), res: await get(u) });

    const reports = {};
    for (const { label, res } of targets.slice(0, 12)) {
      if (res.status !== 200) { reports[label] = { status: res.status, url: res.url }; continue; }
      const rep = report(res.text, res.url);
      rep.url = res.url;
      reports[label] = rep;
      // Dump embedded JSON when a page carries a big block or __NEXT_DATA__.
      const next = res.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (next) { try { await save(`${site.slug}-${label}.nextdata.pruned.json`, prune(JSON.parse(next[1]))); } catch {} }
      const big = [...res.text.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)]
        .map((m) => m[1]).filter((b) => b.length > 6000).sort((a, b) => b.length - a.length)[0];
      if (big) { try { await save(`${site.slug}-${label}.jsonblock.pruned.json`, prune(JSON.parse(big))); } catch {} }
      // Save visible text if it looks data-rich.
      if (rep.prices > 3 || rep.troubleHits && Object.keys(rep.troubleHits).length) {
        await save(`${site.slug}-${label}.text.txt`, stripText(res.text).slice(0, 8000));
      }
    }
    siteOut.reports = reports;
    await save(`${site.slug}-summary.json`, siteOut);
    summary[site.slug] = {
      reachableSeeds: good.map((g) => g.seed),
      sitemapMatches: smMatches.size,
      links: siteOut.discoveredLinks.length,
      pages: Object.fromEntries(Object.entries(reports).map(([k, v]) => [k, { status: v.status, prices: v.prices, sqfts: v.sqfts, trouble: v.troubleHits, builders: v.builderMentions && Object.keys(v.builderMentions).length }])),
    };
  });
}

await save('mpc-summary.json', summary);
console.log('MPC discovery complete:', JSON.stringify(summary, null, 1));
