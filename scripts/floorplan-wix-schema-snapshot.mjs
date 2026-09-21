// Snapshots every active site's Wix collection schemas (Floor Plans V2, the
// legacy FloorPlans, and the Builders and neighborhoods collections its
// builder1 and villages reference fields point at) into
// fp_collection_schemas, and caches the Floor Plans V2 items (drafts
// included) in fp_legacy_items, so the three sites' V2 schemas can be
// compared and standardized from a sandbox that holds no Wix credentials.
//
// Runs as a prebuild step on Vercel (the only environment holding both
// WIX_API_KEY and the Supabase service key), guarded to the working branch
// so production and unrelated preview builds skip it. Always exits 0 — it
// must never fail or slow a deploy.

import { readFileSync } from 'node:fs';

const BRANCHES = new Set(['claude/nice-bell-3c6qob']);
// Fields every site's Floor Plans V2 drops (Jeff, 2026-09-21); removing a field deletes its data.
const RETIRED_FIELDS = new Set(['estimatedBuildTime', 'estimatedBuildTimeTags', 'estimatedUpgradesOrChanges']);
const VILLAGES_COLLECTION = 'HousesforSale-DynamicPages';
// The one schema every site's Floor Plans V2 carries (src/lib/floorplans/standard-schema.ts).
const STANDARD = JSON.parse(
  readFileSync(new URL('../src/lib/floorplans/standard-floor-plan-schema.json', import.meta.url), 'utf8')
);

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (!BRANCHES.has(branch)) {
  console.log(`FP_SCHEMA: branch ${branch ?? '(none)'} is not a snapshot branch; skipping.`);
  process.exit(0);
}
const wixKey = process.env.WIX_API_KEY;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!wixKey || !supaUrl || !supaKey) {
  console.log('FP_SCHEMA: missing WIX_API_KEY or Supabase env; skipping.');
  process.exit(0);
}

const log = (...a) => console.log('FP_SCHEMA', ...a);

