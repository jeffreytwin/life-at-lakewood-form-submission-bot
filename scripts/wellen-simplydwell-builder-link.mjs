// Links Wellen Park's SimplyDwell Homes floor plans to the builder's new row
// in the Builders collection, Jeff 2026-10-30: "I just added the builder
// 'SimplyDwell Homes' (https://www.lifeinwellenpark.com/builders/simplydwell)
// to our builders collection in Wix. Can you update the wellen park floor
// plans that feature this builder? (I believe the community is Madera)."
//
// Runs as a prebuild step on Vercel (the only environment holding
// WIX_API_KEY and the Supabase service key), guarded to its own branch so
// production and other preview builds skip it. Always exits 0: it must never
// fail or slow a deploy.
//
// Read 2026-10-30 from the builder's page: the Builders item "SimplyDwell
// Homes", published 18:10 UTC, and the four Madera plans of the legacy
// FloorPlans collection the site still shows (Emilia, Olivia, Scarlett,
// Sienna), none with a builder1, where David Weekley's rows point at theirs.
// The pipeline's four Madera rows in Floor Plans V2 went out without builder1
// too, there being no item to point at (wix-references.ts). The scheduled
// check (qmi-flags.ts) would link those, but it reads only V2.
//
// In both collections every row whose builder is SimplyDwell's and whose
// builder1 is blank gets builder1 = the new item, and nothing else changes:
// the update sends the row back as read, _publishStatus included, because
// Wix's update replaces the whole item and one that leaves _publishStatus out
// publishes a draft (docs/VILLAGE_RANGES.md). A row already pointing at
// another item is left as it is and logged. The villages link is not
// written: Wellen Park's neighborhoods collection had no Madera item when
// last cached (2026-09-21); whether it has one now is logged.
//
// The Builders item and the rows read are cached in fp_legacy_items so the
// result can be checked from a sandbox with no Wix credentials.

const BRANCHES = new Set(['claude/tender-davinci-xm9p11']);
const SITE_ID = '1a8c2755-823e-4882-ae32-e6c108a30e39'; // lifeinwellenpark.com
const BUILDERS = 'Builders';
const BUILDER = 'SimplyDwell Homes';
const BUILDER_ITEM_ID = 'b28c46d2-d1bf-49cb-8f0b-2c96cde5b6f9';
// The legacy collection the site shows, and the pipeline's.
const FLOOR_PLANS = ['FloorPlans', 'FloorPlansV2'];
const VILLAGES = 'HousesforSale-DynamicPages';
const COMMUNITY = 'Madera';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (!BRANCHES.has(branch)) {
  console.log(`SIMPLYDWELL: branch ${branch ?? '(none)'} is not the link branch; skipping.`);
  process.exit(0);
}
const wixKey = process.env.WIX_API_KEY;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!wixKey || !supaUrl || !supaKey) {
  console.log('SIMPLYDWELL: missing WIX_API_KEY or Supabase env; skipping.');
  process.exit(0);
}

const log = (...a) => console.log('SIMPLYDWELL', ...a);

async function wix(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://www.wixapis.com${path}`, {
      method,
      headers: { authorization: wixKey, 'wix-site-id': SITE_ID, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    // Wix throttles bursts; a few seconds' wait is enough for a handful of rows.
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
      continue;
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, json, text };
  }
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

const getItem = (collection, id) =>
  wix('GET', `/wix-data/v2/items/${id}?dataCollectionId=${collection}&publishPluginOptions.includeDraftItems=true`);

/** Every item of a collection matching `filter`, drafts included, a page at a time. */
async function queryAll(collection, filter) {
  const all = [];
  for (;;) {
    const res = await wix('POST', '/wix-data/v2/items/query', {
      dataCollectionId: collection,
      query: { ...(filter ? { filter } : {}), paging: { limit: 100, offset: all.length } },
      returnTotalCount: true,
      publishPluginOptions: { includeDraftItems: true },
    });
    if (res.status !== 200) throw new Error(`query ${collection}: ${res.status} ${(res.text ?? '').slice(0, 300)}`);
    const items = res.json?.dataItems ?? [];
    all.push(...items);
    if (!items.length || all.length >= (res.json?.pagingMetadata?.total ?? all.length)) return all;
  }
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const norm = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
/** A reference field as Wix gives it: the referenced item's id, or the item itself. */
const refOf = (v) => (typeof v === 'string' ? v.trim() : typeof v?._id === 'string' ? v._id : '');
const idOf = (item) => item.id ?? item.data?._id;
const isSimplyDwell = (d) => norm(d.builder).includes('simplydwell');

/** The fields besides builder1 that read differently after the write; none expected. */
function drift(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (k) => !k.startsWith('_') && k !== 'builder1' && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)
  );
}

