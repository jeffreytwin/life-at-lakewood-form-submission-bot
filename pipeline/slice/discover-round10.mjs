// Round-10 discovery (GitHub Actions): M/I via HTTP/2 + Chrome ciphers.
// Round 9's breakthrough — every other transport hangs, but HTTP/2 with
// Chrome's cipher order got a real 429 in 226ms (request ACCEPTED, just
// rate-limited). So the working transport is settled; this round adds the
// full Chrome h2 pseudo/real header set and retries with backoff to clear
// the 429, then dumps the plan + inventory structures for the extractor.
// Output: pipeline/slice/discovery/round10/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http2 from 'node:http2';

const OUT = path.join(import.meta.dirname, 'discovery', 'round10');
const BASE = 'https://www.mihomes.com';
const PATHS = {
  plans: '/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=plans&typeahead_type=markets',
  inventory: '/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=inventory&typeahead_type=markets',
};
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES128-GCM-SHA256', 'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384', 'ECDHE-ECDSA-CHACHA20-POLY1305', 'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA', 'ECDHE-RSA-AES256-SHA', 'AES128-GCM-SHA256', 'AES256-GCM-SHA384',
  'AES128-SHA', 'AES256-SHA',
].join(':');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One HTTP/2 GET with Chrome ciphers + a Chrome-like header set.
function h2get(pathAndQuery, timeoutMs = 25_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; try { client.close(); } catch {} resolve(r); } };
    const client = http2.connect(BASE, { ciphers: CHROME_CIPHERS, minVersion: 'TLSv1.2' });
    const timer = setTimeout(() => done({ status: 0, body: '', error: 'timeout' }), timeoutMs);
    client.on('error', (err) => { clearTimeout(timer); done({ status: 0, body: '', error: String(err?.message ?? err) }); });
    const req = client.request({
      ':method': 'GET',
      ':path': pathAndQuery,
      ':scheme': 'https',
      ':authority': 'www.mihomes.com',
      'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'upgrade-insecure-requests': '1',
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      referer: 'https://www.mihomes.com/new-homes/florida/sarasota-metro/plans-ready-to-build',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en-US,en;q=0.9',
      'x-requested-with': 'XMLHttpRequest',
    });
    let status = 0;
    let encoding = '';
    const chunks = [];
    req.on('response', (h) => { status = h[':status']; encoding = h['content-encoding'] ?? ''; });
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      clearTimeout(timer);
      let buf = Buffer.concat(chunks);
      try {
        const zlib = await import('node:zlib');
        if (encoding.includes('br')) buf = zlib.brotliDecompressSync(buf);
        else if (encoding.includes('gzip')) buf = zlib.gunzipSync(buf);
        else if (encoding.includes('deflate')) buf = zlib.inflateSync(buf);
      } catch { /* leave raw */ }
      done({ status, body: buf.toString('utf8') });
    });
    req.on('error', (err) => { clearTimeout(timer); done({ status: 0, body: '', error: String(err?.message ?? err) }); });
    req.end();
  });
}

// Retry through 429s with exponential backoff.
async function fetchWithRetry(pathAndQuery, label) {
  const attempts = [];
  for (let i = 0; i < 6; i++) {
    const res = await h2get(pathAndQuery);
    attempts.push({ attempt: i + 1, status: res.status, bytes: res.body.length, error: res.error });
    console.log(`${label} attempt ${i + 1}: ${res.status} (${res.body.length} bytes)${res.error ? ' ' + res.error : ''}`);
    if (res.status === 200 && res.body.length > 1000) return { res, attempts };
    if (res.status === 429) await sleep(2000 * 2 ** i); // 2s,4s,8s,16s,32s
    else if (res.status === 0) await sleep(1500);
    else await sleep(1000);
  }
  return { res: null, attempts };
}

await mkdir(OUT, { recursive: true });
const summary = {};

for (const [label, pq] of Object.entries(PATHS)) {
  const { res, attempts } = await fetchWithRetry(pq, label);
  summary[label] = { attempts, ok: Boolean(res) };
  if (res) {
    try {
      const parsed = JSON.parse(res.body);
      await save(`mihomes-${label}.deep.pruned.json`, prune(parsed, 0, 3));
      const communities = parsed.communities ?? parsed.Communities ?? [];
      summary[label].communities = Array.isArray(communities) ? communities.length : null;
      const target = Array.isArray(communities)
        ? communities.find((c) => /sweetwater|nautique|palmera/i.test(JSON.stringify(c).slice(0, 8000)))
        : null;
      if (target) await save(`mihomes-${label}.target-community.pruned.json`, prune(target, 0, 14));
    } catch (e) {
      await save(`mihomes-${label}.parse-error.txt`, String(e) + '\n\n' + res.body.slice(0, 5000));
      summary[label].parseError = String(e).slice(0, 200);
    }
  }
  await sleep(3000);
}

await save('round10-summary.json', summary);
console.log('round-10 complete:', JSON.stringify(summary, null, 1));
