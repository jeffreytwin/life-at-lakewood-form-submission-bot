// Round-9 discovery (GitHub Actions): M/I Homes transport hunt.
// The SSC Search API serves 500 KB to real Chrome FROM A GITHUB RUNNER
// (round-5 Playwright) but hangs Node's fetch from the same IPs — so the
// block is TLS/client fingerprinting, not IP reputation. Try transports
// whose fingerprints differ from undici: HTTP/2 with Chrome-like settings,
// node:https with a Chrome cipher order, and curl. Whichever passes gets a
// deep response dump so the extractor mapping can be written.
// Output: pipeline/slice/discovery/round9/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http2 from 'node:http2';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const OUT = path.join(import.meta.dirname, 'discovery', 'round9');
const pExecFile = promisify(execFile);

const API_PLANS =
  'https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=plans&typeahead_type=markets';
const API_INVENTORY =
  'https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=inventory&typeahead_type=markets';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Chrome's TLS 1.2 cipher preference order (JA3-relevant).
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
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

const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  referer: 'https://www.mihomes.com/new-homes/florida/sarasota-metro/plans-ready-to-build',
};

function viaFetch(url, timeoutMs = 20_000) {
  return fetch(url, {
    headers: { 'user-agent': UA, ...HEADERS },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  }).then(
    async (res) => ({ status: res.status, body: await res.text().catch(() => '') }),
    (err) => ({ status: 0, body: '', error: String(err?.cause?.message ?? err?.message ?? err) })
  );
}

function viaHttps(url, { ciphers } = {}, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'user-agent': UA, ...HEADERS, host: u.hostname },
        ...(ciphers ? { ciphers, minVersion: 'TLSv1.2' } : {}),
        ALPNProtocols: ['http/1.1'],
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
    req.on('error', (err) => resolve({ status: 0, body: '', error: String(err?.message ?? err) }));
    req.end();
  });
}

function viaHttp2(url, { ciphers } = {}, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; try { client.close(); } catch {} resolve(r); } };
    const client = http2.connect(u.origin, ciphers ? { ciphers, minVersion: 'TLSv1.2' } : {});
    const timer = setTimeout(() => done({ status: 0, body: '', error: 'timeout' }), timeoutMs);
    client.on('error', (err) => { clearTimeout(timer); done({ status: 0, body: '', error: String(err?.message ?? err) }); });
    const req = client.request({
      ':path': u.pathname + u.search,
      ':method': 'GET',
      'user-agent': UA,
      ...HEADERS,
    });
    let status = 0;
    let body = '';
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (c) => (body += c));
    req.on('end', () => { clearTimeout(timer); done({ status, body }); });
    req.on('error', (err) => { clearTimeout(timer); done({ status: 0, body: '', error: String(err?.message ?? err) }); });
    req.end();
  });
}

async function viaCurl(url, timeoutMs = 20_000) {
  try {
    const { stdout } = await pExecFile('curl', [
      '-sS', '--max-time', String(Math.round(timeoutMs / 1000)),
      '-A', UA,
      '-H', `accept: ${HEADERS.accept}`,
      '-H', `referer: ${HEADERS.referer}`,
      '-w', '\n__STATUS__%{http_code}',
      url,
    ], { maxBuffer: 64 * 1024 * 1024 });
    const m = stdout.match(/\n__STATUS__(\d+)$/);
    return { status: m ? parseInt(m[1], 10) : 0, body: m ? stdout.slice(0, m.index) : stdout };
  } catch (err) {
    return { status: 0, body: '', error: String(err?.message ?? err).slice(0, 200) };
  }
}

await mkdir(OUT, { recursive: true });

const TRANSPORTS = [
  ['fetch', () => viaFetch(API_PLANS)],
  ['https-default', () => viaHttps(API_PLANS)],
  ['https-chrome-ciphers', () => viaHttps(API_PLANS, { ciphers: CHROME_CIPHERS })],
  ['http2-default', () => viaHttp2(API_PLANS)],
  ['http2-chrome-ciphers', () => viaHttp2(API_PLANS, { ciphers: CHROME_CIPHERS })],
  ['curl', () => viaCurl(API_PLANS)],
];

const results = [];
let winner = null;
for (const [name, fn] of TRANSPORTS) {
  const started = Date.now();
  const res = await fn();
  const r = { transport: name, status: res.status, bytes: res.body.length, ms: Date.now() - started, error: res.error };
  console.log('probe:', JSON.stringify(r));
  results.push(r);
  if (!winner && res.status === 200 && res.body.length > 10_000) {
    winner = { name, body: res.body };
  }
  await new Promise((r2) => setTimeout(r2, 800));
}
await save('mihomes-transport-probes.json', results);

if (winner) {
  console.log(`winner: ${winner.name} — dumping structures`);
  try {
    const parsed = JSON.parse(winner.body);
    await save('mihomes-plans.deep.pruned.json', prune(parsed, 0, 3));
    const communities = parsed.communities ?? parsed.Communities ?? [];
    const target = Array.isArray(communities)
      ? communities.find((c) => /sweetwater|nautique|palmera/i.test(JSON.stringify(c).slice(0, 6000)))
      : null;
    if (target) await save('mihomes-plans.target-community.pruned.json', prune(target, 0, 12));
  } catch (e) {
    await save('mihomes-plans.parse-error.txt', String(e) + '\n\n' + winner.body.slice(0, 5000));
  }
  // Same transport against the inventory variant.
  const invFn = {
    fetch: () => viaFetch(API_INVENTORY),
    'https-default': () => viaHttps(API_INVENTORY),
    'https-chrome-ciphers': () => viaHttps(API_INVENTORY, { ciphers: CHROME_CIPHERS }),
    'http2-default': () => viaHttp2(API_INVENTORY),
    'http2-chrome-ciphers': () => viaHttp2(API_INVENTORY, { ciphers: CHROME_CIPHERS }),
    curl: () => viaCurl(API_INVENTORY),
  }[winner.name];
  const inv = await invFn();
  console.log('inventory via winner:', inv.status, inv.body.length, 'bytes');
  if (inv.status === 200 && inv.body.length > 5_000) {
    try {
      const parsed = JSON.parse(inv.body);
      await save('mihomes-inventory.deep.pruned.json', prune(parsed, 0, 3));
      const communities = parsed.communities ?? [];
      const target = Array.isArray(communities)
        ? communities.find((c) => /sweetwater|nautique|palmera/i.test(JSON.stringify(c).slice(0, 6000)))
        : null;
      if (target) await save('mihomes-inventory.target-community.pruned.json', prune(target, 0, 12));
    } catch {}
  }
} else {
  console.log('no transport passed — M/I needs Playwright-in-Actions');
}
console.log('round-9 complete');
