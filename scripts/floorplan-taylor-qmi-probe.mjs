// Taylor Morrison quick move-in probe: does a home's own page carry a
// gallery the way a base plan's does?
//
// A quick move-in is queued with exactly one picture — whichever of the
// base plan's pictures Taylor put on the available-homes card, which is a
// kitchen or a living room as often as the house — because the extractor
// skipped the page read for quick move-ins. Reading their pages is only
// worth it if the pages hold what a base plan's gallery page holds, so
// this reports what scDataStore.data offers on three Ibis homes at
// Esplanade at Wellen Park: the categories, their sizes, and whether any
// of them is an Exterior. Guarded to the working branch; always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-TMQMI: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html',
};

const BASE = 'https://www.taylormorrison.com/fl/sarasota/englewood/esplanade-at-wellen-park/floor-plans/ibis';
const HOMES = [
  ['qmi-13300', `${BASE}/home-available-now-at-13300-santini-circle`],
  ['qmi-13304', `${BASE}/home-available-now-at-13304-santini-circle`],
  ['qmi-13312', `${BASE}/home-available-now-at-13312-santini-circle`],
  // The base plan's own gallery page, for comparison.
  ['base-ibis-gallery', `${BASE}/gallery`],
];

/** The same slice the extractor takes (taylor-morrison.ts, extractJsonAfter). */
function extractJsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

/** What galleryFromScData would find: the first entry holding categories. */
function categoriesOf(scData) {
  for (const entry of Object.values(scData ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    const cats = Array.isArray(entry.imagesByCategory) && entry.imagesByCategory.length
      ? entry.imagesByCategory
      : Array.isArray(entry.photos) && entry.photos.length
        ? [{ title: '(photos)', images: entry.photos }]
        : [];
    if (cats.length) return cats;
  }
  return null;
}

for (const [label, url] of HOMES) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await res.text().catch(() => '');
    const raw = extractJsonAfter(html, 'scDataStore.data =') ?? extractJsonAfter(html, 'scDataStore.data=');
    const scData = raw ? JSON.parse(raw) : null;
    const cats = scData ? categoriesOf(scData) : null;
    console.log(
      `FP-TMQMI: ${label} -> ${res.status} (${html.length} bytes, scData=${Boolean(scData)}, categories=${cats ? cats.length : 0}, ${Date.now() - started}ms)`
    );
    for (const c of cats ?? []) {
      const images = (c.images ?? []).filter((im) => im && !im.isTour);
      const first = images.slice(0, 2).map((im) => (im.image?.src ?? '').slice(-70));
      console.log(`FP-TMQMI: ${label} category=${JSON.stringify((c.title ?? '').trim())} images=${images.length} first=${JSON.stringify(first)}`);
    }
  } catch (err) {
    console.log(`FP-TMQMI: ${label} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)} (${Date.now() - started}ms)`);
  }
}
console.log('FP-TMQMI: done');
process.exit(0);
