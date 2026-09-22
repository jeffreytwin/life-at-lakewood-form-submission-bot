// Stock gallery probe, third pass: each gallery draws five thumbnails over
// a "+25 MORE" button, so the engine keeps five of thirty (Jeff,
// 2026-09-22). The other twenty-five are somewhere the page does not draw
// them. Report where: how the picture URLs sit around each gallery's name
// in the raw HTML, whether the "more" button links anywhere, and one window
// verbatim. Guarded to the working branch; always exits 0.

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

const URL_PAGE = 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/320/';

/** A picture in Stock's media store, bare or with the slashes a payload escapes. */
const PIC = /https?:(?:\\?\/){2}fabrik\.blob\.core\.windows\.net(?:\\?\/)public(?:\\?\/)[A-Za-z0-9-]+(?:_(?:sm|lg))?\.[a-zA-Z]{3,4}/g;

try {
  const res = await fetch(URL_PAGE, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const html = await res.text().catch(() => '');
  console.log(`FP-STOCKGAL: ${res.status} html=${html.length}b`);

  // Where each gallery is named, and where each picture sits.
  const marks = [];
  for (const name of ['Dan Rak Design', 'Clive Daniel Home', 'Beasley']) {
    for (const m of html.matchAll(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))) {
      marks.push({ at: m.index, name });
    }
  }
  const pics = [...html.matchAll(PIC)].map((m) => ({ at: m.index, url: m[0].replace(/\\/g, '') }));
  console.log(`FP-STOCKGAL: gallery-name-mentions=${marks.length} picture-mentions=${pics.length} distinct=${new Set(pics.map((p) => p.url)).size}`);
  marks.sort((a, b) => a.at - b.at);
  for (const [i, mark] of marks.entries()) {
    const end = marks[i + 1]?.at ?? html.length;
    const between = pics.filter((p) => p.at > mark.at && p.at < end);
    console.log(
      `FP-STOCKGAL: @${mark.at} "${mark.name}" -> ${between.length} pictures before the next mention (distinct ${new Set(between.map((p) => p.url)).size}); first=${between[0]?.url ?? '-'} last=${between[between.length - 1]?.url ?? '-'}`
    );
  }

  // Does the "+N MORE" button lead anywhere?
  for (const m of [...html.matchAll(/\+\s*\d+\s*(?:<[^>]*>\s*)*MORE/gi)].slice(0, 3)) {
    console.log(`FP-STOCKGAL: more-button ${JSON.stringify(html.slice(Math.max(0, m.index - 700), m.index + 300))}`);
  }
  const galleryLinks = [...new Set([...html.matchAll(/(?:href|data-[a-z-]*(?:url|href|gallery|album))=["']([^"']{4,200})["']/gi)]
    .map((m) => m[1])
    .filter((u) => /galler|album|photos|media|lightbox/i.test(u)))];
  console.log(`FP-STOCKGAL: gallery-links=${JSON.stringify(galleryLinks.slice(0, 10))}`);

  // The run of payload around the first gallery's name, verbatim.
  const first = marks[0];
  if (first) {
    const start = Math.max(0, first.at - 400);
    for (let i = 0; i < 4; i++) {
      const slice = html.slice(start + i * 1800, start + (i + 1) * 1800);
      if (slice) console.log(`FP-STOCKGAL: RAW[${i}] ${JSON.stringify(slice)}`);
    }
  }
} catch (error) {
  console.log(`FP-STOCKGAL: FAILED ${error?.message ?? error}`);
}
