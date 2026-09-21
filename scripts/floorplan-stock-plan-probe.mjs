// Stock Luxury Homes plan-page probe: the community floor plans page gives
// a row per plan (name, beds, baths, size, price) and nothing else, so
// garages, the virtual tours and the interior galleries have to come from
// each plan's own page. This reads two of them the way the fetch_claude
// engine would and reports what that engine would be handed: the distilled
// text in full, every image, and every tour-looking URL — in the distilled
// text and in the raw HTML both, since an iframe never survives
// distillation. Guarded to the working branch; always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-STOCKPLAN: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html',
};

const PLANS = [
  ['wyndam-iv-320', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/320/'],
  ['clairborne-ii-312', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/312/'],
];

const TOUR_RE =
  /(matterport|insidemaps|kuula|cloudpano|eyespy360|truplace|youtube\.com|youtu\.be|vimeo\.com|virtual-?tour|3d-?tour|tour)/i;

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

for (const [label, url] of PLANS) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await res.text().catch(() => '');
    const text = distill(html, res.url);
    const imgs = [...text.matchAll(/\[IMG ([^\]]+)\]/g)].map((m) => m[1]);
    const links = [...text.matchAll(/\[LINK ([^\]]+)\]/g)].map((m) => m[1]);
    const tours = [...new Set([...links, ...imgs].filter((u) => TOUR_RE.test(u)))];
    // An iframe's src is stripped by distillation, so look in the raw HTML too.
    const iframes = [...html.matchAll(/<iframe\b[^>]*?src=["']([^"']+)["']/gi)].map((m) => m[1]);
    console.log(
      `FP-STOCKPLAN: ${label} -> ${res.status} ${res.url} (${html.length} bytes html, ${text.length} chars text, ${imgs.length} images, ${links.length} links, ${Date.now() - started}ms)`
    );
    console.log(`FP-STOCKPLAN: ${label} says-garage=${/garage/i.test(text)} tours-in-text=${JSON.stringify(tours.slice(0, 8))}`);
    console.log(`FP-STOCKPLAN: ${label} iframes=${JSON.stringify(iframes.slice(0, 8))}`);
    console.log(`FP-STOCKPLAN: ${label} images=${JSON.stringify(imgs.slice(0, 40))}`);
    for (let i = 0; i < text.length; i += 1500) {
      console.log(`FP-STOCKPLAN: ${label} text[${i}]= ${JSON.stringify(text.slice(i, i + 1500))}`);
    }
  } catch (err) {
    console.log(`FP-STOCKPLAN: ${label} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)} (${Date.now() - started}ms)`);
  }
}
console.log('FP-STOCKPLAN: done');
process.exit(0);
