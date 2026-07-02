// Phase 2: create the standardized (private) FloorPlansV2 collection on each
// site and probe the Wix APIs the pipeline depends on: draft-item lifecycle
// (insert as draft, publish, visibility) and Media Manager import.
//
// Runs as a prebuild step on Vercel (holds WIX_API_KEY + Supabase service
// key), guarded to the pipeline branch. Idempotent: skips creation when the
// collection already exists; test items are deleted afterward. Always exits 0.

const PIPELINE_BRANCH = 'claude/wix-floor-plan-automation-sbqc80';
const COLLECTION_ID = 'FloorPlansV2';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PIPELINE_BRANCH) {
  console.log(`FP2: branch ${branch ?? '(none)'} is not ${PIPELINE_BRANCH}; skipping.`);
  process.exit(0);
}
const wixKey = process.env.WIX_API_KEY;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!wixKey || !supaUrl || !supaKey) {
  console.log('FP2: missing env; skipping.');
  process.exit(0);
}

// Standardized schema: Parrish gold standard with warts fixed (one numeric
// score, no unpublishDate TEXT, no *Sort shadow columns) plus pipeline
// provenance fields (syncKey, sourceUrl, lastSyncedAt).
const FIELDS = [
  { key: 'floorPlanName', type: 'TEXT' },
  { key: 'floorPlanPrice', type: 'TEXT' },
  { key: 'floorPlanPriceTags', type: 'ARRAY_STRING' },
  { key: 'homeType', type: 'TEXT' },
  { key: 'village', type: 'TEXT' },
  { key: 'villages', type: 'REFERENCE', typeMetadata: { reference: { referencedCollectionId: 'HousesforSale-DynamicPages' } } },
  { key: 'builder', type: 'TEXT' },
  { key: 'builder1', type: 'REFERENCE', typeMetadata: { reference: { referencedCollectionId: 'Builders' } } },
  { key: 'bedrooms', type: 'TEXT' },
  { key: 'bathrooms', type: 'TEXT' },
  { key: 'garages', type: 'TEXT' },
  { key: 'squareFeet', type: 'TEXT' },
  { key: 'floorPlanDescription', type: 'TEXT' },
  { key: 'floorPlanImage', type: 'IMAGE' },
  { key: 'floorPlanImageGalleryLink', type: 'MEDIA_GALLERY' },
  { key: 'virtualTourLink', type: 'URL' },
  { key: 'virtualTourImageV2', type: 'IMAGE' },
  { key: 'newConstructionOrMoveIn', type: 'TEXT' },
  { key: 'quickMoveInAvailable', type: 'BOOLEAN' },
  { key: 'quickMoveInImage', type: 'IMAGE' },
  { key: 'relatedFloorPlanQuickMoveInOnly', type: 'TEXT' },
  { key: 'constructionDot', type: 'IMAGE' },
  { key: 'estimatedBuildTime', type: 'TEXT' },
  { key: 'estimatedBuildTimeTags', type: 'ARRAY_STRING' },
  { key: 'estimatedUpgradesOrChanges', type: 'TEXT' },
  { key: 'score', type: 'NUMBER' },
  { key: 'notes', type: 'TEXT' },
  { key: 'syncKey', type: 'TEXT' },
  { key: 'sourceUrl', type: 'URL' },
  { key: 'lastSyncedAt', type: 'DATETIME' },
];

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

async function supa(path, opts = {}) {
  const res = await fetch(`${supaUrl}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: supaKey, authorization: `Bearer ${supaKey}`,
      'content-type': 'application/json', ...(opts.headers ?? {}),
    },
  });
  return res.ok ? (res.status === 204 ? null : res.json()) : Promise.reject(new Error(`${res.status} ${await res.text()}`));
}

const log = (...a) => console.log('FP2', ...a);
const short = (r) => `${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 500)}`;

const sites = await supa('fp_sites?select=id,domain,wix_site_id,wix_collection_id&active=eq.true&order=domain');

// ---- Step 1: ensure FloorPlansV2 exists on every site ----
for (const site of sites) {
  const existing = await wix('GET', `/wix-data/v2/collections/${COLLECTION_ID}`, site.wix_site_id);
  if (existing.status === 200) {
    log(`${site.domain}: ${COLLECTION_ID} exists (${existing.json?.collection?.fields?.length ?? '?'} fields)`);
  } else {
    log(`${site.domain}: creating ${COLLECTION_ID} (lookup was ${existing.status})`);
    const created = await wix('POST', '/wix-data/v2/collections', site.wix_site_id, {
      collection: {
        id: COLLECTION_ID,
        displayName: 'Floor Plans V2',
        fields: FIELDS,
        permissions: { read: 'ANYONE', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' },
      },
    });
    log(`${site.domain}: create -> ${short(created)}`);
    if (created.status !== 200) continue;
  }
  if (!site.wix_collection_id) {
    await supa(`fp_sites?id=eq.${site.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ wix_collection_id: COLLECTION_ID }),
      headers: { prefer: 'return=minimal' },
    });
    log(`${site.domain}: fp_sites.wix_collection_id set`);
  }
}

