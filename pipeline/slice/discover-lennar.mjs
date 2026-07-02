// Lennar discovery: find community page URLs from lennar.com sitemaps for
// the communities we track, then dump pruned __NEXT_DATA__ from the first
// two so the extractor field mapping is written against real structure.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const COMMUNITY_KEYS = [
  'prosperity-lakes', 'rye-ranch', 'seaire', 'lorraine-lakes', 'stillwater',
  'aurora', 'calusa', 'wellen-park',
];
const OUT = path.join(import.meta.dirname, 'discovery');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, url: res.url, text: res.ok ? await res.text() : '' };
}

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

await mkdir(OUT, { recursive: true });

// 1. Sitemap sweep for community URLs.
const found = new Map();
const root = await get('https://www.lennar.com/sitemap.xml');
console.log(`sitemap root: ${root.status}`);
let maps = [...root.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
if (!maps.length) maps = ['https://www.lennar.com/sitemap.xml'];
const childMaps = maps.filter((m) => /\.xml/.test(m)).slice(0, 12);
for (const map of childMaps.length ? childMaps : maps) {
  const child = await get(map);
  if (child.status !== 200) continue;
  for (const m of child.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const url = m[1];
    for (const key of COMMUNITY_KEYS) {
      if (url.toLowerCase().includes(key) && !/\.xml/.test(url)) {
        if (!found.has(key)) found.set(key, []);
        if (found.get(key).length < 5) found.get(key).push(url);
      }
    }
  }
}
const urlIndex = Object.fromEntries(found);
await writeFile(path.join(OUT, 'lennar-urls.json'), JSON.stringify(urlIndex, null, 2));
console.log('community URL matches:', JSON.stringify(urlIndex, null, 1).slice(0, 2000));

// 2. Dump __NEXT_DATA__ (or other embedded state) from up to 2 pages.
const samples = [...found.values()].flat().filter((u) => /new-homes|communit/i.test(u)).slice(0, 2);
for (const [i, url] of samples.entries()) {
  const page = await get(url);
  console.log(`sample ${i}: ${page.status} ${url} (${page.text.length} bytes)`);
  if (page.status !== 200) continue;
  const m = page.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    await writeFile(path.join(OUT, `lennar-${i}.pruned.json`), JSON.stringify(prune(JSON.parse(m[1])), null, 1));
    console.log(`sample ${i}: __NEXT_DATA__ ${m[1].length} bytes -> pruned`);
  } else {
    // Log embedded state markers + any JSON api hints for fallback mapping.
    const hints = [...page.text.matchAll(/["'](https?:\/\/[^"']{10,180}?(?:api|graphql)[^"']{0,80})["']/gi)]
      .map((x) => x[1]).slice(0, 15);
    await writeFile(path.join(OUT, `lennar-${i}.nohydration.txt`), `no __NEXT_DATA__\napi hints:\n${hints.join('\n')}\n\nhead:\n${page.text.slice(0, 4000)}`);
    console.log(`sample ${i}: no __NEXT_DATA__; ${hints.length} api hints saved`);
  }
}
console.log('lennar discovery done');
