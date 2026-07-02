// Vertical-slice discovery: fetch Toll Brothers community pages for The
// Isles at Lakewood Ranch and dump their embedded __NEXT_DATA__ JSON
// (pruned: arrays capped, long strings truncated) so the extractor's field
// mapping can be written against real structure. Runs in GitHub Actions.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PAGES = [
  { slug: 'isles-main', url: 'https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch' },
  { slug: 'isles-captiva', url: 'https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch/Captiva-Collection' },
];

const OUT = path.join(import.meta.dirname, 'discovery');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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

await mkdir(OUT, { recursive: true });
for (const page of PAGES) {
  const res = await fetch(page.url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  console.log(`${page.slug}: ${res.status} ${html.length} bytes`);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    await writeFile(path.join(OUT, `${page.slug}.error.txt`), `no __NEXT_DATA__; status ${res.status}\n` + html.slice(0, 3000));
    continue;
  }
  const data = JSON.parse(m[1]);
  await writeFile(path.join(OUT, `${page.slug}.pruned.json`), JSON.stringify(prune(data), null, 1));
  console.log(`${page.slug}: __NEXT_DATA__ ${m[1].length} bytes -> pruned dump written`);
}
console.log('discovery done');
