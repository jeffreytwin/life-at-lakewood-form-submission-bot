// Toll Brothers: where does a base plan's "Media Showcase" come from?
// (2026-09-19) The plan page's __NEXT_DATA__ carries the elevations, the
// walkthrough and the description, but gallery.mediaGroups is [] there for
// base plans (quick move-in pages do carry theirs). The page also carries
// pageData.apiUrl (/api/v2/community/<id>/model/<id>), which is the likely
// client-side source. Two probes, both from a runner with egress:
//   1. plain fetch of the API URL and a few variants, recording status,
//      shape and any captioned images;
//   2. a real browser on one plan page, recording every JSON response the
//      page fetches and reading the rendered Media Showcase out of the DOM
//      (image URLs + captions), which is the ground truth to match against.
// Output: pipeline/slice/discovery/toll-api/. Playwright is optional: the
// workflow installs it with continue-on-error, and the script skips step 2
// when it is missing.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://www.tollbrothers.com';
const MASTER = ORIGIN + '/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch';
const OUT = path.join(import.meta.dirname, 'discovery', 'toll-api');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function prune(node, depth = 0, arrayCap = 8) {
  if (typeof node === 'string') return node.length > 300 ? node.slice(0, 300) + `…(${node.length})` : node;
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

/** Objects that look like captioned photos, wherever they sit, with the paths they sit at. */
function captionedImages(root) {
  const found = [];
  const paths = new Set();
  (function walk(n, p, d) {
    if (d > 16) return;
    if (Array.isArray(n)) { n.forEach((x, i) => walk(x, `${p}[${i}]`, d + 1)); return; }
    if (n && typeof n === 'object') {
      const type = String(n.type ?? '').toLowerCase();
      const url = typeof n.url === 'string' ? n.url : typeof n.src === 'string' ? n.src : null;
      const caption = typeof n.description === 'string' ? n.description : typeof n.caption === 'string' ? n.caption : null;
      if (url && caption && (type === 'image' || /\.(jpe?g|png|webp)(\?|$)/i.test(url))) {
        found.push({ caption: caption.slice(0, 90), url: url.slice(-70) });
        paths.add(p.replace(/\[\d+\]/g, '[]'));
      }
      for (const [k, v] of Object.entries(n)) walk(v, `${p}.${k}`, d + 1);
    }
  })(root, '$', 0);
  return { count: found.length, samples: found.slice(0, 6), paths: [...paths].slice(0, 12) };
}

async function getPage(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return { status: res.status, data: m ? JSON.parse(m[1]) : null, html };
}

async function getJson(url, referer) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', referer, 'x-requested-with': 'XMLHttpRequest' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, contentType: res.headers.get('content-type'), bytes: text.length, json, head: json ? null : text.slice(0, 200) };
  } catch (e) {
    return { status: null, error: String(e).slice(0, 200) };
  }
}

const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

await mkdir(OUT, { recursive: true });
const summary = { capturedAt: new Date().toISOString(), plainProbes: [], playwright: null };

const master = await getPage(MASTER);
const mc = master.data?.props?.pageProps?.pageData?.masterCommunityComponent;
const bases = (mc?.homes?.models ?? []).filter((m) => m?.url && !m.isQMI).map((m) => m.url);
const qmis = [];
for (const c of mc?.communities ?? []) for (const m of c?.homes?.models ?? []) for (const q of m?.qmis ?? []) if (q?.url) qmis.push(q.url);
const targets = [...bases.slice(0, 2), ...qmis.slice(0, 1)];

