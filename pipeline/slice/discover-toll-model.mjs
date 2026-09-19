// Toll Brothers plan-page discovery (2026-09-19): the community page's
// model objects carry elevations, the walkthrough and the description, but
// gallery.mediaGroups (the "Media Showcase" of interior photos with
// captions) is null there. Fetch a few plan pages and quick move-in pages
// and dump their __NEXT_DATA__ (pruned) so the extractor's per-plan
// enrichment can be written against real structure. Runs in GitHub Actions;
// the sandbox has no egress to tollbrothers.com.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MASTER = 'https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch';
const OUT = path.join(import.meta.dirname, 'discovery');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_ARRAY = 8;
const MAX_STRING = 300;

function prune(node, depth = 0) {
  if (typeof node === 'string') return node.length > MAX_STRING ? node.slice(0, MAX_STRING) + `…(${node.length})` : node;
  if (Array.isArray(node)) {
    const kept = node.slice(0, MAX_ARRAY).map((n) => prune(n, depth + 1));
    if (node.length > MAX_ARRAY) kept.push(`…(${node.length} items total)`);
    return kept;
  }
  if (node && typeof node === 'object') {
    if (depth > 16) return '…(depth)';
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = prune(v, depth + 1);
    return out;
  }
  return node;
}

async function fetchNextData(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return { status: res.status, bytes: html.length, data: m ? JSON.parse(m[1]) : null };
}

const slugOf = (url) =>
  url.replace(/\/+$/, '').split('/').slice(-2).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-');

function mediaPaths(root) {
  const paths = new Set();
  (function walk(n, p, d) {
    if (d > 12) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, p + '[]', d + 1)); return; }
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        if (/gallery|interior|exterior|elevation|media|walk|tour|video|showcase|image|photo|description/i.test(k)) {
          paths.add(`${p}.${k} => ${Array.isArray(v) ? '[' + v.length + ']' : v === null ? 'null' : typeof v}`);
        }
        walk(v, `${p}.${k}`, d + 1);
      }
    }
  })(root, 'pageData', 0);
  return [...paths].slice(0, 150);
}

await mkdir(OUT, { recursive: true });
const master = await fetchNextData(MASTER);
const summary = { capturedAt: new Date().toISOString(), master: { status: master.status, bytes: master.bytes }, pages: [] };
const mc = master.data?.props?.pageProps?.pageData?.masterCommunityComponent;
const bases = (mc?.homes?.models ?? []).filter((m) => m?.url && !m.isQMI).map((m) => m.url);
const qmis = [];
for (const c of mc?.communities ?? []) for (const m of c?.homes?.models ?? []) for (const q of m?.qmis ?? []) if (q?.url) qmis.push(q.url);
summary.master.basePlans = bases.length;
summary.master.qmis = qmis.length;
const targets = [...new Set([...bases.slice(0, 10), ...qmis.slice(0, 2)])];
for (const url of targets) {
  const slug = 'toll-model-' + slugOf(url);
  try {
    const page = await fetchNextData(url);
    if (!page.data) {
      await writeFile(path.join(OUT, `${slug}.error.txt`), `no __NEXT_DATA__; status ${page.status}\n`);
      summary.pages.push({ url, status: page.status, ok: false });
      continue;
    }
    const pd = page.data.props?.pageProps?.pageData ?? {};
    await writeFile(path.join(OUT, `${slug}.pruned.json`), JSON.stringify(prune(page.data), null, 1));
    summary.pages.push({ url, slug, status: page.status, bytes: page.bytes, ok: true, pageDataKeys: Object.keys(pd), mediaPaths: mediaPaths(pd) });
  } catch (e) {
    summary.pages.push({ url, ok: false, error: String(e).slice(0, 300) });
  }
}
await writeFile(path.join(OUT, 'toll-model-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
