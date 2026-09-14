// Listings engine, phase 1: verify the Wix foundations on Longboat Key
// before any engine code is written (docs/LISTINGS_ENGINE_PLAN.md, "Sequence
// and gates", step 1). From one Vercel build log it answers:
//
//   - Is the Longboat Key site reachable with the account-level API key
//     (site ID + account membership), and does the shadow collection
//     (HousesforSale2, created 2026-09-14) exist with the same fields as
//     the live HousesforSale?
//   - Does an insert keyed by a fake ListingId keep that _id, and does a
//     full-item update round-trip? (plan decision 6: Wix _id = ListingId)
//   - What does a bulk insert / update / save / remove of N realistic rows
//     cost against one-item-at-a-time writes, and does anything come back
//     429? (the 330-row full reconcile question)
//   - Does importing an image from a Supabase Storage URL into the site's
//     Media Manager return an ID a gallery field accepts?
//
// Runs as a prebuild step on Vercel (the only environment holding
// WIX_API_KEY plus the Supabase service key), guarded to this branch so
// production and other preview builds skip it; LS_PHASE1_RUN=1 runs it
// anywhere the env is present. The live HousesforSale collection is only
// read (its schema and its item count). Writes: rows in HousesforSale2,
// one image import into the site's Media Manager, one probe JPEG in the
// Supabase `photos` bucket. Every row this script writes has an _id starting
// with MFRENGINE; all are removed afterwards except the keyed one
// (MFRENGINEPROBE001), left so a hidden dynamic page bound to the shadow
// collection can be checked. LS_PHASE1_CLEANUP=1 removes it too.
// Always exits 0.
//
// Env: WIX_API_KEY (required), WIX_SITE_ID_LONGBOAT (else discovered via
// the Site List API, which needs WIX_ACCOUNT_ID), NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (for the image; LS_PHASE1_IMAGE_URL overrides),
// LS_PHASE1_BULK_SIZE (default 50; the Longboat inventory is ~330),
// LS_PHASE1_SERIAL_WRITES (default 10), LS_PHASE1_BURST (default 20),
// LS_PHASE1_ENGINE_COLLECTION (default HousesforSale2).
// WIX_API_BASE points the script at a mock server for a local dry run.

