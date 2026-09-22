// Stock Luxury Homes gallery probe: the plan pages give exteriors but no
// interiors (Jeff, 2026-09-22), so this reports the SHAPE of a plan page —
// headings, gallery containers and every image in document order — to see
// where the first gallery starts, where the next one starts, and whether
// the pictures behind "+ 25 more" are in the markup at all. Guarded to the
// working branch; always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-STOCKGAL: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html',
};

const PLANS = [
  ['wyndam-iv', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/320/'],
  ['chandler-v', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/374/'],
];

const IMG_EXT = /\.(?:jpe?g|png|webp|avif|gif)(?:\?[^\s"'<>\\]*)?$/i;
const tail = (u) => {
  try {
    return new URL(u, 'https://www.stockdevelopment.com').pathname.split('/').slice(-2).join('/');
  } catch {
    return u.slice(-60);
  }
};
const squash = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

for (const [label, url] of PLANS) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await res.text().catch(() => '');
    console.log(`FP-STOCKGAL: ${label} ${res.status} ${res.url} html=${html.length}b`);

    // Every structural marker, in document order.
    const marks = [];
    for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]{0,300}?)<\/h\1>/gi)) {
      marks.push([m.index, `H${m[1]}  ${squash(m[2])}`]);
    }
    for (const m of html.matchAll(/<(section|div|ul)\b[^>]*class=["']([^"']*(?:gallery|slider|carousel|swiper|slick|lightbox|fancybox|photos|grid)[^"']*)["'][^>]*>/gi)) {
      marks.push([m.index, `BOX <${m[1]} class="${m[2].slice(0, 90)}">`]);
    }
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const t = m[0];
      const src = t.match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? '';
      const data = t.match(/\sdata-(?:src|lazy|original)=["']([^"']+)["']/i)?.[1] ?? '';
      const alt = t.match(/\salt=["']([^"']*)["']/i)?.[1] ?? '';
      marks.push([m.index, `IMG ${tail(src)}${data ? ` data=${tail(data)}` : ''}${alt ? ` alt="${alt.slice(0, 60)}"` : ''}`]);
    }
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
      if (IMG_EXT.test(m[1])) marks.push([m.index, `A→IMG ${tail(m[1])}`]);
    }
    marks.sort((a, b) => a[0] - b[0]);
    for (const [at, line] of marks.slice(0, 220)) console.log(`FP-STOCKGAL: ${label} @${at} ${line}`);
    console.log(`FP-STOCKGAL: ${label} marks=${marks.length} (printed ${Math.min(220, marks.length)})`);

    // Every image-looking URL anywhere, scripts included: the "+ N more".
    const all = [
      ...new Set(
        [...html.matchAll(/https?:(?:\\?\/){2}[^\s"'<>\\]+?\.(?:jpe?g|png|webp|avif)/gi)].map((m) =>
          m[0].replace(/\\/g, '')
        )
      ),
    ];
    const drawn = new Set([...html.matchAll(/<img\b[^>]*?\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]));
    console.log(`FP-STOCKGAL: ${label} urls-anywhere=${all.length} drawn-as-img=${drawn.size}`);
    const notDrawn = all.filter((u) => !drawn.has(u));
    for (const u of notDrawn.slice(0, 40)) console.log(`FP-STOCKGAL: ${label} not-drawn ${u}`);

    // Does a thumbnail have a larger sibling?
    const sm = all.filter((u) => /_sm\.(jpe?g|png|webp)$/i.test(u));
    const lgOf = sm.filter((u) => all.includes(u.replace(/_sm\./, '_lg.')));
    console.log(`FP-STOCKGAL: ${label} sm=${sm.length} with-lg-sibling=${lgOf.length} sample=${JSON.stringify(sm.slice(0, 3))}`);
  } catch (error) {
    console.log(`FP-STOCKGAL: ${label} FAILED ${error?.message ?? error}`);
  }
}
