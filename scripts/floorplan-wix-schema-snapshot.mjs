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
async function probeReference(site, collectionId, name) {
  const exact = await wix('POST', '/wix-data/v2/items/query', site.wix_site_id, {
    dataCollectionId: collectionId,
    query: { filter: { title: { $eq: name } }, paging: { limit: 5 } },
  });
  const hits = exact.json?.dataItems ?? [];
  log(`${site.domain}/${collectionId} reference probe "${name}": title match ${exact.status} -> ${hits.map((it) => it.id).join(', ') || 'none'}`);
  if (hits.length) return;
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const all = await wix('POST', '/wix-data/v2/items/query', site.wix_site_id, {
    dataCollectionId: collectionId,
    query: { paging: { limit: 100 } },
    returnTotalCount: true,
  });
  const items = all.json?.dataItems ?? [];
  const named = items.flatMap((it) =>
    Object.entries(it.data ?? {})
      .filter(([k, v]) => typeof v === 'string' && norm(v) === norm(name))
      .map(([k]) => `${it.id} ${k}="${it.data.title ?? ''}"`)
  );
  log(`${site.domain}/${collectionId} reference probe "${name}": scanned ${items.length} of ${all.json?.pagingMetadata?.total ?? '?'}; fields carrying it: ${named.join('; ') || 'none'}`);
}

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
async function probeMediaFiles(site) {
  const rows = await supa(`fp_media_map?select=source_url,wix_media_id&site_id=eq.${site.id}&limit=300`);
  const fileIdOf = (v) => {
    const m = String(v ?? '').match(/^wix:image:\/\/v1\/([^/#?]+)\//);
    return m ? m[1] : null;
  };
  const pick = (pred) => (rows ?? []).map((r) => fileIdOf(r.wix_media_id)).find((id) => id && pred(id));
  const samples = [pick((id) => /\.svg$/i.test(id)), pick((id) => !/\.svg$/i.test(id))].filter(Boolean);
  for (const fileId of samples) {
    const res = await wix('GET', `/site-media/v1/files/${encodeURIComponent(fileId)}`, site.wix_site_id);
    const f = res.json?.file ?? res.json ?? {};
    log(
      `${site.domain} media probe ${fileId}: ${res.status} keys=[${Object.keys(res.json ?? {}).join(',')}] fileKeys=[${Object.keys(f).slice(0, 20).join(',')}] mediaType=${f.mediaType} status=${f.operationStatus} image=${JSON.stringify(f.media?.image?.image ?? f.media?.image ?? null)?.slice(0, 160)} vector=${JSON.stringify(f.media?.vector ?? null)?.slice(0, 120)}`
    );
  }
}

/**
 * Proves the Media Manager delete call a Reset relies on: imports a copy of
 * a public photo, deletes it permanently by id, then asks for it again.
 * The write-back's deleteMediaFiles (client.ts) makes the same call.
 */
async function probeMediaDelete(site) {
  const source = 'https://static.wixstatic.com/media/d0be81_15ba1e35e6304eb09a11c9a16bed98d0~mv2.jpg';
  const imported = await wix('POST', '/site-media/v1/files/import', site.wix_site_id, { url: source, displayName: 'fp-reset-probe.jpg' });
  const fileId = imported.json?.file?.id;
  log(`${site.domain} delete probe: import -> ${imported.status} id=${fileId ?? '?'} status=${imported.json?.file?.operationStatus ?? '?'}`);
  if (!fileId) return;
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const deleted = await wix('POST', '/site-media/v1/bulk/files/delete', site.wix_site_id, { fileIds: [fileId], permanent: true });
  log(`${site.domain} delete probe: delete -> ${deleted.status} ${(deleted.text ?? '').slice(0, 200)}`);
  const after = await wix('GET', `/site-media/v1/files/${encodeURIComponent(fileId)}`, site.wix_site_id);
  log(`${site.domain} delete probe: after -> ${after.status} state=${after.json?.file?.state ?? '?'} ${after.status !== 200 ? (after.text ?? '').slice(0, 160) : ''}`);
}

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
function countModels(container) {
  if (!container) return { models: 0, qmis: 0 };
  const lists = [container.homes?.models ?? [], ...(container.communities ?? []).map((c) => c?.homes?.models ?? [])];
  const models = lists.flat();
  return { models: models.filter((m) => m?.name && !m.isQMI).length, qmis: models.reduce((n, m) => n + (m?.qmis?.length ?? 0), 0) };
}
async function probeTollCommunity(communityName, regionKey) {
  const key = normKey(communityName);
  const locsOf = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  let locs = [];
  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    const res = await fetchText('https://www.tollbrothers.com' + path);
    if (res.status !== 200) { log(`toll probe: ${path} -> ${res.status}`); continue; }
    locs = locsOf(res.text);
    if (locs.length && locs.every((l) => /\.xml(\?|$)/.test(l))) {
      const children = locs;
      locs = [];
      for (const child of children.slice(0, 12)) {
        const c = await fetchText(child);
        if (c.status === 200) locs.push(...locsOf(c.text));
      }
    }
    if (locs.length) break;
  }
  const named = locs.filter((u) => normKey(u).includes(key));
  log(`toll probe "${communityName}": ${locs.length} sitemap urls, ${named.length} named for it: ${named.slice(0, 20).join(' | ')}`);
  const ranked = [...named].sort((a, b) => (normKey(b).includes(regionKey) ? 1 : 0) - (normKey(a).includes(regionKey) ? 1 : 0) || a.length - b.length);
  for (const url of ranked.slice(0, 4)) {
    try {
      const page = await fetchText(url);
      const title = page.text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '?';
      const m = page.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      const data = m ? JSON.parse(m[1]) : null;
      const pageData = data?.props?.pageProps?.pageData ?? {};
      const master = countModels(pageData.masterCommunityComponent);
      const comm = countModels(pageData.communityComponent);
      log(`toll probe page ${url}: ${page.status} title="${title.slice(0, 80)}" nextData=${!!m} pageDataKeys=[${Object.keys(pageData).slice(0, 12).join(',')}] master=${master.models}/${master.qmis} community=${comm.models}/${comm.qmis}`);
    } catch (err) {
      log(`toll probe page ${url}: failed ${err?.message ?? err}`);
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
        await probeReference(site, targets.villages, 'The Isles');
      } catch (err) {
        log(`${site.domain}: reference probe failed: ${err?.message ?? err}`);
      }
    }
    if (site.domain === 'lifeatlakewood.com') {
      try {
        await probeTollCommunity('Monterey', 'lakewood-ranch');
      } catch (err) {
        log(`${site.domain}: toll probe failed: ${err?.message ?? err}`);
      }
    }
    try {
      await probeMediaFiles(site);
    } catch (err) {
      log(`${site.domain}: media probe failed: ${err?.message ?? err}`);
    }
    if (site.domain === 'lifeatlakewood.com') {
      try {
        await probeMediaDelete(site);
      } catch (err) {
        log(`${site.domain}: delete probe failed: ${err?.message ?? err}`);
      }
    }
  }
} catch (err) {
  log(`failed: ${err?.message ?? err}`);
}
process.exit(0);
