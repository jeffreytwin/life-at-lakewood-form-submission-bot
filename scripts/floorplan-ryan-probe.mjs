// Round five (Jeff, 2026-09-22) — Richmond American only.
//
// Richmond's own robots.txt names the endpoint its page calls,
// /Community/LoadAll/, and disallows it in the same breath. Before that
// becomes a question, look for a route the site invites: does its sitemap
// publish pages for this community's plans and homes, and does one of
// those render on the server the way the community page does not?
//
// Runs as a prebuild step on Vercel, guarded to the working branch;
// results are read from the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-RICH: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const get = async (url) => {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  return { res, body: await res.text().catch(() => '') };
};

const ROOT = 'https://www.richmondamerican.com';

try {
  const { body: index } = await get(`${ROOT}/sitemap.xml`);
  const children = [...index.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
  console.log(`FP-RICH: sitemap index lists ${children.length}: ${JSON.stringify(children.slice(0, 10))}`);

  const hits = new Set();
  for (const child of children.slice(0, 8)) {
    try {
      const { res, body } = await get(child);
      const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
      const mine = locs.filter((u) => /estates-at-rivers-edge/i.test(u));
      mine.forEach((u) => hits.add(u));
      console.log(`FP-RICH: ${child.split('/').pop()} -> ${res.status}, ${locs.length} urls, ${mine.length} for this community (total ${hits.size})`);
    } catch (err) {
      console.log(`FP-RICH: ${child} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
    }
  }
  const found = [...hits];
  console.log(`FP-RICH: community pages in the sitemap (${found.length}): ${JSON.stringify(found.slice(0, 30))}`);

  // Does any of them render its facts on the server?
  for (const url of found.filter((u) => u.replace(/\/$/, '').split('/').length > 7).slice(0, 3)) {
    try {
      const { res, body } = await get(url);
      const priced = body.search(/\$\s?[1-9]\d{2},\d{3}/);
      const sq = body.search(/[1-9],\d{3}\s*(?:sq\.?\s*ft|square feet)/i);
      console.log(
        `FP-RICH-PAGE: ${url.slice(ROOT.length)} -> ${res.status} (${body.length} bytes), price at ${priced}, sqft at ${sq}` +
          (priced >= 0 ? ` >>> ${body.slice(Math.max(0, priced - 250), priced + 450).replace(/\s+/g, ' ')}` : '')
      );
    } catch (err) {
      console.log(`FP-RICH-PAGE: ${url} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
    }
  }
} catch (err) {
  console.log(`FP-RICH: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-RICH: done');
process.exit(0);