// ---- Step 1b: enable the publish (draft/published) plugin on V2 ----
// New collections are created without the publish plugin; the legacy
// FloorPlans collections have it (their items carry _publishStatus).
// Copy the plugin config from legacy onto V2 on each site.
for (const site of sites) {
  const legacy = await wix('GET', '/wix-data/v2/collections/FloorPlans', site.wix_site_id);
  const legacyPlugins = legacy.json?.collection?.plugins ?? [];
  log(`${site.domain}: legacy plugins = ${JSON.stringify(legacyPlugins).slice(0, 400)}`);
  const v2 = await wix('GET', `/wix-data/v2/collections/${COLLECTION_ID}`, site.wix_site_id);
  const v2col = v2.json?.collection;
  if (!v2col) continue;
  const v2Plugins = v2col.plugins ?? [];
  log(`${site.domain}: V2 plugins = ${JSON.stringify(v2Plugins).slice(0, 400)}`);
  const publishPlugins = legacyPlugins.filter((p) =>
    /publish/i.test(JSON.stringify(p)),
  );
  const hasPublish = v2Plugins.some((p) => p.type === 'PUBLISH');
  if (!hasPublish && publishPlugins.length) {
    const body = { collection: { ...v2col, plugins: [...v2Plugins, ...publishPlugins] } };
    let updated = await wix('PUT', '/wix-data/v2/collections', site.wix_site_id, body);
    log(`${site.domain}: add publish plugin (PUT base) -> ${short(updated)}`);
    if (updated.status !== 200) {
      updated = await wix('PATCH', `/wix-data/v2/collections/${COLLECTION_ID}`, site.wix_site_id, body);
      log(`${site.domain}: add publish plugin (PATCH id) -> ${short(updated)}`);
    }
  } else {
    log(`${site.domain}: publish plugin ${hasPublish ? 'already present' : 'not found on legacy'}`);
  }
}

// ---- Step 2: draft lifecycle probe (first site only) ----
const probeSite = sites[0];
log(`--- item lifecycle probe on ${probeSite.domain} ---`);
const testData = { floorPlanName: 'FP-SYNC-TEST (delete me)', builder: 'Test Builder', syncKey: 'test:probe' };
const cleanupIds = [];

// Probe A: plain insert — what publish state does it land in?
const insA = await wix('POST', '/wix-data/v2/items', probeSite.wix_site_id, {
  dataCollectionId: COLLECTION_ID,
  dataItem: { data: testData },
});
log(`insert(plain) -> ${short(insA)}`);
const idA = insA.json?.dataItem?.id;
if (idA) {
  cleanupIds.push(idA);
  const read = await wix('GET', `/wix-data/v2/items/${idA}?dataCollectionId=${COLLECTION_ID}`, probeSite.wix_site_id);
  log(`read(plain insert) publishStatus=${read.json?.dataItem?.data?._publishStatus} -> ${read.status}`);
}

// Pre-clean any probe leftovers from earlier runs (drafts included).
const leftovers = await wix('POST', '/wix-data/v2/items/query', probeSite.wix_site_id, {
  dataCollectionId: COLLECTION_ID,
  query: { filter: { syncKey: 'test:probe' }, paging: { limit: 50 } },
  publishPluginOptions: { includeDraftItems: true },
});
for (const item of leftovers.json?.dataItems ?? []) cleanupIds.push(item.id);
log(`pre-clean found ${leftovers.json?.dataItems?.length ?? 0} leftover probe items`);

