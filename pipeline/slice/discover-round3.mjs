// Round-3 discovery (GitHub Actions; no egress from the dev sandbox).
// Round 2 established: Meritage renders its plan grid client-side (the
// __NEXT_DATA__ is only a Sitecore layout shell), Mattamy embeds a full
// __JSS_STATE__ (over-pruned in round 2), M/I exposes /api/v1/community/
// hometypes/, Taylor Morrison has per-community /floor-plans pages in its
// sitemap, DRB serves plain server-rendered pages, and Lee Wetherington's
// homepage is a 114-byte JS shell. This round digs one level deeper on
// each: bundle-grepping for the Meritage data API and probing whatever
// candidates surface, dumping raw JSS state for Mattamy, resolving M/I
// community ids and hitting the API, and grabbing content-bearing pages
// for the rest. Output: pipeline/slice/discovery/round3/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'round3');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
};

async function get(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, url: res.url, text, type: res.headers.get('content-type') ?? '' };
  } catch (err) {
    return { status: 0, url, text: '', type: '', error: String(err?.message ?? err) };
  }
}

function prune(node, depth = 0, arrayCap = 3) {
  if (typeof node === 'string') return node.length > 200 ? node.slice(0, 200) + `…(${node.length})` : node;
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

async function section(name, fn) {
  try {
    await fn();
    console.log(`[${name}] done`);
  } catch (err) {
    console.log(`[${name}] FAILED: ${err?.stack ?? err}`);
    await save(`${name}.error.txt`, String(err?.stack ?? err)).catch(() => {});
  }
}

/** Visible-text sample: is this page fetch_claude-friendly? */
function textSample(html, max = 7000) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    chars: stripped.length,
    prices: (stripped.match(/\$\s?\d{3},\d{3}/g) ?? []).length,
    sqfts: (stripped.match(/\b[\d,]{3,6}\s*(?:sq\.?\s*ft|sqft|square\s+feet)/gi) ?? []).length,
    sample: stripped.slice(0, max),
  };
}