// ---- 1. plain fetch probes of the model API ----
for (const url of targets) {
  const page = await getPage(url);
  const pd = page.data?.props?.pageProps?.pageData ?? {};
  const model = pd.modelComponent ?? {};
  const apiUrl = typeof pd.apiUrl === 'string' ? pd.apiUrl : null;
  const entry = { url, status: page.status, apiUrl, internetId: pd.internetId ?? null, masterPlanID: model.masterPlanID ?? null, communityId: model.communityId ?? null, isQMI: model.isQMI ?? null, probes: [] };
  const variants = new Set();
  if (apiUrl) {
    for (const suffix of ['', '/media', '/gallery', '/mediagroups', '/images', '?includeMedia=true', '?media=true']) variants.add(apiUrl + suffix);
  }
  if (model.communityId && model.masterPlanID) {
    variants.add(`/api/v2/community/${model.communityId}/model/${model.masterPlanID}/media`);
    variants.add(`/api/v2/model/${model.masterPlanID}`);
    variants.add(`/api/v2/model/${model.masterPlanID}/media`);
    variants.add(`/api/v2/community/${model.communityId}`);
  }
  for (const v of variants) {
    const r = await getJson(ORIGIN + v, url);
    const probe = { path: v, status: r.status, contentType: r.contentType ?? null, bytes: r.bytes ?? null, error: r.error ?? null, head: r.head ?? null };
    if (r.json) {
      probe.keys = Array.isArray(r.json) ? `array[${r.json.length}]` : Object.keys(r.json).slice(0, 40);
      probe.captioned = captionedImages(r.json);
      if (v === apiUrl || probe.captioned.count > 0) {
        const file = `${slugOf(url.split('/').slice(-2).join('-'))}${slugOf(v.replace(apiUrl ?? '', ''))}.pruned.json`;
        await writeFile(path.join(OUT, file), JSON.stringify(prune(r.json), null, 1));
        probe.saved = file;
      }
    }
    entry.probes.push(probe);
  }
  summary.plainProbes.push(entry);
}

// ---- 2. a real browser on the first base plan page ----
const SKIP_URL = /google|gstatic|doubleclick|facebook|hotjar|clarity|mouseflow|bc0a|hs-scripts|hubspot|cookielaw|onetrust|newrelic|\.(png|jpe?g|webp|svg|gif|css|woff2?|mp4)([?#]|$)/i;
try {
  const { chromium } = await import('playwright');
  const target = bases[0];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', userAgent: UA });
  const page = await context.newPage();
  const captured = [];
  page.on('response', async (res) => {
    try {
      const u = res.url();
      if (SKIP_URL.test(u)) return;
      const ct = res.headers()['content-type'] ?? '';
      if (!/json|javascript/.test(ct) && !/api|graphql/i.test(u)) return;
      if (!/json/.test(ct)) { captured.push({ url: u.slice(0, 200), status: res.status(), contentType: ct }); return; }
      const json = await res.json().catch(() => null);
      const info = { url: u.slice(0, 200), status: res.status(), contentType: ct, captioned: json ? captionedImages(json) : null };
      if (json && info.captioned.count > 0) {
        const file = `xhr-${captured.length}-${slugOf(new URL(u).pathname)}.pruned.json`;
        await writeFile(path.join(OUT, file), JSON.stringify(prune(json), null, 1));
        info.saved = file;
      }
      captured.push(info);
    } catch { /* ignore */ }
  });
  await page.goto(target, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
  // The showcase may load on scroll.
  for (let y = 0; y < 8000; y += 800) {
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(3000);
  const dom = await page.evaluate(() => {
    const sectionOf = (label) => {
      const el = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div')].find((e) => e.childElementCount === 0 && e.textContent.trim().toLowerCase() === label.toLowerCase());
      if (!el) return null;
      const section = el.closest('section') ?? el.parentElement?.parentElement?.parentElement ?? el.parentElement;
      const imgs = [...section.querySelectorAll('img')].map((i) => ({ src: (i.currentSrc || i.src || '').slice(0, 200), alt: (i.alt || '').slice(0, 120) }));
      const texts = [...section.querySelectorAll('figcaption,p,span,div')].filter((e) => e.childElementCount === 0).map((e) => e.textContent.trim()).filter((t) => t && t.length < 140);
      return { imgs: imgs.slice(0, 40), texts: [...new Set(texts)].slice(0, 60) };
    };
    const tourLinks = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /matterport|insidemaps|walkthrough|tour/i.test(h)).slice(0, 10);
    return { showcase: sectionOf('Media Showcase'), exteriors: sectionOf('Exterior Designs'), tourLinks, title: document.title };
  }).catch((e) => ({ error: String(e).slice(0, 200) }));
  await writeFile(path.join(OUT, 'showcase-dom.json'), JSON.stringify(dom, null, 1));
  summary.playwright = { target, responses: captured.slice(0, 80), dom: { showcaseImgs: dom?.showcase?.imgs?.length ?? null, showcaseTexts: dom?.showcase?.texts?.slice(0, 12) ?? null, exteriorImgs: dom?.exteriors?.imgs?.length ?? null, tourLinks: dom?.tourLinks ?? null } };
  await browser.close();
} catch (e) {
  summary.playwright = { skipped: String(e).slice(0, 300) };
}

await writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1).slice(0, 6000));