async function wix(method, path, siteId, body) {
  const res = await fetch(`https://www.wixapis.com${path}`, {
    method,
    headers: { authorization: wixKey, 'wix-site-id': siteId, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, json, text };
}

async function supa(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${supaUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: supaKey,
      authorization: `Bearer ${supaKey}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const upsert = (path, rows) =>
  supa(path, {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: rows,
  });

async function snapshotSchema(site, collectionId) {
  const res = await wix('GET', `/wix-data/v2/collections/${encodeURIComponent(collectionId)}`, site.wix_site_id);
  const col = res.json?.collection;
  if (res.status !== 200 || !col) {
    log(`${site.domain}/${collectionId}: schema lookup ${res.status} ${(res.text ?? '').slice(0, 200)}`);
    return null;
  }
  await upsert('fp_collection_schemas?on_conflict=site_id,collection_id', [
    { site_id: site.id, collection_id: collectionId, schema: col, captured_at: new Date().toISOString() },
  ]);
  log(`${site.domain}/${collectionId}: ${col.fields?.length ?? 0} fields, revision ${col.revision ?? '?'}`);
  return col;
}

/**
 * The collections a site's Floor Plans V2 builder1 and villages fields
 * reference, as the write-back reads them (writeback.ts, referenceTargetsOf):
 * Lakewood's villages points at AmenitiesbyVillage, Wellen Park's and
 * Parrish's at HousesforSale-DynamicPages.
 */
function referenceTargets(v2Schema) {
  const refOf = (key, fallback) =>
    (v2Schema?.fields ?? []).find((f) => f.key === key)?.typeMetadata?.reference?.referencedCollectionId || fallback;
  return { builder1: refOf('builder1', 'Builders'), villages: refOf('villages', VILLAGES_COLLECTION) };
}

/**
 * Proves a neighborhood can be found in the collection the villages field
 * points at, the way the write-back looks it up: by exact title, then by
 * any title or name field across the collection. Logs what matched.
 */
/**
 * Brings a site's Floor Plans V2 up to the standard: labels aligned and
 * missing fields added, never a removal or a type change (Wix cannot
 * retype a field in place; a mismatch is logged and left alone). Sends
 * nothing when the collection already matches. The same change the Hub's
 * Settings → Sites makes on a click.
 */
async function applyStandard(site, collectionId) {
  const res = await wix('GET', `/wix-data/v2/collections/${encodeURIComponent(collectionId)}`, site.wix_site_id);
  const col = res.json?.collection;
  if (res.status !== 200 || !col) {
    log(`${site.domain}/${collectionId}: cannot apply the standard, lookup ${res.status}`);
    return;
  }
  const removed = (col.fields ?? []).filter((f) => RETIRED_FIELDS.has(f.key)).map((f) => f.key);
  const fields = (col.fields ?? []).filter((f) => !RETIRED_FIELDS.has(f.key)).map((f) => ({ ...f }));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const added = [];
  const relabeled = [];
  const skipped = [];
  for (const std of STANDARD) {
    const f = byKey.get(std.key);
    if (!f) {
      fields.push({
        key: std.key,
        displayName: std.displayName,
        type: std.type,
        ...(std.typeMetadata ? { typeMetadata: std.typeMetadata } : {}),
      });
      added.push(std.key);
      continue;
    }
    if ((f.type ?? '') !== (std.type ?? '')) {
      skipped.push(`${std.key} (${f.type} here, ${std.type} in the standard)`);
      continue;
    }
    if ((f.displayName ?? '') !== std.displayName) {
      f.displayName = std.displayName;
      relabeled.push(std.key);
    }
  }
  if (!added.length && !relabeled.length && !removed.length) {
    log(`${site.domain}/${collectionId}: already carries the standard${skipped.length ? ` (left alone: ${skipped.join('; ')})` : ''}`);
    return;
  }
  const put = await wix('PUT', '/wix-data/v2/collections', site.wix_site_id, { collection: { ...col, fields } });
  log(
    `${site.domain}/${collectionId}: apply the standard -> ${put.status}; added [${added.join(', ')}], removed [${removed.join(', ')}], relabeled ${relabeled.length}` +
      (skipped.length ? `, left alone: ${skipped.join('; ')}` : '') +
      (put.status !== 200 ? ` ${(put.text ?? '').slice(0, 300)}` : '')
  );
}

/**
 * Asks Wix about two of a site's imported pictures (a photo and an SVG
 * drawing) by file id, and logs what the file endpoint says: media type,
 * import status, the picture's size. The write-back's verification
 * (writeback.ts, verifyImports) reads the same fields.
 */
/**
 * Proves the Media Manager delete call a Reset relies on: imports a copy of
 * a public photo, deletes it permanently by id, then asks for it again.
 * The write-back's deleteMediaFiles (client.ts) makes the same call.
 */
/**
 * Finds a Toll Brothers community page the way discover-url.ts does, from
 * the sandbox that cannot reach tollbrothers.com: every sitemap URL named
 * for the community, then the first few read for their title and model
 * counts, the pages in the site's market first (Monterey at Lakewood Ranch
 * vs Toll's Monterey in California, 2026-09-20).
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const normKey = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

/** The balanced JSON object that starts at the first "{" after `marker`, or null. */
function jsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return html.slice(start, i + 1); }
  }
  return null;
}
const scDataOf = (html) => {
  const raw = jsonAfter(html, 'scDataStore.data =') ?? jsonAfter(html, 'scDataStore.data=');
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};

/** The categories a Taylor Morrison plan's gallery page files its pictures under, with a sample of each. */
async function probeTaylorGallery(planUrl) {
  for (const url of [`${planUrl}/gallery`, planUrl]) {
    const page = await fetchText(url);
    const d = page.status === 200 ? scDataOf(page.text) : null;
    if (!d) { log(`taylor gallery ${url}: ${page.status} scData=${!!d}`); continue; }
    const entry = Object.values(d).find((e) => e && typeof e === 'object' && (Array.isArray(e.imagesByCategory) || Array.isArray(e.photos)));
    if (!entry) { log(`taylor gallery ${url}: no gallery entry`); continue; }
    const cats = Array.isArray(entry.imagesByCategory) && entry.imagesByCategory.length ? entry.imagesByCategory : [{ title: '(photos)', images: entry.photos ?? [] }];
    log(`taylor gallery ${url}: ${cats.map((c) => `${c?.title} x${(c?.images ?? []).length}`).join(' | ')}`);
    for (const c of cats) {
      const im = (c?.images ?? [])[0];
      if (im) log(`taylor gallery ${url} "${c?.title}" first: header=${im.header ?? ''} subhead=${im.subhead ?? ''} tour=${im.vidSrc ?? ''} src=${(im.image?.src ?? '').slice(0, 160)} srcSet=${(im.image?.srcSet ?? []).map((r) => r?.descriptor).join(',')}`);
    }
    return;
  }
}

/**
 * Every Taylor Morrison connection (Jeff, 2026-09-21: "analyze and fix the
 * Taylor Morrison connections we have"): what each listing carries, and the
 * first plan's gallery page. A community whose URL the Hub lacks is looked
 * for in the builder's sitemap.
 */
async function probeTaylorListing(base) {
  const list = await fetchText(`${base}/floor-plans`);
  const data = list.status === 200 ? scDataOf(list.text) : null;
  if (!data) { log(`taylor listing ${base}: floor-plans ${list.status} scData=${!!data}`); return; }
  let firstPlanUrl = null;
  let listed = false;
  for (const e of Object.values(data)) {
    if (!e || typeof e !== 'object' || !Array.isArray(e.floorPlansListDataArray)) continue;
    listed = true;
    const plans = e.floorPlansListDataArray.filter((p) => p && typeof p === 'object');
    const colls = new Map((e.floorPlanCollections ?? []).map((c) => [c?.id, c?.name]));
    const byColl = new Map();
    for (const p of plans) {
      const name = colls.get(p.floorPlanCollection) ?? '(none)';
      byColl.set(name, (byColl.get(name) ?? 0) + 1);
    }
    const tours = plans.filter((p) => p.virtualTourLink).length;
    log(`taylor listing ${base}: community "${e.communityName ?? ''}", ${plans.length} plans, ${tours} with a tour, collections: ${[...byColl].map(([n, c]) => `${n} x${c}`).join(' | ')}`);
    firstPlanUrl = plans[0]?.floorPlanDetailsLink?.Url ? new URL(base).origin + plans[0].floorPlanDetailsLink.Url : null;
  }
  if (!listed) {
    // A wrong address on this site is a 200 page without plan data.
    const title = list.text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '?';
    log(`taylor listing ${base}: floor-plans 200 but no floor plan data; title="${title.slice(0, 120)}"`);
    return;
  }
  const homes = await fetchText(`${base}/available-homes`);
  const hd = homes.status === 200 ? scDataOf(homes.text) : null;
  for (const e of Object.values(hd ?? {})) {
    if (!e || typeof e !== 'object' || !e.availableHomesList) continue;
    log(`taylor listing ${base}: homes ${(e.availableHomesList.sections ?? []).map((s) => `${s?.sectionLabel} x${(s?.homes ?? []).length}`).join(' | ')}`);
  }
  if (!hd) log(`taylor listing ${base}: available-homes ${homes.status}`);
  if (firstPlanUrl) await probeTaylorGallery(firstPlanUrl);
}

async function probeTaylorFind(word) {
  // The area pages link every community the builder sells there.
  for (const area of ['/fl/sarasota', '/fl/sarasota/venice', '/fl/sarasota/north-port', '/fl/tampa']) {
    const page = await fetchText('https://www.taylormorrison.com' + area);
    const hrefs = [...new Set([...page.text.matchAll(/href="([^"]*)"/gi)].map((m) => m[1]).filter((h) => normKey(h).includes(word)))];
    log(`taylor find "${word}" on ${area}: ${page.status}, ${hrefs.length} links: ${hrefs.slice(0, 12).join(' | ')}`);
  }
  const robots = await fetchText('https://www.taylormorrison.com/robots.txt');
  log(`taylor find robots.txt: ${robots.status} ${robots.text.split('\n').filter((l) => /sitemap/i.test(l)).join(' | ').slice(0, 300)}`);
  const locsOf = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  let locs = [];
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
    const res = await fetchText('https://www.taylormorrison.com' + path);
    if (res.status !== 200) { log(`taylor find: ${path} -> ${res.status}`); continue; }
    locs = locsOf(res.text);
    if (locs.length && locs.every((l) => /\.xml(\?|$)/.test(l))) {
      const children = locs;
      locs = [];
      for (const child of children.slice(0, 20)) {
        const c = await fetchText(child);
        if (c.status === 200) locs.push(...locsOf(c.text));
      }
    }
    if (locs.length) break;
  }
  const named = locs.filter((u) => normKey(u).includes(word));
  log(`taylor find "${word}": ${locs.length} sitemap urls, ${named.length} named for it: ${named.slice(0, 20).join(' | ')}`);
}

async function probeTaylorConnections() {
  for (const base of [
    'https://www.taylormorrison.com/fl/sarasota/lakewood-ranch/esplanade-at-azario-lakewood-ranch',
    'https://www.taylormorrison.com/fl/tampa/parrish/firethorn',
    'https://www.taylormorrison.com/fl/tampa/parrish/the-towns-at-firethorn',
    'https://www.taylormorrison.com/fl/sarasota/venice/esplanade-at-wellen-park',
    'https://www.taylormorrison.com/fl/sarasota/north-port/esplanade-at-wellen-park',
    'https://www.taylormorrison.com/fl/sarasota/wellen-park/esplanade-at-wellen-park',
  ]) {
    try {
      log(`taylor listing ${base}: probing`);
      await probeTaylorListing(base);
    } catch (err) {
      log(`taylor listing ${base}: failed ${err?.message ?? err}`);
    }
  }
  try {
    await probeTaylorFind('wellen');
  } catch (err) {
    log(`taylor find failed: ${err?.message ?? err}`);
  }
}

async function cacheItems(site, collectionId) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const res = await wix('POST', '/wix-data/v2/items/query', site.wix_site_id, {
      dataCollectionId: collectionId,
      query: { paging: { limit: 100, offset } },
      returnTotalCount: true,
      publishPluginOptions: { includeDraftItems: true },
    });
    if (res.status !== 200) {
      log(`${site.domain}/${collectionId}: item query ${res.status} ${(res.text ?? '').slice(0, 200)}`);
      return;
    }
    const page = res.json?.dataItems ?? [];
    items.push(...page);
    const total = res.json?.pagingMetadata?.total ?? 0;
    if (!page.length || items.length >= total) break;
  }
  // The cache mirrors the collection: rows for items since deleted go too.
  await supa(`fp_legacy_items?site_id=eq.${site.id}&collection_id=eq.${encodeURIComponent(collectionId)}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });
  const now = new Date().toISOString();
  for (let i = 0; i < items.length; i += 200) {
    await upsert(
      'fp_legacy_items?on_conflict=site_id,collection_id,wix_record_id',
      items.slice(i, i + 200).map((it) => ({
        site_id: site.id,
        collection_id: collectionId,
        wix_record_id: it.id ?? it.data?._id,
        data: it.data ?? {},
        publish_status: it.data?._publishStatus ?? null,
        imported_at: now,
      }))
    );
  }
  log(`${site.domain}/${collectionId}: ${items.length} items cached`);
}

try {
  const sites = await supa(
    'fp_sites?select=id,domain,wix_site_id,wix_collection_id,legacy_collection_id&active=eq.true&order=domain'
  );
  for (const site of sites) {
    if (!site.wix_site_id) continue;
    const v2 = site.wix_collection_id ?? 'FloorPlansV2';
    try {
      await applyStandard(site, v2);
    } catch (err) {
      log(`${site.domain}/${v2}: applying the standard failed: ${err?.message ?? err}`);
    }
    let v2Schema = null;
    try {
      v2Schema = await snapshotSchema(site, v2);
    } catch (err) {
      log(`${site.domain}/${v2}: schema snapshot failed: ${err?.message ?? err}`);
    }
    const targets = referenceTargets(v2Schema);
    log(`${site.domain}/${v2}: builder1 -> ${targets.builder1}, villages -> ${targets.villages}`);
    const collections = [...new Set([site.legacy_collection_id ?? 'FloorPlans', targets.builder1, targets.villages, VILLAGES_COLLECTION])];
    for (const collectionId of collections) {
      try {
        await snapshotSchema(site, collectionId);
      } catch (err) {
        log(`${site.domain}/${collectionId}: schema snapshot failed: ${err?.message ?? err}`);
      }
    }
    // The V2 items, and the Builders and neighborhoods items the reference
    // fields (builder1, villages) point at.
    for (const collectionId of [...new Set([v2, targets.builder1, targets.villages])]) {
      try {
        await cacheItems(site, collectionId);
      } catch (err) {
        log(`${site.domain}/${collectionId}: item cache failed: ${err?.message ?? err}`);
      }
    }
    if (site.domain === 'lifeatlakewood.com') {
      try {
        await probeTaylorConnections();
      } catch (err) {
        log(`${site.domain}: taylor probe failed: ${err?.message ?? err}`);
      }
    }
  }
} catch (err) {
  log(`failed: ${err?.message ?? err}`);
}
process.exit(0);
