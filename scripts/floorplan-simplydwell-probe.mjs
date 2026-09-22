// SimplyDwell probe: the base plans came through with no price and, on
// most plans, no virtual tour, and their photos arrive in no useful order
// (Jeff, 2026-09-22). Report what the plan pages actually carry: the price
// as the page writes it, every tour-looking URL wherever it hides, and each
// gallery image with whatever the page says about it (alt, title, caption,
// the heading above it). Guarded to the working branch; always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-SD: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html',
};

const PAGES = [
  ['azalea', 'https://simplydwellhomes.com/new-homes/broadleaf/azalea-broadleaf/'],
  ['cassia', 'https://simplydwellhomes.com/new-homes/broadleaf/cassia/'],
  ['hawthorne-42', 'https://simplydwellhomes.com/new-homes/broadleaf/hawthorn-broadleaf/hawthorne-homesite-42/'],
];

const squash = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const tail = (u) => u.split('/').pop()?.slice(0, 70) ?? u;

for (const [label, url] of PAGES) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await res.text().catch(() => '');
    console.log(`FP-SD: ${label} ${res.status} html=${html.length}b`);

    // 1. The price, as the page writes it.
    const prices = [...new Set([...html.matchAll(/\$\s?\d[\d,]{4,}/g)].map((m) => m[0]))];
    console.log(`FP-SD: ${label} prices=${JSON.stringify(prices.slice(0, 8))}`);
    const priced = html.search(/Priced|Starting|From \$|\$\s?\d[\d,]{4,}/i);
    if (priced >= 0) console.log(`FP-SD: ${label} price-cxt ${JSON.stringify(squash(html.slice(Math.max(0, priced - 250), priced + 250)))}`);

    // 2. Tours, wherever they hide: iframes, links, and the raw payload.
    const iframes = [...new Set([...html.matchAll(/<iframe\b[^>]*?src=["']([^"']+)["']/gi)].map((m) => m[1]))];
    console.log(`FP-SD: ${label} iframes=${JSON.stringify(iframes.slice(0, 6))}`);
    const tourish = [
      ...new Set(
        [...html.matchAll(/https?:(?:\\?\/){2}[^\s"'<>\\)]{4,160}/gi)]
          .map((m) => m[0].replace(/\\/g, ''))
          .filter((u) => /matterport|insidemaps|kuula|cloudpano|eyespy360|truplace|youtu|vimeo|tour|360|walkthrough/i.test(u))
      ),
    ];
    console.log(`FP-SD: ${label} tour-urls=${JSON.stringify(tourish.slice(0, 10))}`);
    for (const m of [...html.matchAll(/(virtual tour|3d tour|take a tour|tour this home)/gi)].slice(0, 3)) {
      console.log(`FP-SD: ${label} near-tour ${JSON.stringify(html.slice(Math.max(0, m.index - 300), m.index + 400))}`);
    }

    // 3. Every gallery image with what the page says about it, in order.
    const marks = [];
    for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]{0,200}?)<\/h\1>/gi)) marks.push([m.index, `H${m[1]} ${squash(m[2]).slice(0, 60)}`]);
    for (const m of html.matchAll(/<figcaption\b[^>]*>([\s\S]{0,200}?)<\/figcaption>/gi)) marks.push([m.index, `CAP ${squash(m[1]).slice(0, 70)}`]);
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const t = m[0];
      const src = t.match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? t.match(/\sdata-src=["']([^"']+)["']/i)?.[1] ?? '';
      const alt = t.match(/\salt=["']([^"']*)["']/i)?.[1] ?? '';
      const title = t.match(/\stitle=["']([^"']*)["']/i)?.[1] ?? '';
      marks.push([m.index, `IMG ${tail(src)}${alt ? ` alt="${alt.slice(0, 60)}"` : ''}${title ? ` title="${title.slice(0, 40)}"` : ''}`]);
    }
    marks.sort((a, b) => a[0] - b[0]);
    const lines = marks.map(([o, t]) => `@${o} ${t}`);
    for (let i = 0; i < lines.length && i < 160; i += 6) {
      console.log(`FP-SD: ${label} | ${lines.slice(i, i + 6).join(' | ')}`);
    }
    console.log(`FP-SD: ${label} marks=${marks.length}`);
  } catch (error) {
    console.log(`FP-SD: ${label} FAILED ${error?.message ?? error}`);
  }
}
