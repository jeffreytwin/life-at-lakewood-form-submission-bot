// Snapshots every active site's Wix collection schemas (Floor Plans V2, the
// legacy FloorPlans, Builders, the villages collection) into
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
    return;
  }
  await upsert('fp_collection_schemas?on_conflict=site_id,collection_id', [
    { site_id: site.id, collection_id: collectionId, schema: col, captured_at: new Date().toISOString() },
  ]);
  log(`${site.domain}/${collectionId}: ${col.fields?.length ?? 0} fields, revision ${col.revision ?? '?'}`);
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
  const fields = (col.fields ?? []).map((f) => ({ ...f }));
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
  if (!added.length && !relabeled.length) {
    log(`${site.domain}/${collectionId}: already carries the standard${skipped.length ? ` (left alone: ${skipped.join('; ')})` : ''}`);
    return;
  }
  const put = await wix('PUT', '/wix-data/v2/collections', site.wix_site_id, { collection: { ...col, fields } });
  log(
    `${site.domain}/${collectionId}: apply the standard -> ${put.status}; added [${added.join(', ')}], relabeled ${relabeled.length}` +
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
    const collections = [...new Set([v2, site.legacy_collection_id ?? 'FloorPlans', 'Builders', VILLAGES_COLLECTION])];
    for (const collectionId of collections) {
      try {
        await snapshotSchema(site, collectionId);
      } catch (err) {
        log(`${site.domain}/${collectionId}: schema snapshot failed: ${err?.message ?? err}`);
      }
    }
    // The V2 items, and the Builders and villages items the reference
    // fields (builder1, villages) point at.
    for (const collectionId of [v2, 'Builders', VILLAGES_COLLECTION]) {
      try {
        await cacheItems(site, collectionId);
      } catch (err) {
        log(`${site.domain}/${collectionId}: item cache failed: ${err?.message ?? err}`);
      }
    }
    try {
      await probeMediaFiles(site);
    } catch (err) {
      log(`${site.domain}: media probe failed: ${err?.message ?? err}`);
    }
  }
} catch (err) {
  log(`failed: ${err?.message ?? err}`);
}
process.exit(0);
