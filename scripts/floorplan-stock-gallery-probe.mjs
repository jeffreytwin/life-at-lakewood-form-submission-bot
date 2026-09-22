// Stock gallery probe, fourth pass: checks the harvest against the live
// pages before it ships. Runs the same rule the engine now runs — follow
// the run of picture URLs that opens with the gallery's first drawn
// thumbnail, stopping at anything the page draws elsewhere — and reports
// how many pictures each plan's first gallery yields. Also asks the media
// store whether a "_lg" copy of a gallery thumbnail exists, since a
// gallery of thumbnails would be worse than five good pictures.
// Guarded to the working branch; always exits 0.

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
  ['gardenia-ii', 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/floorplans/311/'],
];

const PICTURE_URL = /https?:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+?\.(?:jpe?g|png|webp|avif|gif)(?![a-z0-9])/gi;
/** One picture, whatever size the store lists it at. */
const key = (src) => src.replace(/_(?:sm|md|lg)(\.[a-z0-9]+)$/i, '$1');
/** The largest size the page names for a picture, as the engine takes it. */
const largest = (src, html) => {
  const m = src.match(/^(.+)_(?:sm|md|lg)(\.[a-z0-9]+)$/i);
  if (!m) return src;
  for (const size of ['lg', 'md', 'sm']) {
    const found = new RegExp(`${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${size}\\.[a-z0-9]+`, 'i').exec(html)?.[0];
    if (found) return found;
  }
  return src;
};
const GALLERY_HEADING = /\b(galler(?:y|ies)|photos?|images)\b/i;
const TOUR_HEADING = /\b(virtual tours?|tours?|3-?d|walk-?throughs?|videos?|matterport)\b/i;
const readable = (h) => h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The page's sections, exactly as plan-page.ts builds them. */
function sectionsOf(html, baseUrl) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  const marks = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) marks.push({ at: m.index, heading: { level: +m[1], text: readable(m[2]) } });
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = m[0].match(/\ssrc=["']([^"']*)["']/i)?.[1] || m[0].match(/\sdata-src=["']([^"']*)["']/i)?.[1];
    if (src && !src.startsWith('data:')) marks.push({ at: m.index, image: abs(src) });
  }
  marks.sort((a, b) => a.at - b.at);
  const sections = [{ heading: '', level: 0, ancestors: [], images: [] }];
  const open = [];
  for (const mark of marks) {
    if (mark.heading) {
      while (open.length && open[open.length - 1].level >= mark.heading.level) open.pop();
      sections.push({ heading: mark.heading.text, level: mark.heading.level, ancestors: open.map((h) => h.text), images: [] });
      open.push(mark.heading);
    } else sections[sections.length - 1].images.push(mark.image);
  }
  return sections;
}

for (const [label, url] of PLANS) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await res.text().catch(() => '');
    const sections = sectionsOf(html, res.url);
    const names = (s) => [s.heading, ...s.ancestors];
    const galleries = sections.filter((s) => s.images.length && names(s).some((h) => GALLERY_HEADING.test(h)) && !names(s).some((h) => TOUR_HEADING.test(h)));
    const drawn = galleries[0]?.images ?? [];
    const mine = new Set(drawn.map(key));
    const elsewhere = new Set(sections.flatMap((s) => s.images).map(key).filter((k) => !mine.has(k)));

    let harvested = drawn;
    if (drawn.length) {
      const anchor = drawn[0];
      const origin = new URL(anchor).origin;
      const urls = [...html.matchAll(PICTURE_URL)].map((m) => m[0].replace(/\\/g, ''));
      let longest = [];
      for (let start = 0; start < urls.length; start++) {
        if (key(urls[start]) !== key(anchor)) continue;
        const run = [];
        const seen = new Set();
        for (let i = start; i < urls.length; i++) {
          const u = urls[i];
          const k = key(u);
          if (!u.startsWith(origin) || elsewhere.has(k)) break;
          if (!seen.has(k)) { seen.add(k); run.push(u); }
        }
        if (run.length > longest.length) longest = run;
      }
      if (longest.length > drawn.length) harvested = longest;
    }
    console.log(`FP-STOCKGAL: ${label} galleries=${galleries.length} first-drawn=${drawn.length} first-harvested=${harvested.length} title="${galleries[0]?.heading ?? '-'}"`);
    const sized = harvested.map((u) => largest(u, html));
    console.log(`FP-STOCKGAL: ${label} as-imported=${new Set(sized).size} sizes=${JSON.stringify([...new Set(sized.map((u) => u.match(/_(sm|md|lg)\./i)?.[1] ?? 'none'))])}`);
    console.log(`FP-STOCKGAL: ${label} head=${JSON.stringify(sized.slice(0, 2).map((u) => u.split('/').pop()))} tail=${JSON.stringify(sized.slice(-2).map((u) => u.split('/').pop()))}`);

    // Is there a full-size copy of a gallery thumbnail?
    const thumb = harvested.find((u) => /_sm\.[a-z]+$/i.test(u));
    if (thumb) {
      for (const candidate of [thumb, thumb.replace(/_sm\./i, '_lg.')]) {
        try {
          const r = await fetch(candidate, { method: 'GET', headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(15_000) });
          console.log(`FP-STOCKGAL: ${label} ${r.status} ${r.headers.get('content-length') ?? '?'}b type=${r.headers.get('content-type') ?? '?'} ${candidate.split('/').pop()}`);
        } catch (e) {
          console.log(`FP-STOCKGAL: ${label} FETCH-FAILED ${candidate.split('/').pop()} ${e?.message ?? e}`);
        }
      }
    }
  } catch (error) {
    console.log(`FP-STOCKGAL: ${label} FAILED ${error?.message ?? error}`);
  }
}
