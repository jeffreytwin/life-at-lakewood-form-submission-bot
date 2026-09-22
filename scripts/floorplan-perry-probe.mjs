// Perry round three (Jeff, 2026-09-22) — the harvest itself.
//
// Round two read the shape. Every photograph is a Cloudinary record in the
// page's own flight payload, and its metadata says what it is:
//
//   3e:["interior"]
//   3d:{"type":"$3e","design_id":"3024F","section":"Lakewood Ranch 50'", ...}
//   3c:{"public_id":"...","secure_url":"https://res.cloudinary.com/...jpg","metadata":"$3d", ...}
//
// A page that says which of its pictures are interiors can have its
// gallery gathered and ordered without guessing. So take the harvest as
// the engine would — every secure_url in payload order, with the label
// its metadata carries — and print it, so what is written next can be
// held to it.
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

/**
 * The harvest, as the engine would take it: each picture the payload
 * carries, in the order the payload carries it, with the label its
 * metadata gives it.
 */
function harvest(html) {
  // "3e:[\"interior\"]" — a label the records point at by reference.
  const labels = {};
  for (const m of html.matchAll(/(?:^|\\n)([0-9a-f]{1,4}):\[\\"([a-z_]+)\\"\]/gi)) labels[m[1]] = m[2];
  // "3d:{...\"type\":\"$3e\"...}" — a metadata record naming a label.
  const meta = {};
  for (const m of html.matchAll(/(?:^|\\n)([0-9a-f]{1,4}):(\{\\"active[\s\S]{0,700}?\\"show_disclaimer\\":\\"[a-z]+\\"\})/gi)) {
    const type = (m[2].match(/\\"type\\":\\"\$([0-9a-f]+)\\"/i) ?? [])[1];
    const design = (m[2].match(/\\"design_id\\":\\"([^\\"]+)\\"/i) ?? [])[1];
    meta[m[1]] = { label: labels[type] ?? null, design: design ?? null };
  }
  // A picture record: its URL, and the metadata it points at.
  const out = [];
  for (const m of html.matchAll(/\\"secure_url\\":\\"(https:\\?\/\\?\/[^\\"]+?\.(?:jpe?g|png|webp|avif))\\"([\s\S]{0,400}?)\\"metadata\\":\\"\$([0-9a-f]+)\\"/gi)) {
    const url = m[1].replace(/\\\//g, '/').replace(/\\/g, '');
    const info = meta[m[3]] ?? {};
    out.push({ url, label: info.label ?? null, design: info.design ?? null });
  }
  return out;
}

const PAGES = [
  ['50', 'https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch/star-farms-at-lakewood-ranch-50'],
  ['90', 'https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch/star-farms-at-lakewood-ranch-90'],
  ['community', 'https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch'],
];

for (const [tag, url] of PAGES) {
  try {
    const { res, html } = await get(url);
    const got = harvest(html);
    const byLabel = {};
    for (const g of got) byLabel[g.label ?? 'unlabelled'] = (byLabel[g.label ?? 'unlabelled'] ?? 0) + 1;
    const drawn = [...html.matchAll(/<img\b[^>]*?src=["']([^"']+)["']/gi)].map((m) => m[1]);
    console.log(
      `FP-PERRY[${tag}]: ${res.status}, harvested ${got.length} pictures ${JSON.stringify(byLabel)}; ` +
        `designs ${JSON.stringify([...new Set(got.map((g) => g.design).filter(Boolean))])}; ` +
        `${drawn.length} drawn in <img>, of which ${drawn.filter((d) => got.some((g) => g.url === d)).length} are in the harvest`
    );
    console.log(`FP-PERRY[${tag}]: in order >>> ${JSON.stringify(got.slice(0, 26).map((g) => `${g.label ?? '?'}:${g.url.split('/').pop()}`))}`);
  } catch (err) {
    console.log(`FP-PERRY[${tag}]: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
  }
}

console.log('FP-PERRY: done');
process.exit(0);
