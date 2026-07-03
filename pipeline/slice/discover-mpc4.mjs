// MPC discovery round 4 (GitHub Actions), fetch-only: crack Lakewood Ranch's
// home data source. Its /home-finder/ HTML is 157 KB but has 0 server-
// rendered <article data-comp=property> cards (Wellen Park has them) — so LWR
// injects cards client-side. Find where from: (1) an embedded JS array/JSON
// in the initial HTML, (2) a data/API endpoint referenced in the HTML or its
// bundles. LWR holds M/I Sweetwater/Nautique and Neal Signature Waterbury
// Park/The Alcove. Output: pipeline/slice/discovery/mpc4/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'mpc4');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    return { status: res.status, url: res.url, type: res.headers.get('content-type') ?? '', text: await res.text().catch(() => '') };
  } catch (err) {
    return { status: 0, url, type: '', text: '', error: String(err?.cause?.message ?? err?.message ?? err) };
  }
}
const save = (name, data) =>
  writeFile(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));

await mkdir(OUT, { recursive: true });
const summary = {};

const page = await get('https://www.lakewoodranch.com/home-finder/');
summary.page = { status: page.status, bytes: page.text.length, url: page.url };
const html = page.text;

// 1. Endpoint hints in the HTML (data feeds / APIs / same-platform host).
const endpoints = new Set();
for (const re of [
  /["'](https?:\/\/[^"'\s]{10,200}?(?:api|home|listing|propert|search|feed|\.json|residenc|inventory)[^"'\s]{0,120})["']/gi,
  /["'](\/(?:api|wp-json|umbraco|graphql|home|search|data)[A-Za-z0-9_\-./?=&%]{0,140})["']/gi,
  /(https?:\/\/static\.[a-z]+\.com[^"'\s]{0,80})/gi,
]) for (const m of html.matchAll(re)) endpoints.add(m[1]);
summary.endpoints = [...endpoints].slice(0, 50);

// 2. Embedded JS data: look for big arrays/objects assigned to a var or a
//    JSON <script>, especially ones mentioning home/price/builder fields.
const dataHints = [];
for (const m of html.matchAll(/(?:var|let|const|window\.[A-Za-z_$]+\s*=|[A-Za-z_$]+\s*[:=])\s*(\[[\s\S]{200,}?\]|\{[\s\S]{200,}?\})\s*[;,\n]/gi)) {
  const blob = m[1];
  if (/price|builder|neighborhood|bed|bath|sqft|home_?id|residence/i.test(blob) && blob.length > 300) {
    dataHints.push({ head: m[0].slice(0, 80), bytes: blob.length });
  }
  if (dataHints.length > 20) break;
}
summary.embeddedDataHints = dataHints.slice(0, 20);
// JSON <script> blocks.
const jsonScripts = [...html.matchAll(/<script([^>]*type=["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi)]
  .map((m) => ({ attrs: m[1].trim().slice(0, 100), bytes: m[2].length }))
  .filter((b) => b.bytes > 400).sort((a, b) => b.bytes - a.bytes);
summary.jsonScripts = jsonScripts.slice(0, 10);

// 3. Probe the most plausible data endpoints for JSON.
const probes = [];
const candidates = [...endpoints].filter((u) => /api|home|listing|search|feed|\.json|residenc|inventory/i.test(u) && !/\.(png|jpe?g|svg|css|woff|js)([?#]|$)/i.test(u)).slice(0, 12);
// Common WordPress/home-search guesses if nothing surfaced.
for (const guess of ['https://www.lakewoodranch.com/wp-json/', 'https://www.lakewoodranch.com/wp-json/wp/v2/types', 'https://api.lakewoodranch.com/homes', 'https://static.lakewoodranch.com/']) {
  if (!candidates.includes(guess)) candidates.push(guess);
}
for (const url of candidates.slice(0, 14)) {
  const abs = url.startsWith('http') ? url : 'https://www.lakewoodranch.com' + url;
  const r = await get(abs);
  const isJson = /json/i.test(r.type) || /^[[{]/.test(r.text.trim());
  probes.push({ url: abs.slice(0, 120), status: r.status, json: isJson, bytes: r.text.length });
  if (r.status === 200 && isJson && r.text.length > 300 && /price|builder|home|bed|residence/i.test(r.text)) {
    await save(`lwr-data-${probes.length}.json`, r.text.slice(0, 40_000));
  }
  await new Promise((res) => setTimeout(res, 250));
}
summary.probes = probes;

// Save a chunk of the raw HTML head for manual inspection of the app config.
await save('lwr-home-finder.head.html', html.slice(0, 20_000));
await save('mpc4-summary.json', summary);
console.log('MPC discovery 4 complete:', JSON.stringify(summary, null, 1));
