// SimplyDwell Homes probe: can a run capture the primary image, the
// interior photos, a virtual tour link and the plan's description?
//
// The connection (Broadleaf, lifeatparrish.com) is pinned to the community
// page and runs on the generic fetch_claude engine, which reads that one
// page and reports photos and blueprints only. This checks what the pages
// actually carry: the community page the connection reads today, and the
// plan detail pages it does not, since that is where builders usually keep
// interiors, tours and copy. Runs as a prebuild step, guarded to the
// working branch; read the results in the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-SDWELL: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html',
};

const COMMUNITY = 'https://simplydwellhomes.com/community/broadleaf/';

// The plan detail pages the community page links to as "View". The first
// pass showed the community page itself carries one exterior elevation per
// plan and no tours, so these are where interiors, copy and tours would be.
const PLAN_PAGES = [
  'https://simplydwellhomes.com/new-homes/broadleaf/cypress/',
  'https://simplydwellhomes.com/new-homes/broadleaf/hawthorn-broadleaf/',
  'https://simplydwellhomes.com/new-homes/broadleaf/jasmine-2/',
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

// A tour is whatever the builder uses: Matterport, InsideMaps, Kuula,
// CloudPano, a YouTube/Vimeo walkthrough, or a link that says "tour".
const TOUR_RE =
  /(matterport|insidemaps|kuula|cloudpano|eyespy360|truplace|youtube\.com|youtu\.be|vimeo\.com|virtual-?tour|3d-?tour)/i;

async function read(label, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const html = await res.text().catch(() => '');
    const text = distill(html, res.url);
    // Every image the engine would see, and every link that looks like a tour.
    const imgs = [...text.matchAll(/\[IMG ([^\]]+)\]/g)].map((m) => m[1]);
    const links = [...text.matchAll(/\[LINK ([^\]]+)\]/g)].map((m) => m[1]);
    const tours = [...new Set([...links, ...imgs].filter((u) => TOUR_RE.test(u)))];
    // Tours are often iframes or data attributes rather than <a href>, so
    // look in the raw HTML too — the engine strips those, which is itself
    // worth knowing.
    const rawTours = [...new Set((html.match(new RegExp(`https?://[^"'\\s<>]*${TOUR_RE.source}[^"'\\s<>]*`, 'gi')) ?? []))];
    const prices = (text.match(/\$\s?\d[\d,.]*/g) ?? []).length;
    console.log(
      `FP-SDWELL: ${label} -> ${res.status} ${res.url} (${html.length} bytes html, ${text.length} chars text, ` +
        `${prices} prices, ${imgs.length} images, ${links.length} links, ${Date.now() - started}ms)`
    );
    console.log(`FP-SDWELL: ${label} tours-in-distilled=${JSON.stringify(tours.slice(0, 6))}`);
    console.log(`FP-SDWELL: ${label} tours-in-raw-html=${JSON.stringify(rawTours.slice(0, 6))}`);
    console.log(`FP-SDWELL: ${label} images=${JSON.stringify(imgs.slice(0, 60))}`);
    return { html, text, links };
  } catch (err) {
    console.log(
      `FP-SDWELL: ${label} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)} (${Date.now() - started}ms)`
    );
    return null;
  }
}

const community = await read('community-page', COMMUNITY);

if (community) {
  // Every "View" link, to confirm the plan pages below are the ones this
  // page sends a reader to.
  const planLinks = [...new Set(community.links.filter((u) => /simplydwellhomes\.com\/new-homes\//i.test(u)))];
  console.log(`FP-SDWELL: community-page plan-links=${planLinks.length} ${JSON.stringify(planLinks.slice(0, 6))}`);
}

// The first plan page in full: what one plan's own page offers a scrape.
for (const [i, url] of PLAN_PAGES.entries()) {
  const label = `plan-${i + 1}`;
  const plan = await read(label, url);
  if (!plan) continue;
  if (i > 0) continue; // counts and image/tour lists are enough for the rest
  for (let j = 0; j < plan.text.length; j += 1500) {
    console.log(`FP-SDWELL: ${label} text[${j}]= ${JSON.stringify(plan.text.slice(j, j + 1500))}`);
  }
}
console.log('FP-SDWELL: done');
process.exit(0);
