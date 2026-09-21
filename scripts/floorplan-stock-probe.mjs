// Stock Luxury Homes probe: the Wild Blue connection has never run, and its
// URL auto-discovers on first run. Ranking the stored candidates (the real
// discover-url scoring) picks the community overview page, which the audit
// measured at 2,129 chars of text and no prices — the plans look to live on
// the separate /floorplans page, which ranks below it. This fetches all of
// them from Vercel's egress and reports what the fetch_claude engine would
// actually be handed: distilled text length, prices, sizes, plan-name hints.
// Runs as a prebuild step, guarded to the working branch; read the results
// in the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-STOCK: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html',
};

// The pages the connection could be pointed at, in the order URL discovery
// ranks them (first is what an unattended first run would pin).
const TARGETS = [
  ['discovery-pick-overview', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside'],
  ['floorplans', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans'],
  ['inventory', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/inventory'],
];

/** Same shape the fetch_claude engine feeds Claude (claude-extract.ts). */
function distill(html, baseUrl) {
  const abs = (u) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  const withImgs = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<img\b[^>]*?src=["']([^"']+)["'][^>]*>/gi, (_, src) => ` [IMG ${abs(src)}] `)
    .replace(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>/gi, (_, href) => ` [LINK ${abs(href)}] `);
  return withImgs
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const count = (text, re) => (text.match(re) ?? []).length;

for (const [slug, url] of TARGETS) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const html = await res.text().catch(() => '');
    const text = distill(html, res.url);
    const prices = count(text, /\$\s?\d[\d,.]*\s?(?:million|[MmKk]\b)?/g);
    const sqft = count(text, /\b[\d,]{3,6}\s?(?:sq\.?\s?ft|square feet)/gi);
    const beds = count(text, /\b\d+\s?(?:bed|bd)\b/gi);
    // The [IMG ...] markers the engine hands Claude for galleries/blueprints.
    const imgs = count(text, /\[IMG /g);
    console.log(
      `FP-STOCK: ${slug} -> ${res.status} ${res.url} (${html.length} bytes html, ${text.length} chars text, ` +
        `${prices} prices, ${sqft} sizes, ${beds} beds, ${imgs} images, ${Date.now() - started}ms)`
    );
    console.log(`FP-STOCK: ${slug} names-community=${/wild blue/i.test(text)} names-market=${/lakewood ranch/i.test(text)} under-500-chars=${text.length < 500}`);
    console.log(`FP-STOCK: ${slug} text= ${JSON.stringify(text.slice(0, 1200))}`);
  } catch (err) {
    console.log(
      `FP-STOCK: ${slug} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)} (${Date.now() - started}ms)`
    );
  }
}
console.log('FP-STOCK: done');
process.exit(0);
