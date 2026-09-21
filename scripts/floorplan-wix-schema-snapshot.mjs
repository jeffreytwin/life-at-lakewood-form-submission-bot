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

/**
 * Taylor Morrison, one community and one plan of it (Jeff, 2026-09-21): what
 * the floor-plans listing carries per plan (collection, photos, tour), what
 * the available-homes listing says about each home's collection, and how
 * the plan's own page and its /gallery page hold the supporting pictures,
 * their sections ("Design Collections" must be left out) and the tour.
 */
async function probeTaylorCommunity(base, planSlug) {
  const list = await fetchText(`${base}/floor-plans`);
  const listData = list.status === 200 ? scDataOf(list.text) : null;
  log(`taylor probe ${base}/floor-plans: ${list.status} scData=${!!listData}`);
  for (const [k, e] of Object.entries(listData ?? {})) {
    if (!e || typeof e !== 'object') continue;
    if (Array.isArray(e.floorPlanCollections)) log(`taylor probe collections (${k}, community "${e.communityName ?? ''}"): ${e.floorPlanCollections.map((c) => `${c?.id}=${c?.name}`).join(' | ')}`);
    for (const p of e.floorPlansListDataArray ?? []) {
      if (!p || typeof p !== 'object') continue;
      log(`taylor probe plan "${p.floorPlanName}" | coll=${p.floorPlanCollection} | photos=${(p.floorPlanPhotosArray ?? []).length} | tour=${p.virtualTourLink ?? ''} | tourText=${p.floorPlanVirtualTourLinkText ?? ''} | link=${p.floorPlanDetailsLink?.Url ?? ''} | build=${p.floorPlanBuildPlanLink?.Url ?? ''}`);
    }
  }
  const homes = await fetchText(`${base}/available-homes`);
  const homesData = homes.status === 200 ? scDataOf(homes.text) : null;
  log(`taylor probe ${base}/available-homes: ${homes.status} scData=${!!homesData}`);
  for (const e of Object.values(homesData ?? {})) {
    if (!e || typeof e !== 'object' || !e.availableHomesList) continue;
    for (const section of e.availableHomesList.sections ?? []) {
      log(`taylor probe homes section "${section?.sectionLabel}": ${(section?.homes ?? []).slice(0, 12).map((h) => `${h?.address} [plan=${h?.floorPlan} coll=${h?.floorPlanCollection} link=${h?.viewHomeLink?.Url ?? ''}]`).join(' | ')}`);
    }
  }
  for (const path of [`${base}/floor-plans/${planSlug}`, `${base}/floor-plans/${planSlug}/gallery`]) {
    const page = await fetchText(path);
    log(`taylor probe page ${path}: ${page.status} len=${page.text.length}`);
    if (page.status !== 200) continue;
    const html = page.text;
    const heads = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    log(`taylor probe headings: ${heads.slice(0, 40).join(' | ')}`);
    const tabs = [...html.matchAll(/(?:data-tab|data-target|data-bs-target|role="tab"[^>]*>|class="[^"]*tab[^"]*"[^>]*>)\s*([^<]{2,60})</gi)].map((m) => m[1].trim());
    log(`taylor probe tab-ish labels: ${[...new Set(tabs)].slice(0, 40).join(' | ')}`);
    const tours = [...new Set([...html.matchAll(/https?:\/\/(?:my\.)?matterport\.com\/[^"'\s<>]+/g)].map((m) => m[0]))];
    log(`taylor probe tours: ${tours.join(' | ')}`);
    const media = [...new Set([...html.matchAll(/\/-\/media\/[^"'\s)?]+/g)].map((m) => m[0]))];
    log(`taylor probe media urls: ${media.length}; first: ${media.slice(0, 10).join(' | ')}`);
    const dcAt = html.search(/design collections?/i);
    if (dcAt >= 0) log(`taylor probe "Design Collections" context: ${html.slice(Math.max(0, dcAt - 600), dcAt + 900).replace(/\s+/g, ' ')}`);
    const d = scDataOf(html);
    if (!d) { log('taylor probe: no scDataStore on this page'); continue; }
    for (const [k, e] of Object.entries(d)) {
      if (!e || typeof e !== 'object') continue;
      const keys = Object.keys(e);
      log(`taylor probe entry ${k}: keys=[${keys.slice(0, 60).join(',')}]`);
      for (const key of keys) {
        const v = e[key];
        if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object') log(`taylor probe entry ${k}.${key}: ${v.length} items, first=${JSON.stringify(v[0]).slice(0, 700)}`);
        else if (Array.isArray(v) && v.length) log(`taylor probe entry ${k}.${key}: ${v.length} items, first=${String(v[0]).slice(0, 300)}`);
        else if (v && typeof v === 'object') log(`taylor probe entry ${k}.${key}: object=${JSON.stringify(v).slice(0, 500)}`);
      }
    }
    // The picture-carrying entries in full, in slices a log line can hold.
    let n = 0;
    for (const [k, e] of Object.entries(d)) {
      const json = JSON.stringify(e);
      if (!/-\/media\/|matterport/i.test(json)) continue;
      log(`taylor probe dump ${k}: ${json.length} chars`);
      for (let i = 0; i < json.length && n < 40; i += 1400, n += 1) log(`taylor probe dump ${k}[${i}]: ${json.slice(i, i + 1400)}`);
    }
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
        await probeTaylorCommunity('https://www.taylormorrison.com/fl/sarasota/lakewood-ranch/esplanade-at-azario-lakewood-ranch', 'roma');
      } catch (err) {
        log(`${site.domain}: taylor probe failed: ${err?.message ?? err}`);
      }
    }
  }
} catch (err) {
  log(`failed: ${err?.message ?? err}`);
}
process.exit(0);