// Probe B: insert with _publishStatus=DRAFT directly in the item data.
const insB = await wix('POST', '/wix-data/v2/items', probeSite.wix_site_id, {
  dataCollectionId: COLLECTION_ID,
  dataItem: { data: { ...testData, floorPlanName: 'FP-SYNC-TEST-B (delete me)', _publishStatus: 'DRAFT' } },
});
log(`insert(data._publishStatus=DRAFT) -> ${insB.status} status=${insB.json?.dataItem?.data?._publishStatus}`);
const idB = insB.json?.dataItem?.id;
if (idB) {
  cleanupIds.push(idB);
  const readB = await wix(
    'GET',
    `/wix-data/v2/items/${idB}?dataCollectionId=${COLLECTION_ID}&publishPluginOptions.includeDraftItems=true`,
    probeSite.wix_site_id,
  );
  log(`read(B, includeDrafts) -> ${readB.status} publishStatus=${readB.json?.dataItem?.data?._publishStatus}`);
  // Probe B2: flip the draft to published via update (with draft visibility).
  const upd = await wix('PUT', `/wix-data/v2/items/${idB}`, probeSite.wix_site_id, {
    dataCollectionId: COLLECTION_ID,
    dataItem: { data: { ...(readB.json?.dataItem?.data ?? { ...testData, _id: idB }), _publishStatus: 'PUBLISHED' } },
    publishPluginOptions: { includeDraftItems: true },
  });
  log(`update(B -> PUBLISHED) -> ${upd.status} publishStatus=${upd.json?.dataItem?.data?._publishStatus} ${upd.status !== 200 ? short(upd) : ''}`);
}

// Probe C: query visibility with/without draft items included.
for (const includeDrafts of [false, true]) {
  const q = await wix('POST', '/wix-data/v2/items/query', probeSite.wix_site_id, {
    dataCollectionId: COLLECTION_ID,
    query: { paging: { limit: 10 } },
    ...(includeDrafts ? { publishPluginOptions: { includeDraftItems: true } } : {}),
  });
  log(`query(includeDrafts=${includeDrafts}) -> ${q.status} items=${q.json?.dataItems?.length ?? '?'} statuses=${JSON.stringify((q.json?.dataItems ?? []).map((i) => i.data?._publishStatus))}`);
}

// ---- Step 2b: ensure floorPlanBluePrintGallery exists on V2 collections ----
for (const site of sites) {
  const v2 = await wix('GET', `/wix-data/v2/collections/${COLLECTION_ID}`, site.wix_site_id);
  const col = v2.json?.collection;
  if (!col) continue;
  if (!col.fields?.some((f) => f.key === 'floorPlanBluePrintGallery')) {
    const updated = await wix('PUT', '/wix-data/v2/collections', site.wix_site_id, {
      collection: {
        ...col,
        fields: [...col.fields, { key: 'floorPlanBluePrintGallery', type: 'MEDIA_GALLERY' }],
      },
    });
    log(`${site.domain}: add blueprint gallery field -> ${updated.status}`);
  }
}

// ---- Step 2c: MEDIA_GALLERY payload format probe ----
// Try candidate shapes for gallery fields; read back what persists.
{
  const img = 'wix:image://v1/d0be81_45fd4f965be8496094860243fb700c60~mv2.png/probe.png';
  const variants = [
    { label: 'A objects with type+src', value: [{ type: 'image', src: img }, { type: 'image', src: img }] },
    { label: 'B objects with src only', value: [{ src: img }] },
    { label: 'C plain string array', value: [img] },
  ];
  for (const v of variants) {
    const ins = await wix('POST', '/wix-data/v2/items', probeSite.wix_site_id, {
      dataCollectionId: COLLECTION_ID,
      dataItem: {
        data: {
          floorPlanName: `GALLERY-PROBE-${v.label[0]} (delete me)`,
          syncKey: 'test:probe',
          floorPlanImageGalleryLink: v.value,
        },
      },
    });
    const id = ins.json?.dataItem?.id;
    log(`gallery probe ${v.label}: insert -> ${ins.status}${ins.status !== 200 ? ' ' + short(ins) : ''}`);
    if (id) {
      cleanupIds.push(id);
      const read = await wix(
        'GET',
        `/wix-data/v2/items/${id}?dataCollectionId=${COLLECTION_ID}&publishPluginOptions.includeDraftItems=true`,
        probeSite.wix_site_id,
      );
      log(`gallery probe ${v.label}: readback = ${JSON.stringify(read.json?.dataItem?.data?.floorPlanImageGalleryLink).slice(0, 400)}`);
    }
  }
}

// ---- Step 3: media import probe ----
const media = await wix('POST', '/site-media/v1/files/import', probeSite.wix_site_id, {
  url: 'https://static.wixstatic.com/media/d0be81_f345a9c85f234f6b8f240bbdefa0ed9b~mv2.png',
  displayName: 'fp-sync-media-probe.png',
});
log(`media import -> ${short(media)}`);

// ---- Cleanup test items (drafts need includeDraftItems too) ----
for (const id of [...new Set(cleanupIds)]) {
  const del = await wix(
    'DELETE',
    `/wix-data/v2/items/${id}?dataCollectionId=${COLLECTION_ID}&publishPluginOptions.includeDraftItems=true`,
    probeSite.wix_site_id,
  );
  log(`cleanup ${id} -> ${del.status}${del.status !== 200 ? ' ' + short(del) : ''}`);
}

log('done.');
process.exit(0);
