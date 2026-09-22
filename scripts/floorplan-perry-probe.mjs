// Perry Homes: the plans come through but their interior pictures do not,
// though they are right there on the page (Jeff, 2026-09-22).
//
// Two candidate causes, and this tells them apart. Either the pictures are
// lazy-loaded — distillation only understands <img src>, so a page that
// carries its photos in data-src or srcset shows Claude almost none — or
// the page keeps interiors in a second gallery, which firstGallery drops
// on purpose so a plan does not inherit the community's other galleries.
//
// Runs as a prebuild step on Vercel, guarded to the working branch;
// results are read from the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-PERRY: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const get = async (url) => {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  return { res, html: await res.text().catch(() => '') };
};

const attr = (tag, name) => (tag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i')) ?? [])[1] ?? '';

/** How the page carries its pictures, and how much distillation would see. */
function pictures(tag, html, baseUrl) {
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const withSrc = imgs.filter((i) => attr(i, 'src'));
  const lazyOnly = imgs.filter((i) => !attr(i, 'src') && (attr(i, 'data-src') || attr(i, 'data-lazy') || attr(i, 'srcset')));
  const srcset = imgs.filter((i) => attr(i, 'srcset')).length;
  // Every picture URL anywhere in the source, however it is carried.
  const anywhere = new Set(
    [...html.matchAll(/https?:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+?\.(?:jpe?g|png|webp|avif)(?![a-z0-9])/gi)].map((m) =>
      m[0].replace(/\\/g, '')
    )
  );
  console.log(
    `${tag}: ${imgs.length} <img> (${withSrc.length} with src, ${lazyOnly.length} lazy-only, ${srcset} with srcset); ` +
      `${anywhere.size} distinct picture URLs anywhere in the source; ` +
      `<picture> x${(html.match(/<picture[\s>]/gi) ?? []).length}, background-image x${(html.match(/background-image/gi) ?? []).length}`
  );
  if (lazyOnly.length) console.log(`${tag}: a lazy one >>> ${lazyOnly[0].slice(0, 300)}`);
  else if (withSrc.length) console.log(`${tag}: a plain one >>> ${withSrc[0].slice(0, 300)}`);
  void baseUrl;
  return anywhere;
}

/** The headings the gallery rules key on, and where the pictures sit between them. */
function headings(tag, html) {
  const marks = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    marks.push({ at: m.index ?? 0, text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) });
  }
  const pics = [...html.matchAll(/https?:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+?\.(?:jpe?g|png|webp|avif)(?![a-z0-9])/gi)].map(
    (m) => m.index ?? 0
  );
  const lines = marks.map((h, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : Infinity;
    const n = pics.filter((p) => p >= h.at && p < end).length;
    return `${n}×"${h.text}"`;
  });
  console.log(`${tag}: ${marks.length} headings, pictures under each: ${lines.join(' | ').slice(0, 1500)}`);
}

const COMMUNITY = 'https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch';

try {
  const { res, html } = await get(COMMUNITY);
  console.log(`FP-PERRY: community -> ${res.status} ${res.url} (${html.length} bytes)`);
  pictures('FP-PERRY', html, res.url);
  headings('FP-PERRY', html);

  const hrefs = [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]))]
    .map((h) => {
      try {
        return new URL(h, res.url).href;
      } catch {
        return null;
      }
    })
    .filter((h) => h && h.includes('/star-farms-at-lakewood-ranch'));
  console.log(`FP-PERRY: ${hrefs.length} links under this community: ${JSON.stringify(hrefs.slice(0, 18))}`);

  // A plan page: the deepest link that is not an address (addresses are homes).
  const plan = hrefs.find((h) => /\/(?:design|plan)[-/]/i.test(h)) ?? hrefs.filter((h) => !/\/\d+-/.test(h)).pop();
  if (plan) {
    const { res: r, html: h2 } = await get(plan);
    console.log(`FP-PERRY-PLAN: ${plan} -> ${r.status} (${h2.length} bytes)`);
    pictures('FP-PERRY-PLAN', h2, r.url);
    headings('FP-PERRY-PLAN', h2);
    const at = h2.search(/interior/i);
    if (at >= 0) console.log(`FP-PERRY-PLAN: "interior" at ${at} >>> ${h2.slice(at - 200, at + 500).replace(/\s+/g, ' ')}`);
  }
} catch (err) {
  console.log(`FP-PERRY: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-PERRY: done');
process.exit(0);
