// Imports every legacy FloorPlans + Builders record from each site's Wix
// collections into Supabase (fp_legacy_items), as source data for builder
// roster derivation and the cutover report baseline.
//
// Runs as a prebuild step on Vercel (the only environment holding both
// WIX_API_KEY and the Supabase service key), guarded to the floor plan
// pipeline branch so production and unrelated preview builds skip it.
// Always exits 0 — it must never fail or slow a deploy.

const PIPELINE_BRANCH = 'claude/wix-floor-plan-automation-sbqc80';
const COLLECTIONS = ['FloorPlans', 'Builders'];

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PIPELINE_BRANCH) {
  console.log(`FP_IMPORT: branch ${branch ?? '(none)'} is not ${PIPELINE_BRANCH}; skipping.`);
  process.exit(0);
}

const wixKey = process.env.WIX_API_KEY;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!wixKey || !supaUrl || !supaKey) {
  console.log('FP_IMPORT: missing WIX_API_KEY or Supabase env; skipping.');
  process.exit(0);
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

async function fetchWixItems(siteId, collectionId) {
  const items = [];
  let offset = 0;
  for (;;) {
    const res = await fetch('https://www.wixapis.com/wix-data/v2/items/query', {
      method: 'POST',
      headers: {
        authorization: wixKey,
        'wix-site-id': siteId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        dataCollectionId: collectionId,
        query: { paging: { limit: 100, offset } },
        returnTotalCount: true,
        includeReferencedItems: [],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`wix query ${collectionId}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const batch = (data.dataItems ?? []).map((i) => ({ id: i.id, data: i.data ?? {} }));
    items.push(...batch);
    const total = data.pagingMetadata?.total ?? items.length;
    offset += batch.length;
    if (batch.length === 0 || offset >= total) return { items, total };
  }
}

try {
  const sites = await supa('fp_sites?select=id,domain,wix_site_id&active=eq.true');
  for (const site of sites) {
    if (!site.wix_site_id) continue;
    for (const collectionId of COLLECTIONS) {
      try {
        const { items, total } = await fetchWixItems(site.wix_site_id, collectionId);
        console.log(`FP_IMPORT ${site.domain}/${collectionId}: fetched ${items.length} of ${total}`);
        for (let i = 0; i < items.length; i += 200) {
          const chunk = items.slice(i, i + 200).map((item) => ({
            site_id: site.id,
            collection_id: collectionId,
            wix_record_id: item.id,
            data: item.data,
            imported_at: new Date().toISOString(),
          }));
          await supa('fp_legacy_items?on_conflict=site_id,collection_id,wix_record_id', {
            method: 'POST',
            headers: { prefer: 'resolution=merge-duplicates' },
            body: chunk,
          });
        }
        console.log(`FP_IMPORT ${site.domain}/${collectionId}: upserted ${items.length}`);
      } catch (err) {
        console.log(`FP_IMPORT ERROR ${site.domain}/${collectionId}: ${err?.message ?? err}`);
      }
    }
  }
  console.log('FP_IMPORT done.');
} catch (err) {
  console.log(`FP_IMPORT fatal: ${err?.message ?? err}`);
}
process.exit(0);
