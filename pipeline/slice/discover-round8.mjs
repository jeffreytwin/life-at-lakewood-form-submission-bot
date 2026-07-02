// Round-8 discovery (GitHub Actions): DRB community-id hunt. The public
// API's /community resource times out, but /inventory ignores its filters
// and returns everything paginated — so sweep the inventory (and plans)
// and locate Biscayne Landing at Seaire's communityId from item content,
// plus probe by-id community lookups. Output: discovery/round8/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'round8');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, text };
  } catch (err) {
    return { status: 0, text: '', error: String(err?.cause?.message ?? err?.message ?? err) };
  }
}

const save = (name, data) =>
  writeFile(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

await mkdir(OUT, { recursive: true });
const summary = {};

// 1. Sweep inventory pages hunting Seaire/Biscayne/Parrish mentions and
//    collect communityId -> evidence.
const found = {};
let pages = 0;
for (let page = 1; page <= 20; page++) {
  const res = await get(`https://api.drbhomes.com/api/v1/public/inventory?limit=50&page=${page}`);
  if (res.status !== 200) { summary.inventorySweepStopped = { page, status: res.status, error: res.error }; break; }
  let parsed;
  try { parsed = JSON.parse(res.text); } catch { break; }
  pages = page;
  for (const item of parsed.items ?? []) {
    const blob = JSON.stringify(item);
    const cid = item.communityId;
    if (/seaire|biscayne/i.test(blob)) {
      found[cid] ??= { count: 0, samples: [] };
      found[cid].count += 1;
      if (found[cid].samples.length < 2) {
        found[cid].samples.push({
          id: item.id,
          planId: item.planId,
          headline: item.marketingHeadline?.slice(0, 120),
          price: item.price,
          address: item.entityAddress ?? null,
          websiteUrl: item.websiteUrl?.slice(0, 160),
        });
      }
    }
  }
  const totalPages = parsed.meta?.totalPages ?? 0;
  if (page >= totalPages) break;
  await new Promise((r) => setTimeout(r, 250));
}
summary.inventoryPagesScanned = pages;
summary.seaireCommunityIds = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.count]));
await save('drb-seaire-hunt.json', found);

// 2. By-id community probes for whatever ids surfaced (plus 281 from
//    round 6's first inventory page).
const ids = [...new Set([...Object.keys(found), '281'])].slice(0, 5);
const probes = [];
for (const id of ids) {
  for (const url of [
    `https://api.drbhomes.com/api/v1/public/community/${id}`,
    `https://api.drbhomes.com/api/v1/public/inventory?limit=5&page=1&communityIds=${id}`,
  ]) {
    const res = await get(url);
    probes.push({ url: url.slice(30), status: res.status, bytes: res.text.length, error: res.error });
    if (res.status === 200 && res.text.length > 100) {
      await save(`drb-community-${id}-${probes.length}.json`, res.text.slice(0, 60_000));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
await save('drb-id-probes.json', probes);
summary.idProbes = probes;

// 3. Does /plan support filtering by ids the inventory references?
const planProbe = await get('https://api.drbhomes.com/api/v1/public/plan?limit=5&page=1&ids=2006');
summary.planIdsProbe = { status: planProbe.status, bytes: planProbe.text.length };
if (planProbe.status === 200) await save('drb-plan-ids-probe.json', planProbe.text.slice(0, 30_000));

await save('round8-summary.json', summary);
console.log('round-8 complete:', JSON.stringify(summary, null, 1));