/** Sets one row's builder1, read again just before so nothing written since is lost. */
async function link(collection, id) {
  const read = await getItem(collection, id);
  const item = read.json?.dataItem;
  if (read.status !== 200 || !item) return { error: `read ${read.status} ${(read.text ?? '').slice(0, 300)}` };
  const data = item.data ?? {};
  if (refOf(data.builder1)) return { error: `builder1 was set to ${refOf(data.builder1)} since the scan; left`, after: item };
  const base = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')));
  const payload = { ...base, builder1: BUILDER_ITEM_ID, _id: id, ...(data._publishStatus ? { _publishStatus: data._publishStatus } : {}) };
  const put = await wix('PUT', `/wix-data/v2/items/${id}`, {
    dataCollectionId: collection,
    dataItem: { id, data: payload },
    publishPluginOptions: { includeDraftItems: true },
  });
  if (put.status !== 200) return { error: `update ${put.status} ${(put.text ?? '').slice(0, 500)}`, after: item };
  const after = (await getItem(collection, id)).json?.dataItem;
  if (!after) return { error: 'written, but the row could not be read back', after: item };
  const problems = [];
  if (refOf(after.data?.builder1) !== BUILDER_ITEM_ID) problems.push(`builder1 reads ${refOf(after.data?.builder1) || 'blank'}`);
  if (after.data?._publishStatus !== data._publishStatus) problems.push(`status ${data._publishStatus} -> ${after.data?._publishStatus} (CHANGED)`);
  const changed = drift(data, after.data ?? {});
  if (changed.length) problems.push(`also reads differently: ${changed.join(', ')}`);
  return { after, problems };
}

async function main() {
  const read = await getItem(BUILDERS, BUILDER_ITEM_ID);
  const builder = read.json?.dataItem;
  if (read.status !== 200 || text(builder?.data?.title) !== BUILDER) {
    log(`Builders item ${BUILDER_ITEM_ID} reads ${read.status} "${text(builder?.data?.title)}", not ${BUILDER}; nothing written.`);
    return;
  }
  const named = await queryAll(BUILDERS, { title: { $eq: BUILDER } });
  log(`Builders item ${BUILDER_ITEM_ID} is ${builder.data._publishStatus}; titled ${BUILDER}: ${named.map((i) => `${idOf(i)} (${i.data?._publishStatus})`).join(', ')}`);

  const cache = [{ collection: BUILDERS, item: builder }];
  const totals = { linked: 0, already: 0, left: 0, failed: 0 };
  for (const collection of FLOOR_PLANS) {
    const items = await queryAll(collection);
    const rows = items.filter((i) => isSimplyDwell(i.data ?? {}) || norm(i.data?.village) === norm(COMMUNITY));
    log(`${collection}: ${items.length} rows, ${rows.length} SimplyDwell's or in ${COMMUNITY}`);
    for (const item of rows) {
      const d = item.data ?? {};
      const id = idOf(item);
      const label = `${collection} ${id} "${text(d.floorPlanName)}" (${text(d.builder) || 'no builder'}, ${text(d.village) || 'no village'}, ${d._publishStatus ?? 'no status'}${text(d.relatedFloorPlanQuickMoveInOnly) ? `, quick move-in of ${text(d.relatedFloorPlanQuickMoveInOnly)}` : ''})`;
      const b1 = refOf(d.builder1);
      if (!isSimplyDwell(d)) {
        log(`${label}: not SimplyDwell's; builder1 ${b1 || 'blank'}; left`);
        totals.left += 1;
        cache.push({ collection, item });
      } else if (b1 === BUILDER_ITEM_ID) {
        log(`${label}: already linked`);
        totals.already += 1;
        cache.push({ collection, item });
      } else if (b1) {
        log(`${label}: builder1 points at ${b1}; left`);
        totals.left += 1;
        cache.push({ collection, item });
      } else {
        const result = await link(collection, id);
        if (result.after) cache.push({ collection, item: result.after });
        if (result.error) {
          log(`${label}: ${result.error}`);
          totals.failed += 1;
        } else {
          log(`${label}: linked${result.problems.length ? `; ${result.problems.join('; ')}` : ''}; villages ${refOf(result.after.data?.villages) || 'blank'}`);
          totals.linked += 1;
        }
      }
    }
  }

  const hoods = await queryAll(VILLAGES, { title: { $contains: COMMUNITY } });
  log(`${VILLAGES} titled like ${COMMUNITY}: ${hoods.map((i) => `${idOf(i)} "${text(i.data?.title)}" (${i.data?._publishStatus})`).join(', ') || 'none'}; villages links not written`);
  log(`done: ${totals.linked} linked, ${totals.already} already linked, ${totals.left} left, ${totals.failed} failed`);

  const sites = await supa('fp_sites?domain=eq.lifeinwellenpark.com&select=id');
  if (sites?.[0]?.id) {
    await supa('fp_legacy_items?on_conflict=site_id,collection_id,wix_record_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: cache.map(({ collection, item }) => ({
        site_id: sites[0].id,
        collection_id: collection,
        wix_record_id: idOf(item),
        data: item.data,
        publish_status: item.data?._publishStatus ?? null,
        imported_at: new Date().toISOString(),
      })),
    });
    log(`cached ${cache.length} items in fp_legacy_items`);
  }
}

main().catch((error) => log(`failed: ${error?.message ?? error}`)).finally(() => process.exit(0));
