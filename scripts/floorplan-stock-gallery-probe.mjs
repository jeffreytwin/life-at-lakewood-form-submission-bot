// Stock Luxury Homes gallery probe, second pass. The first pass showed the
// page's shape: an <h2>Elevations</h2> grid, an <h2>Virtual Tours</h2> grid
// (whose thumbnails the engine was mistaking for photos), then
// <h2>Galleries</h2> with an <h4> per gallery. This pass prints the raw
// markup of the Galleries section so the first gallery's end can be found
// exactly. Guarded to the working branch; always exits 0.

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

for (const [label, url] of PLANS) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await res.text().catch(() => '');

    // Headings and images from the Galleries heading on, one compact line each.
    const at = html.search(/<h2\b[^>]*>\s*Galleries\s*<\/h2>/i);
    console.log(`FP-STOCKGAL: ${label} ${res.status} html=${html.length}b galleries-at=${at}`);
    if (at < 0) continue;

    const section = html.slice(at);
    const marks = [];
    for (const m of section.matchAll(/<h([1-6])\b[^>]*>([\s\S]{0,200}?)<\/h\1>/gi)) {
      marks.push([m.index, `H${m[1]} ${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`]);
    }
    for (const m of section.matchAll(/<img\b[^>]*>/gi)) {
      const src = m[0].match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? '';
      const alt = m[0].match(/\salt=["']([^"']*)["']/i)?.[1] ?? '';
      marks.push([m.index, `IMG ${src.split('/').pop()} alt="${alt.slice(0, 50)}"`]);
    }
    for (const m of section.matchAll(/(\+\s*\d+\s*more|View (?:all|Gallery)|data-gallery[^=]*=["'][^"']{0,80}["'])/gi)) {
      marks.push([m.index, `CUE ${m[0].slice(0, 90)}`]);
    }
    marks.sort((a, b) => a[0] - b[0]);
    // Long lines survive log collection better than many short ones.
    const lines = marks.map(([o, t]) => `@${o} ${t}`);
    for (let i = 0; i < lines.length && i < 240; i += 8) {
      console.log(`FP-STOCKGAL: ${label} | ${lines.slice(i, i + 8).join(' | ')}`);
    }
    console.log(`FP-STOCKGAL: ${label} marks=${marks.length}`);

    // The raw markup of the first gallery's opening, verbatim.
    console.log(`FP-STOCKGAL: ${label} RAW ${JSON.stringify(section.slice(0, 2600))}`);
  } catch (error) {
    console.log(`FP-STOCKGAL: ${label} FAILED ${error?.message ?? error}`);
  }
}