const WIX_BASE = process.env.WIX_API_BASE || 'https://www.wixapis.com';
const PROBE_BRANCH = 'claude/listings-engine-phase1-longboat-tzysk9';
const LIVE_COLLECTION = 'HousesforSale';
const ENGINE_COLLECTION = process.env.LS_PHASE1_ENGINE_COLLECTION || 'HousesforSale2';
const OTHER_COLLECTIONS = ['Villages', 'HousesforSale-DynamicPages', 'Stagging', 'SyncRuns', 'SyncEvents'];
const TEST_ID = 'MFRENGINEPROBE001';
const TEST_ID_PREFIX = 'MFRENGINE';
const STORAGE_BUCKET = 'photos';
const MEDIA_DISPLAY_NAME = 'listings-engine-probe.jpg';
const SYSTEM_FIELDS = new Set(['_id', '_owner', '_createdDate', '_updatedDate', '_publishStatus', '_publishDate', '_draftDate']);

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (process.env.LS_PHASE1_RUN !== '1' && branch !== PROBE_BRANCH) {
  console.log(`LS1: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}
const wixKey = process.env.WIX_API_KEY;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!wixKey) {
  console.log('LS1: missing WIX_API_KEY; skipping.');
  process.exit(0);
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
const BULK_SIZE = clampInt(process.env.LS_PHASE1_BULK_SIZE, 50, 1, 1000);
const SERIAL_WRITES = clampInt(process.env.LS_PHASE1_SERIAL_WRITES, 10, 0, 100);
const BURST = clampInt(process.env.LS_PHASE1_BURST, 20, 0, 100);

const log = (...a) => console.log('LS1', ...a);
const short = (r) => `${r.status} ${JSON.stringify(r.json ?? r.text ?? r.error ?? '').slice(0, 400)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n, w) => String(n).padStart(w, '0');
const formatPrice = (n) => `$${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

// Every Wix call is recorded (status, ms, payload bytes, and any header that
// looks like throttling) so the summary can say how many came back 429.
const calls = [];
const timings = {};
const verdicts = {};

async function wix(label, method, path, { siteId, body, headers } = {}) {
  const started = Date.now();
  const payload = body ? JSON.stringify(body) : undefined;
  const bytes = payload ? Buffer.byteLength(payload) : 0;
  let res;
  let text = '';
  try {
    res = await fetch(`${WIX_BASE}${path}`, {
      method,
      headers: {
        authorization: wixKey,
        ...(siteId ? { 'wix-site-id': siteId } : {}),
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
      body: payload,
      signal: AbortSignal.timeout(90_000),
    });
    text = await res.text();
  } catch (err) {
    const ms = Date.now() - started;
    const error = String(err?.cause?.message ?? err?.message ?? err);
    calls.push({ label, method, path, status: 0, ms, bytes, error });
    log(`${label}: network error after ${ms}ms: ${error}`);
    return { status: 0, json: null, text: '', ms, headers: {}, error };
  }
  const ms = Date.now() - started;
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  const throttle = {};
  for (const [name, value] of res.headers) {
    if (/retry|rate|limit|request-id/i.test(name)) throttle[name] = value;
  }
  calls.push({ label, method, path, status: res.status, ms, bytes, ...throttle });
  if (res.status === 429) {
    log(`RATE LIMITED: ${label} -> 429 after ${ms}ms headers=${JSON.stringify(throttle)} body=${text.slice(0, 300)}`);
  }
  return { status: res.status, json, text, ms, headers: throttle };
}

async function supa(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${supaUrl}${path}`, {
    method,
    headers: {
      apikey: supaKey,
      authorization: `Bearer ${supaKey}`,
      ...(raw ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: raw ? body : (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// A realistic HousesforSale row (transformListing shape from the Longboat
// Key repo: 20-photo gallery, ~1.3 KB description), so bulk timings reflect
// real payload sizes. Every value is obviously a probe.
const DESCRIPTION = 'Listings engine probe row; not a real listing. ' +
  'Bright and open bayfront residence with water views from every room, a chef\'s kitchen, and a private dock. '.repeat(12);

// Wix REST renders DATETIME values as { $date: iso }; the floor plan
// writeback sends plain ISO strings and is accepted too. The keyed insert
// tries the wrapped form first and falls back, so the summary says which
// form the engine should use.
let dateForm = 'wrapped';
const wixDate = (d) => (dateForm === 'wrapped' ? { $date: d.toISOString() } : d.toISOString());

function fakeListing(id, i, imageUri, sourceUrl) {
  const n = 100 + i;
  const price = 1234000 + i * 1000;
  const now = wixDate(new Date());
  const gallery = Array.from({ length: 20 }, (_, k) => ({
    type: 'Image',
    title: `Engine probe photo ${k + 1}`,
    src: imageUri ?? sourceUrl ?? '',
    order: k + 1,
    mlsSourceUrl: sourceUrl ?? null,
    mlsModificationTimestamp: null,
  }));
  return {
    _id: id,
    propertyAddress: `${n} Engine Probe Ln, Longboat Key, FL 34228`,
    propertyAddressGoogleMaps: {
      city: 'Longboat Key',
      location: { latitude: 27.3814, longitude: -82.6376 },
      streetAddress: { number: String(n), name: 'Engine Probe', apt: '' },
      country: 'US',
      postalCode: '34228',
      formatted: `${n} Engine Probe Ln, Longboat Key, FL 34228, US`,
      subdivision: 'ENGINE PROBE',
    },
    listingPrimaryImage: imageUri ?? null,
    listingPrice: formatPrice(price),
    listingPricePure: price,
    listingPriceSort: ['$1M - $2M'],
    homeType: 'Single Family Residence',
    village: 'Engine Probe Village',
    village1: null,
    villageLink: 'https://www.lifeinlongboatkey.com/',
    villageSortHelp: 'Engine Probe Village',
    blueTag1: '',
    purpleTag1: '',
    greenTag1: '',
    bedrooms: 3,
    listingAgentName: 'Engine Probe',
    listingAgentMls: 'PROBE',
    listingAgentPhone: '000-000-0000',
    listingAgentCompany: 'Listings Engine (probe row, delete me)',
    listingBrokerageContactInformation: '',
    bathrooms: 2,
    bathroomsSort: ['2'],
    garages: '2 Car',
    squareFeet: '2,150',
    lotSize: '',
    propertyDescription: DESCRIPTION,
    listingImageGallery: gallery,
    standardStatus: 'Active',
    mlgCanView: 'true',
    virtualTourUrl: null,
    modificationTimestamp: now,
    subdivision: 'ENGINE PROBE',
    dateOfMlsPull: now,
    isPublished: true,
  };
}

function bulkOutcome(label, res, expectedIds) {
  const results = res.json?.results ?? [];
  const meta = res.json?.bulkActionMetadata ?? {};
  const failures = results.filter((r) => !r.itemMetadata?.success);
  const actions = {};
  for (const r of results) actions[r.action ?? '?'] = (actions[r.action ?? '?'] ?? 0) + 1;
  const idsPreserved = expectedIds
    ? results.length === expectedIds.length &&
      results.every((r) => r.itemMetadata?.id === expectedIds[r.itemMetadata?.originalIndex ?? -1])
    : null;
  log(`${label}: ${res.status} in ${res.ms}ms (${(calls.at(-1)?.bytes ?? 0)} bytes) ok=${meta.totalSuccesses ?? '?'} failed=${meta.totalFailures ?? '?'} actions=${JSON.stringify(actions)}${idsPreserved === null ? '' : ` idsPreserved=${idsPreserved}`}`);
  if (res.status !== 200) log(`${label}: body ${short(res)}`);
  if (failures.length) log(`${label}: first failure ${JSON.stringify(failures[0]).slice(0, 400)}`);
  return { ok: res.status === 200 && (meta.totalFailures ?? 0) === 0, idsPreserved, actions, meta };
}

async function queryIds(siteId, filter) {
  const res = await wix('query-probe-rows', 'POST', '/wix-data/v2/items/query', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, query: { filter, paging: { limit: 1000 } }, returnTotalCount: true },
  });
  if (res.status === 200) return (res.json?.dataItems ?? []).map((i) => i.id);
  // $startsWith on _id refused: page everything and filter locally.
  log(`query with filter ${JSON.stringify(filter)} -> ${short(res)}; falling back to a full scan`);
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await wix('scan-probe-rows', 'POST', '/wix-data/v2/items/query', {
      siteId,
      body: { dataCollectionId: ENGINE_COLLECTION, query: { paging: { limit: 1000, offset } }, returnTotalCount: true },
    });
    const items = page.json?.dataItems ?? [];
    ids.push(...items.map((i) => i.id).filter((id) => String(id).startsWith(TEST_ID_PREFIX)));
    if (items.length < 1000) break;
  }
  return ids;
}

async function removeIds(siteId, ids, label) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const res = await wix(label, 'POST', '/wix-data/v2/bulk/items/remove', {
      siteId,
      body: { dataCollectionId: ENGINE_COLLECTION, dataItemIds: chunk },
    });
    bulkOutcome(`${label} (${chunk.length})`, res, chunk);
  }
}

// ---- Step 1: which site? ----
async function resolveSiteId() {
  if (process.env.WIX_SITE_ID_LONGBOAT) {
    return { siteId: process.env.WIX_SITE_ID_LONGBOAT.trim(), how: 'WIX_SITE_ID_LONGBOAT' };
  }
  const accountId = process.env.WIX_ACCOUNT_ID;
  if (!accountId) {
    log('no WIX_SITE_ID_LONGBOAT; set it, or set WIX_ACCOUNT_ID so the account\'s sites can be listed');
    return null;
  }
  const res = await wix('site-list', 'POST', '/site-list/v2/sites/query', {
    headers: { 'wix-account-id': accountId },
    body: { query: { cursorPaging: { limit: 100 } } },
  });
  if (res.status !== 200) {
    log(`site list -> ${short(res)} (needs an account-level key with Site List permission)`);
    return null;
  }
  const sites = res.json?.sites ?? [];
  log(`account has ${sites.length} site(s):`);
  for (const s of sites) {
    log(`  ${s.id}  ${s.displayName ?? s.name ?? ''}  ${s.viewUrl ?? ''}  published=${s.published} domainConnected=${s.domainConnected}`);
  }
  const hit = sites.find((s) => /longboat/i.test(`${s.displayName ?? ''} ${s.name ?? ''} ${s.viewUrl ?? ''}`));
  if (!hit) {
    log('no site matching "longboat" in this account: Longboat Key is in another Wix account, or named differently (set WIX_SITE_ID_LONGBOAT)');
    return null;
  }
  return { siteId: hit.id, how: `site list match "${hit.displayName ?? hit.name}"` };
}

// ---- Step 2: collections on the site ----
async function describeCollection(siteId, id) {
  const res = await wix(`collection:${id}`, 'GET', `/wix-data/v2/collections/${encodeURIComponent(id)}`, { siteId });
  const c = res.json?.collection;
  return {
    id,
    exists: res.status === 200,
    status: res.status,
    ms: res.ms,
    displayName: c?.displayName,
    fields: c?.fields ?? [],
    permissions: c?.permissions,
    plugins: c?.plugins ?? [],
    body: res,
  };
}

const dataFields = (fields) => fields.filter((f) => !SYSTEM_FIELDS.has(f.key) && f.type !== 'PAGE_LINK' && !String(f.key).startsWith('link-'));

// ---- Step 3: an image in Supabase Storage ----
async function pickSourceImage() {
  if (process.env.LS_PHASE1_IMAGE_URL) return { url: process.env.LS_PHASE1_IMAGE_URL, how: 'LS_PHASE1_IMAGE_URL' };
  if (!supaUrl || !supaKey) {
    log('no Supabase env and no LS_PHASE1_IMAGE_URL; media import probe skipped');
    return null;
  }
  // Prefer a generated probe JPEG (a real listing-sized photo, obviously fake).
  try {
    const sharp = (await import('sharp')).default;
    const stamp = new Date().toISOString().slice(0, 10);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b3d91"/><stop offset="1" stop-color="#5fb3f5"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <text x="50%" y="48%" font-family="sans-serif" font-size="80" fill="#fff" text-anchor="middle">LISTINGS ENGINE PROBE</text>
      <text x="50%" y="58%" font-family="sans-serif" font-size="40" fill="#fff" text-anchor="middle">${stamp} - not a real listing photo</text>
    </svg>`;
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
    const objectPath = `listings-engine/probe-${stamp}.jpg`;
    await supa(`/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
      method: 'POST',
      raw: true,
      body: jpeg,
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' },
    });
    return {
      url: `${supaUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`,
      how: `generated ${jpeg.length} bytes, uploaded to ${STORAGE_BUCKET}/${objectPath}`,
    };
  } catch (err) {
    log(`probe image generation/upload failed (${err?.message ?? err}); falling back to an existing object`);
  }
  for (const prefix of ['locations', 'agents']) {
    try {
      const objects = await supa(`/storage/v1/object/list/${STORAGE_BUCKET}`, {
        method: 'POST',
        body: { prefix, limit: 100, sortBy: { column: 'created_at', order: 'desc' } },
      });
      const hit = (objects ?? []).find((o) => /\.jpe?g$/i.test(o.name) && !/_thumb/i.test(o.name));
      if (hit) {
        return { url: `${supaUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${prefix}/${hit.name}`, how: `existing object ${prefix}/${hit.name}` };
      }
    } catch (err) {
      log(`listing ${STORAGE_BUCKET}/${prefix} failed: ${err?.message ?? err}`);
    }
  }
  return null;
}

