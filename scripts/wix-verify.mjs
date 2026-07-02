// One-shot Wix API key verification, run as a prebuild step on Vercel where
// WIX_API_KEY is available. Prints each site's Wix Data collections (and full
// field lists for floor-plan-ish collections) to the build log, then always
// exits 0 — it must never fail or slow a deploy. Remove once the floor plan
// sync pipeline's Wix client is in place.

const SITES = [
  { domain: 'lifeatlakewood.com', siteId: '4fbabb96-2d6c-4f20-a240-9223153498b5' },
  { domain: 'lifeinwellenpark.com', siteId: '1a8c2755-823e-4882-ae32-e6c108a30e39' },
  { domain: 'lifeatparrish.com', siteId: 'a704cfe5-dd9b-44ff-a017-9d637d8c6fdc' },
];

const key = process.env.WIX_API_KEY;
if (!key) {
  console.log('WIX_VERIFY: WIX_API_KEY not set in this environment; skipping.');
  process.exit(0);
}

async function wixGet(path, siteId) {
  const res = await fetch(`https://www.wixapis.com${path}`, {
    headers: { authorization: key, 'wix-site-id': siteId },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function countItems(collectionId, siteId) {
  try {
    const res = await fetch('https://www.wixapis.com/wix-data/v2/items/query', {
      method: 'POST',
      headers: {
        authorization: key,
        'wix-site-id': siteId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        dataCollectionId: collectionId,
        query: { paging: { limit: 1 } },
        returnTotalCount: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return `count-error ${res.status}`;
    const data = await res.json();
    return data.pagingMetadata?.total ?? '?';
  } catch (err) {
    return `count-error ${err?.message ?? err}`;
  }
}

try {
  for (const site of SITES) {
    console.log(`\nWIX_VERIFY ===== ${site.domain} (${site.siteId}) =====`);
    try {
      const data = await wixGet('/wix-data/v2/collections?paging.limit=100', site.siteId);
      const collections = data.dataCollections ?? data.collections ?? [];
      console.log(`WIX_VERIFY collections: ${collections.length}`);
      for (const c of collections) {
        const isFloorish = /floor/i.test(`${c.id} ${c.displayName ?? ''}`);
        const count = isFloorish ? await countItems(c.id, site.siteId) : '';
        console.log(
          `WIX_VERIFY   ${c.id} | "${c.displayName ?? ''}" | ${c.fields?.length ?? 0} fields` +
            (isFloorish ? ` | ${count} items` : ''),
        );
        if (isFloorish && c.fields) {
          for (const f of c.fields) {
            console.log(`WIX_VERIFY       field ${f.key} : ${f.type}${f.systemField ? ' (system)' : ''}`);
          }
        }
      }
    } catch (err) {
      console.log(`WIX_VERIFY ERROR for ${site.domain}: ${err?.message ?? err}`);
    }
  }
  console.log('\nWIX_VERIFY done.');
} catch (err) {
  console.log(`WIX_VERIFY fatal: ${err?.message ?? err}`);
}
process.exit(0);