/** Grep a JS bundle for data-endpoint construction, with context. */
function grepEndpoints(js, contextChars = 260) {
  const found = [];
  const seen = new Set();
  const patterns = [
    /["'`](https?:\/\/[^"'`\s]{8,200}?(?:api|graphql|search|odata)[^"'`\s]{0,100})["'`]/gi,
    /["'`](\/(?:api|graphql|sitecore|sxa|webapi|coveo)[A-Za-z0-9_\-./?=&{}$]{2,160})["'`]/gi,
    /["'`]([A-Za-z0-9_\-./]{0,60}(?:plansearch|communitysearch|homesearch|quickmove|qmi|inventory|floorplan)[A-Za-z0-9_\-./?=&{}$]{0,80})["'`]/gi,
    /sc_apikey[=:]\s*["'{]?([A-F0-9-]{8,40})/gi,
  ];
  for (const re of patterns) {
    for (const m of js.matchAll(re)) {
      const key = m[1];
      if (seen.has(key) || found.length > 80) continue;
      seen.add(key);
      const start = Math.max(0, m.index - contextChars);
      found.push({ hit: key, context: js.slice(start, m.index + key.length + contextChars) });
    }
  }
  return found;
}

/** Fetch same-site script bundles referenced by a page. */
async function fetchBundles(html, pageUrl, maxBundles = 10) {
  const origin = new URL(pageUrl).origin;
  const pageHostBase = new URL(pageUrl).hostname.replace(/^www\./, '');
  const srcs = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    let src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) src = origin + src;
    if (!/^https?:/.test(src)) continue;
    if (!new URL(src).hostname.endsWith(pageHostBase)) continue;
    if (/gtm|analytics|tag|pixel|consent|cookie|recaptcha|youtube/i.test(src)) continue;
    if (!srcs.includes(src)) srcs.push(src);
  }
  const out = [];
  for (const src of srcs.slice(0, maxBundles)) {
    const res = await get(src);
    out.push({ src, status: res.status, bytes: res.text.length, js: res.status === 200 ? res.text : '' });
  }
  return out;
}

await mkdir(OUT, { recursive: true });
const summary = {};

// 1. MERITAGE — find the client-side data API in the Next.js chunks, then
//    probe every plausible candidate for JSON.
await section('meritage', async () => {
  const page = await get('https://www.meritagehomes.com/state/fl/tampa/salt-meadows-classic-series');
  if (page.status !== 200) throw new Error(`series page: ${page.status}`);
  const bundles = await fetchBundles(page.text, page.url, 14);
  const allHits = [];
  for (const b of bundles) {
    if (!b.js) continue;
    const hits = grepEndpoints(b.js);
    if (hits.length) allHits.push({ src: b.src, hits });
  }
  await save('meritage-bundle-grep.json', allHits);

  // Probe candidates that look like data APIs (not asset CDNs).
  const candidates = new Set();
  for (const { hits } of allHits) {
    for (const { hit } of hits) {
      if (/sitecorecontenthub|\.(png|jpe?g|svg|css|woff)/i.test(hit)) continue;
      if (/plan|community|home|search|qmi|inventory|graphql/i.test(hit)) {
        const url = hit.startsWith('http') ? hit : hit.startsWith('/') ? `https://www.meritagehomes.com${hit}` : null;
        if (url && !/[{$]/.test(url)) candidates.add(url);
      }
    }
  }
  const probes = [];
  for (const url of [...candidates].slice(0, 12)) {
    const res = await get(url, { accept: 'application/json' });
    const isJson = /json/i.test(res.type) || /^[[{]/.test(res.text.trim());
    probes.push({ url, status: res.status, type: res.type, json: isJson });
    if (res.status === 200 && isJson) {
      try {
        await save(`meritage-probe-${probes.length - 1}.pruned.json`, prune(JSON.parse(res.text), 0, 5));
      } catch { /* not parseable */ }
    }
  }
  await save('meritage-probes.json', probes);
  summary.meritage = { bundlesWithHits: allHits.length, candidates: candidates.size, probes };
});

// 2. MATTAMY — commit the RAW __JSS_STATE__ (round 2's prune hid the content
//    placeholders) and hunt the bundles for the Apollo/GraphQL endpoint.
await section('mattamy', async () => {
  const results = [];
  for (const [slug, url] of [
    ['brightmore', 'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/brightmore'],
    ['lakespur', 'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/lakespur'],
  ]) {
    const page = await get(url);
    const r = { slug, url, status: page.status };
    if (page.status === 200) {
      const m = page.text.match(/<script[^>]*id=["']__JSS_STATE__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (m) {
        await save(`mattamy-${slug}.jss-state.json`, m[1]); // raw, full
        r.jssBytes = m[1].length;
      }
      if (slug === 'brightmore') {
        const bundles = await fetchBundles(page.text, page.url, 8);
        const hits = bundles.flatMap((b) => (b.js ? grepEndpoints(b.js).map((h) => ({ src: b.src, ...h })) : []));
        await save('mattamy-bundle-grep.json', hits.slice(0, 60));
        r.bundleHits = hits.length;
      }
    }
    results.push(r);
  }
  await save('mattamy-summary.json', results);
  summary.mattamy = results.map(({ slug, status, jssBytes }) => ({ slug, status, jssBytes }));
});

// 3. M/I HOMES — resolve community ids from the metro pages, then hit
//    /api/v1/community/hometypes/. Also save context around every /api/v1
//    reference in search.js so the full API surface is visible.
await section('mihomes', async () => {
  const searchJs = await get('https://cdn.mihomes.com/assets/toolkit/js/search.js');
  if (searchJs.status === 200) {
    const ctx = [];
    for (const m of searchJs.text.matchAll(/\/api\/v1\//g)) {
      ctx.push(searchJs.text.slice(Math.max(0, m.index - 400), m.index + 400));
      if (ctx.length >= 12) break;
    }
    await save('mihomes-api-contexts.txt', ctx.join('\n\n========\n\n'));
  }
  const listing = await get('https://www.mihomes.com/new-homes/florida/sarasota-metro/communities');
  const ids = new Set();
  const links = new Set();
  if (listing.status === 200) {
    for (const m of listing.text.matchAll(/(?:communityId|community-id|CommunityId)["'=:\s]+(\d{2,7})/g)) ids.add(m[1]);
    for (const m of listing.text.matchAll(/href=["'](\/new-homes\/florida\/[^"']*(?:sweetwater|nautique|palmera)[^"']*)["']/gi)) links.add(m[1]);
  }
  const community = links.size
    ? await get(`https://www.mihomes.com${[...links][0]}`)
    : null;
  if (community?.status === 200) {
    for (const m of community.text.matchAll(/(?:communityId|community-id|CommunityId)["'=:\s]+(\d{2,7})/g)) ids.add(m[1]);
    await save('mihomes-community.state.txt', textSample(community.text).sample.slice(0, 4000));
  }
  const probes = [];
  const probeUrls = [...ids].slice(0, 3).map((id) => `https://www.mihomes.com/api/v1/community/hometypes/${id}`);
  probeUrls.push('https://www.mihomes.com/api/v1/community/hometypes/');
  for (const url of probeUrls) {
    const res = await get(url, { accept: 'application/json' });
    const isJson = /json/i.test(res.type) || /^[[{]/.test(res.text.trim());
    probes.push({ url, status: res.status, json: isJson, bytes: res.text.length });
    if (res.status === 200 && isJson) {
      try { await save(`mihomes-probe-${probes.length - 1}.pruned.json`, prune(JSON.parse(res.text), 0, 5)); } catch {}
    }
  }
  await save('mihomes-summary.json', { searchJs: searchJs.status, communityLinks: [...links].slice(0, 10), ids: [...ids].slice(0, 20), probes });
  summary.mihomes = { ids: ids.size, probes: probes.map((p) => ({ url: p.url.slice(-40), status: p.status, json: p.json })) };
});

// 4. TAYLOR MORRISON — the sitemap exposes per-community floor-plans and
//    QMI pages. Are they server-rendered enough for fetch_claude / do they
//    embed JSON?
await section('taylor-morrison', async () => {
  const results = [];
  for (const [slug, url] of [
    ['firethorn-floorplans', 'https://www.taylormorrison.com/fl/tampa/parrish/firethorn/floor-plans'],
    ['firethorn-plan-ambrosia', 'https://www.taylormorrison.com/fl/tampa/parrish/firethorn/floor-plans/ambrosia'],
    ['firethorn-qmi', 'https://www.taylormorrison.com/fl/tampa/parrish/firethorn/available-homes'],
  ]) {
    const page = await get(url);
    const r = { slug, url, status: page.status };
    if (page.status === 200) {
      r.text = textSample(page.text, 5500);
      const blocks = [...page.text.matchAll(/<script([^>]*type=["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi)]
        .map((m) => ({ attrs: m[1].trim().slice(0, 160), bytes: m[2].length, body: m[2] }))
        .sort((a, b) => b.bytes - a.bytes);
      r.jsonScripts = blocks.map(({ attrs, bytes }) => ({ attrs, bytes })).slice(0, 8);
      for (const [i, b] of blocks.slice(0, 2).entries()) {
        try { await save(`taylor-${slug}.json-block-${i}.pruned.json`, { attrs: b.attrs, data: prune(JSON.parse(b.body), 0, 6) }); } catch {}
      }
      if (slug === 'firethorn-floorplans') {
        const bundles = await fetchBundles(page.text, page.url, 8);
        const hits = bundles.flatMap((b) => (b.js ? grepEndpoints(b.js).map((h) => ({ src: b.src, ...h })) : []));
        await save('taylor-bundle-grep.json', hits.slice(0, 60));
      }
    }
    const { text, ...rest } = r;
    results.push({ ...rest, text: text ? { chars: text.chars, prices: text.prices, sqfts: text.sqfts } : undefined });
    if (text) await save(`taylor-${slug}.text.txt`, `prices=${text.prices} sqfts=${text.sqfts} chars=${text.chars}\n\n${text.sample}`);
  }
  await save('taylor-summary.json', results);
  summary.taylorMorrison = results;
});

// 5. DRB — no embedded state; find the plan/QMI content pages and judge
//    fetch_claude fit from visible text.
await section('drb', async () => {
  const base = 'https://www.drbhomes.com/drbhomes/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire';
  const results = [];
  for (const tab of ['overview', 'floorplans', 'floor-plans', 'homes', 'quick-move-ins', 'available-homes']) {
    const page = await get(`${base}/${tab}`);
    const r = { tab, status: page.status, finalUrl: page.url };
    if (page.status === 200) {
      const t = textSample(page.text, 5500);
      r.prices = t.prices; r.sqfts = t.sqfts; r.chars = t.chars;
      await save(`drb-${tab}.text.txt`, `prices=${t.prices} sqfts=${t.sqfts} chars=${t.chars}\n\n${t.sample}`);
      for (const m of page.text.matchAll(/href=["']([^"']*(?:floorplan|floor-plan|quick|move-in|homesite)[^"']*)["']/gi)) {
        (r.links ??= new Set()).add(m[1]);
      }
      if (r.links) r.links = [...r.links].slice(0, 15);
    }
    results.push(r);
  }
  await save('drb-summary.json', results);
  summary.drb = results.map(({ tab, status, prices, sqfts }) => ({ tab, status, prices, sqfts }));
});

// 6. LEE WETHERINGTON — homepage was a 114-byte shell; try the other
//    domain, save what the shell actually contains, follow meta-refresh.
await section('lee-wetherington', async () => {
  const results = [];
  for (const url of ['https://leewetherington.com/', 'https://www.leewetheringtonhomes.com/', 'https://lwhomes.net/']) {
    const page = await get(url);
    const r = { url, status: page.status, finalUrl: page.url, bytes: page.text.length };
    if (page.status === 200) {
      r.head = page.text.slice(0, 1200);
      const refresh = page.text.match(/http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i) || page.text.match(/location\.(?:href|replace)\s*[=(]\s*["']([^"']+)["']/i);
      if (refresh) {
        const target = refresh[1].startsWith('http') ? refresh[1] : new URL(refresh[1], page.url).href;
        r.redirectsTo = target;
        const follow = await get(target);
        r.followStatus = follow.status;
        if (follow.status === 200) {
          const t = textSample(follow.text, 4000);
          r.followText = { chars: t.chars, prices: t.prices, sqfts: t.sqfts };
          await save('lee-wetherington-followed.text.txt', t.sample);
        }
      }
    }
    results.push(r);
  }
  await save('lee-wetherington-summary.json', results);
  summary.leeWetherington = results.map(({ url, status, bytes, redirectsTo, followStatus }) => ({ url, status, bytes, redirectsTo, followStatus }));
});

// 7. NEAL SIGNATURE via nealcommunities.com — fetch the parent-site pages
//    found in round 2 and check whether they carry the Signature plans.
await section('neal-signature', async () => {
  const urls = [
    'https://www.nealcommunities.com/communities/waterbury-park',
    'https://www.nealcommunities.com/communities/the-alcove',
  ];
  // Round 2 saved the actual sitemap matches; also re-derive here so this
  // section is self-contained if the guesses are wrong.
  const smRes = await get('https://www.nealcommunities.com/sitemap.xml');
  if (smRes.status === 200) {
    for (const m of smRes.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      if (/waterbury|alcove/i.test(m[1]) && !/\.xml/.test(m[1]) && urls.length < 6 && !urls.includes(m[1])) urls.push(m[1]);
    }
  }
  const results = [];
  for (const url of urls.slice(0, 5)) {
    const page = await get(url);
    const r = { url, status: page.status, finalUrl: page.url };
    if (page.status === 200) {
      const t = textSample(page.text, 4500);
      r.prices = t.prices; r.sqfts = t.sqfts; r.chars = t.chars;
      await save(`neal-sig-${results.length}.text.txt`, `url=${url}\nprices=${t.prices} sqfts=${t.sqfts} chars=${t.chars}\n\n${t.sample}`);
    }
    results.push(r);
  }
  await save('neal-signature-summary.json', results);
  summary.nealSignature = results.map(({ url, status, prices, sqfts }) => ({ url: url.slice(-40), status, prices, sqfts }));
});

await save('round3-summary.json', summary);
console.log('round-3 discovery complete:', JSON.stringify(summary, null, 1));