async function main() {
  log(`bulkSize=${BULK_SIZE} serialWrites=${SERIAL_WRITES} burst=${BURST} engineCollection=${ENGINE_COLLECTION}`);

  // ---- Step 1: site ----
  const site = await resolveSiteId();
  if (!site) return;
  const { siteId } = site;
  log(`site ${siteId} (${site.how})`);

  // ---- Step 2: collections (read-only) ----
  const live = await describeCollection(siteId, LIVE_COLLECTION);
  if (!live.exists) {
    log(`${LIVE_COLLECTION} -> ${short(live.body)}: the key does not reach this site (wrong ID, or a different Wix account); stopping`);
    verdicts.site_reachable = false;
    return;
  }
  verdicts.site_reachable = true;
  log(`${LIVE_COLLECTION}: "${live.displayName}" ${live.fields.length} fields, permissions=${JSON.stringify(live.permissions)} (${live.ms}ms)`);
  const liveCount = await wix('count-live', 'POST', '/wix-data/v2/items/query', {
    siteId,
    body: { dataCollectionId: LIVE_COLLECTION, query: { paging: { limit: 1 } }, returnTotalCount: true },
  });
  const inventory = liveCount.json?.pagingMetadata?.total ?? null;
  log(`${LIVE_COLLECTION}: ${inventory ?? '?'} items (${liveCount.ms}ms)`);
  timings.query_live_count = liveCount.ms;

  for (const id of OTHER_COLLECTIONS) {
    const c = await describeCollection(siteId, id);
    log(`${id}: ${c.exists ? `${c.fields.length} fields` : `missing (${c.status})`}`);
  }

  const engine = await describeCollection(siteId, ENGINE_COLLECTION);
  verdicts.engine_collection_exists = engine.exists;
  if (!engine.exists) {
    log(`${ENGINE_COLLECTION} -> ${short(engine.body)}`);
    log(`${ENGINE_COLLECTION} is missing: duplicate ${LIVE_COLLECTION} without data, admin-only permissions, then rebuild. Live data fields it needs (${dataFields(live.fields).length}):`);
    log(`  ${dataFields(live.fields).map((f) => `${f.key}:${f.type}`).join(', ')}`);
  } else {
    log(`${ENGINE_COLLECTION}: "${engine.displayName}" ${engine.fields.length} fields, permissions=${JSON.stringify(engine.permissions)} plugins=${JSON.stringify(engine.plugins).slice(0, 200)}`);
    const engineByKey = new Map(engine.fields.map((f) => [f.key, f]));
    const missing = dataFields(live.fields).filter((f) => !engineByKey.has(f.key));
    const mismatched = dataFields(live.fields).filter((f) => engineByKey.has(f.key) && engineByKey.get(f.key).type !== f.type);
    const extra = dataFields(engine.fields).filter((f) => !live.fields.some((l) => l.key === f.key));
    verdicts.engine_schema_matches_live = missing.length === 0 && mismatched.length === 0;
    log(`schema vs live: missing=${missing.map((f) => f.key).join(',') || 'none'} typeMismatch=${mismatched.map((f) => `${f.key}(${engineByKey.get(f.key).type}!=${f.type})`).join(',') || 'none'} extra=${extra.map((f) => f.key).join(',') || 'none'}`);
  }

  // ---- Step 3: media import (independent of the shadow collection) ----
  let imageUri = null;
  let source = null;
  source = await pickSourceImage();
  if (source) {
    log(`source image: ${source.url} (${source.how})`);
    try {
      const head = await fetch(source.url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
      log(`source image HEAD -> ${head.status} ${head.headers.get('content-type') ?? ''} ${head.headers.get('content-length') ?? ''} bytes`);
    } catch (err) {
      log(`source image HEAD failed: ${err?.message ?? err}`);
    }
    const imp = await wix('media-import', 'POST', '/site-media/v1/files/import', {
      siteId,
      body: { url: source.url, displayName: MEDIA_DISPLAY_NAME, mimeType: 'image/jpeg', private: false },
    });
    timings.media_import = imp.ms;
    const file = imp.json?.file;
    log(`media import -> ${imp.status} in ${imp.ms}ms id=${file?.id} url=${file?.url} operationStatus=${file?.operationStatus} state=${file?.state}${imp.status !== 200 ? ' ' + short(imp) : ''}`);
    verdicts.media_import_ok = imp.status === 200 && !!file?.id;
    if (file?.id) {
      imageUri = `wix:image://v1/${file.id}/${encodeURIComponent(MEDIA_DISPLAY_NAME)}`;
      let status = file.operationStatus;
      const started = Date.now();
      for (let i = 0; i < 20 && status && status !== 'READY'; i++) {
        await wait(1000);
        const got = await wix(`media-get-${i}`, 'GET', `/site-media/v1/files/${encodeURIComponent(file.id)}`, { siteId });
        status = got.json?.file?.operationStatus ?? status;
        if (got.status !== 200) { log(`media get -> ${short(got)}`); break; }
      }
      timings.media_ready_after = Date.now() - started;
      log(`media file ${file.id}: operationStatus=${status} after ${timings.media_ready_after}ms; gallery uri ${imageUri}`);
      verdicts.media_ready = status === 'READY' || status === undefined;
    }
  }

  if (!engine.exists) {
    log('no shadow collection, so the item and bulk probes did not run');
    return;
  }

  // ---- Step 4: query the shadow collection and clear earlier probe rows ----
  const q = await wix('query-engine', 'POST', '/wix-data/v2/items/query', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, query: { paging: { limit: 5 } }, returnTotalCount: true },
  });
  timings.query_engine = q.ms;
  log(`${ENGINE_COLLECTION}: query -> ${q.status} total=${q.json?.pagingMetadata?.total ?? '?'} sample=${JSON.stringify((q.json?.dataItems ?? []).map((i) => i.id))} (${q.ms}ms)`);
  const drafts = await wix('query-engine-drafts', 'POST', '/wix-data/v2/items/query', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, query: { paging: { limit: 1 } }, publishPluginOptions: { includeDraftItems: true } },
  });
  log(`query with publishPluginOptions.includeDraftItems (collection has no publish plugin?) -> ${drafts.status}${drafts.status !== 200 ? ' ' + short(drafts) : ''}`);
  verdicts.publish_plugin_options_accepted = drafts.status === 200;

  const leftovers = await queryIds(siteId, { _id: { $startsWith: TEST_ID_PREFIX } });
  log(`pre-clean: ${leftovers.length} earlier probe row(s)`);
  await removeIds(siteId, leftovers, 'pre-clean-remove');

  // ---- Step 5: one item keyed by a fake ListingId ----
  let record = fakeListing(TEST_ID, 0, imageUri, source?.url);
  let ins = await wix('insert-keyed', 'POST', '/wix-data/v2/items', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, dataItem: { data: record } },
  });
  if (ins.status === 400) {
    log(`insert with { $date } values -> ${short(ins)}; retrying with ISO strings`);
    dateForm = 'iso';
    record = fakeListing(TEST_ID, 0, imageUri, source?.url);
    ins = await wix('insert-keyed-iso', 'POST', '/wix-data/v2/items', {
      siteId,
      body: { dataCollectionId: ENGINE_COLLECTION, dataItem: { data: record } },
    });
  }
  verdicts.date_form = dateForm;
  timings.insert_keyed = ins.ms;
  const insertedId = ins.json?.dataItem?.id;
  verdicts.keyed_id_preserved = insertedId === TEST_ID;
  log(`insert ${TEST_ID} -> ${ins.status} in ${ins.ms}ms id=${insertedId} idPreserved=${verdicts.keyed_id_preserved}${ins.status !== 200 ? ' ' + short(ins) : ''}`);

  const got = await wix('get-keyed', 'GET', `/wix-data/v2/items/${TEST_ID}?dataCollectionId=${ENGINE_COLLECTION}`, { siteId });
  timings.get_keyed = got.ms;
  const data = got.json?.dataItem?.data ?? {};
  log(`get ${TEST_ID} -> ${got.status} in ${got.ms}ms price=${data.listingPricePure} gallery=${Array.isArray(data.listingImageGallery) ? data.listingImageGallery.length : 'n/a'} primaryImage=${JSON.stringify(data.listingPrimaryImage)} pull=${JSON.stringify(data.dateOfMlsPull)}`);
  verdicts.gallery_uri_accepted = imageUri
    ? Array.isArray(data.listingImageGallery) && data.listingImageGallery[0]?.src === imageUri
    : null; // null = media probe did not run
  if (imageUri) log(`gallery[0].src round-trips as the imported file: ${verdicts.gallery_uri_accepted}${verdicts.gallery_uri_accepted ? '' : ` (${JSON.stringify(data.listingImageGallery?.[0]).slice(0, 300)})`}`);

  const updated = { ...record, listingPrice: '$1,299,000', listingPricePure: 1299000, dateOfMlsPull: wixDate(new Date()) };
  const upd = await wix('update-keyed', 'PUT', `/wix-data/v2/items/${TEST_ID}`, {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, dataItem: { data: { ...updated, _id: TEST_ID } } },
  });
  timings.update_keyed = upd.ms;
  log(`update ${TEST_ID} -> ${upd.status} in ${upd.ms}ms${upd.status !== 200 ? ' ' + short(upd) : ''}`);
  const got2 = await wix('get-keyed-2', 'GET', `/wix-data/v2/items/${TEST_ID}?dataCollectionId=${ENGINE_COLLECTION}`, { siteId });
  const data2 = got2.json?.dataItem?.data ?? {};
  verdicts.update_roundtrip = data2.listingPricePure === 1299000 && data2._updatedDate !== data._updatedDate;
  log(`re-read ${TEST_ID}: price=${data2.listingPricePure} updatedDate ${JSON.stringify(data._updatedDate)} -> ${JSON.stringify(data2._updatedDate)} roundTrip=${verdicts.update_roundtrip}`);

  // ---- Step 6: one-item-at-a-time inserts, for comparison ----
  const serialIds = [];
  const serialMs = [];
  for (let i = 1; i <= SERIAL_WRITES; i++) {
    const id = `${TEST_ID_PREFIX}SERIAL${pad(i, 4)}`;
    const r = await wix(`serial-insert-${i}`, 'POST', '/wix-data/v2/items', {
      siteId,
      body: { dataCollectionId: ENGINE_COLLECTION, dataItem: { data: fakeListing(id, i, imageUri, source?.url) } },
    });
    if (r.status === 200) serialIds.push(id);
    serialMs.push(r.ms);
    if (r.status !== 200) log(`serial insert ${id} -> ${short(r)}`);
  }
  if (SERIAL_WRITES) {
    timings.serial_insert_p50 = percentile(serialMs, 0.5);
    timings.serial_insert_max = Math.max(...serialMs);
    timings.serial_insert_total = serialMs.reduce((a, b) => a + b, 0);
    log(`serial inserts: ${serialIds.length}/${SERIAL_WRITES} ok, p50=${timings.serial_insert_p50}ms max=${timings.serial_insert_max}ms total=${timings.serial_insert_total}ms`);
  }

  // ---- Step 7: bulk insert / update / save / remove ----
  const bulkIds = Array.from({ length: BULK_SIZE }, (_, i) => `${TEST_ID_PREFIX}BULK${pad(i + 1, 4)}`);
  const rows = bulkIds.map((id, i) => fakeListing(id, i + 1, imageUri, source?.url));

  const bi = await wix('bulk-insert', 'POST', '/wix-data/v2/bulk/items/insert', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, dataItems: rows.map((data) => ({ data })) },
  });
  timings.bulk_insert = bi.ms;
  const insOut = bulkOutcome(`bulk insert (${BULK_SIZE})`, bi, bulkIds);
  verdicts.bulk_insert_ok = insOut.ok;
  verdicts.bulk_ids_preserved = insOut.idsPreserved;

  const afterInsert = await wix('count-after-insert', 'POST', '/wix-data/v2/items/query', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, query: { filter: { _id: { $startsWith: `${TEST_ID_PREFIX}BULK` } }, paging: { limit: 1 } }, returnTotalCount: true },
  });
  log(`bulk rows visible to a query: ${afterInsert.json?.pagingMetadata?.total ?? '?'} of ${BULK_SIZE} (${afterInsert.ms}ms)`);

  const bu = await wix('bulk-update', 'POST', '/wix-data/v2/bulk/items/update', {
    siteId,
    body: {
      dataCollectionId: ENGINE_COLLECTION,
      dataItems: rows.map((data) => ({ id: data._id, data: { ...data, listingPrice: '$1,111,000', listingPricePure: 1111000 } })),
    },
  });
  timings.bulk_update = bu.ms;
  verdicts.bulk_update_ok = bulkOutcome(`bulk update (${BULK_SIZE})`, bu, bulkIds).ok;

  const saveNewIds = Array.from({ length: 5 }, (_, i) => `${TEST_ID_PREFIX}SAVE${pad(i + 1, 4)}`);
  const saveRows = [
    ...rows.map((data) => ({ ...data, listingPrice: '$1,222,000', listingPricePure: 1222000 })),
    ...saveNewIds.map((id, i) => fakeListing(id, 900 + i, imageUri, source?.url)),
  ];
  const bs = await wix('bulk-save', 'POST', '/wix-data/v2/bulk/items/save', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, dataItems: saveRows.map((data) => ({ id: data._id, data })) },
  });
  timings.bulk_save = bs.ms;
  const saveOut = bulkOutcome(`bulk save (${BULK_SIZE} existing + ${saveNewIds.length} new)`, bs, [...bulkIds, ...saveNewIds]);
  verdicts.bulk_save_ok = saveOut.ok;
  verdicts.bulk_save_upserts = (saveOut.actions.UPDATE ?? 0) === BULK_SIZE && (saveOut.actions.INSERT ?? 0) === saveNewIds.length;

  const sample = await wix('get-bulk-sample', 'GET', `/wix-data/v2/items/${bulkIds[0]}?dataCollectionId=${ENGINE_COLLECTION}`, { siteId });
  const samplePrice = sample.json?.dataItem?.data?.listingPricePure;
  verdicts.bulk_writes_applied = samplePrice === 1222000;
  log(`${bulkIds[0]} after update+save: price=${samplePrice} (expected 1222000) applied=${verdicts.bulk_writes_applied}`);

  const removeAll = [...bulkIds, ...saveNewIds, ...serialIds];
  const br = await wix('bulk-remove', 'POST', '/wix-data/v2/bulk/items/remove', {
    siteId,
    body: { dataCollectionId: ENGINE_COLLECTION, dataItemIds: removeAll },
  });
  timings.bulk_remove = br.ms;
  verdicts.bulk_remove_ok = bulkOutcome(`bulk remove (${removeAll.length})`, br, removeAll).ok;

  // ---- Step 8: parallel read burst ----
  if (BURST) {
    const started = Date.now();
    const burst = await Promise.all(
      Array.from({ length: BURST }, (_, i) =>
        wix(`burst-${i}`, 'GET', `/wix-data/v2/items/${TEST_ID}?dataCollectionId=${ENGINE_COLLECTION}`, { siteId })
      )
    );
    const statuses = {};
    for (const r of burst) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    const ms = burst.map((r) => r.ms);
    timings.burst_wall = Date.now() - started;
    timings.burst_p50 = percentile(ms, 0.5);
    timings.burst_max = Math.max(...ms);
    log(`burst of ${BURST} parallel reads: statuses=${JSON.stringify(statuses)} wall=${timings.burst_wall}ms p50=${timings.burst_p50}ms max=${timings.burst_max}ms`);
  }

  // ---- Step 9: cleanup ----
  const remaining = await queryIds(siteId, { _id: { $startsWith: TEST_ID_PREFIX } });
  const toRemove = process.env.LS_PHASE1_CLEANUP === '1' ? remaining : remaining.filter((id) => id !== TEST_ID);
  await removeIds(siteId, toRemove, 'cleanup-remove');
  const kept = remaining.filter((id) => !toRemove.includes(id));
  log(`cleanup: removed ${toRemove.length}, kept ${JSON.stringify(kept)}${kept.includes(TEST_ID) ? ` (bind a hidden dynamic page to ${ENGINE_COLLECTION} and open ${TEST_ID}; LS_PHASE1_CLEANUP=1 removes it)` : ''}`);
  verdicts.cleanup_left_only_keyed = kept.every((id) => id === TEST_ID);
  timings.inventory = inventory;
}

try {
  await main();
} catch (err) {
  log(`fatal: ${err?.stack ?? err?.message ?? err}`);
}

// ---- Summary ----
const rateLimited = calls.filter((c) => c.status === 429);
const serverErrors = calls.filter((c) => c.status >= 500);
const networkErrors = calls.filter((c) => c.status === 0);
log('---- summary ----');
log(`wix calls: ${calls.length} total, ${rateLimited.length} rate-limited (429), ${serverErrors.length} 5xx, ${networkErrors.length} network errors`);
if (rateLimited.length) {
  for (const c of rateLimited) log(`  429 on ${c.label}: ${JSON.stringify(c)}`);
} else {
  log('  no 429s; Wix documents 200 requests/minute per app instance, which a one-item-at-a-time full reconcile of ~330 rows would exceed and a bulk one (1 call per 1000 rows) never touches');
}
log(`timings (ms): ${JSON.stringify(timings)}`);
log(`verdicts: ${JSON.stringify(verdicts)}`);
log(`SUMMARY_JSON ${JSON.stringify({ timings, verdicts, calls: calls.length, rateLimited: rateLimited.length, slowest: [...calls].sort((a, b) => b.ms - a.ms).slice(0, 5) })}`);
log('done.');
process.exit(0);
