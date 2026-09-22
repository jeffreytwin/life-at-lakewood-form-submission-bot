// Perry round two (Jeff, 2026-09-22).
//
// Round one found the cause: Perry is a Next.js site and its photographs
// are not in <img> tags at all. The community page draws 12 images but
// carries 65 picture URLs; a section page draws 8 and carries 78. The
// rest live in the flight payload — where, better still, each one is
// labelled: "type":["interior"], with a design_id, an elevation_id, the
// community and the section it belongs to.
//
// So: what exactly does a picture record look like, which types are used,
// and how are the plans themselves carried? That decides how to read this
// builder, and how to sort its photographs.
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

const SECTION =
  'https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch/star-farms-at-lakewood-ranch-50';

try {
  const { res, html } = await get(SECTION);
  console.log(`FP-PERRY: section -> ${res.status} (${html.length} bytes)`);

  // 1. Which labels the payload uses, and how many pictures carry each.
  const types = {};
  for (const m of html.matchAll(/\\"type\\":\\"\$([0-9a-f]+)\\"/gi)) types[m[1]] = (types[m[1]] ?? 0) + 1;
  const named = {};
  for (const m of html.matchAll(/([0-9a-f]+):\[\\"(interior|exterior|floorplan|floor_plan|elevation|amenity|aerial|video|virtual_tour|[a-z_]+)\\"\]/gi)) {
    named[m[1]] = m[2];
  }
  const tally = {};
  for (const [ref, n] of Object.entries(types)) {
    const label = named[ref] ?? `ref:${ref}`;
    tally[label] = (tally[label] ?? 0) + n;
  }
  console.log(`FP-PERRY: picture labels in the payload: ${JSON.stringify(tally)}`);

  // 2. One picture record whole, so its shape is on the record.
  const at = html.search(/\\"secure_url\\"|\\"public_id\\"|res\.cloudinary\.com/);
  if (at >= 0) console.log(`FP-PERRY: a picture record >>> ${html.slice(Math.max(0, at - 700), at + 1400)}`);

  // 3. An interior one specifically, with whatever ties it to a design.
  const interiorAt = html.search(/\[\\"interior\\"\]/i);
  if (interiorAt >= 0) console.log(`FP-PERRY: interior record >>> ${html.slice(interiorAt, interiorAt + 1600)}`);

  // 4. How the plans themselves appear, and where their pages are.
  const designs = [...new Set([...html.matchAll(/\\"design_id\\":\\"([0-9A-Z]+)\\"/gi)].map((m) => m[1]))];
  console.log(`FP-PERRY: ${designs.length} design ids on this page: ${JSON.stringify(designs.slice(0, 30))}`);
  const hrefs = [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]))].filter((h) =>
    /star-farms-at-lakewood-ranch-50\/[a-z0-9]/i.test(h)
  );
  console.log(`FP-PERRY: ${hrefs.length} links under the 50' section: ${JSON.stringify(hrefs.slice(0, 20))}`);

  // 5. A plan page, if one is linked: the same questions again.
  const plan = hrefs.find((h) => !/^\d/.test(h.split('/').pop() ?? ''));
  if (plan) {
    const url = new URL(plan, res.url).href;
    const { res: r, html: h2 } = await get(url);
    const imgs = (h2.match(/<img\b/gi) ?? []).length;
    const urls = new Set(
      [...h2.matchAll(/https?:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+?\.(?:jpe?g|png|webp|avif)(?![a-z0-9])/gi)].map((m) =>
        m[0].replace(/\\/g, '')
      )
    );
    const planTypes = {};
    for (const m of h2.matchAll(/\[\\"(interior|exterior|floorplan|elevation|aerial|amenity)\\"\]/gi)) {
      planTypes[m[1]] = (planTypes[m[1]] ?? 0) + 1;
    }
    console.log(
      `FP-PERRY-PLAN: ${url} -> ${r.status} (${h2.length} bytes), ${imgs} <img>, ${urls.size} picture URLs, labels ${JSON.stringify(planTypes)}`
    );
    const i2 = h2.search(/\[\\"interior\\"\]/i);
    if (i2 >= 0) console.log(`FP-PERRY-PLAN: interior record >>> ${h2.slice(Math.max(0, i2 - 900), i2 + 900)}`);
  }
} catch (err) {
  console.log(`FP-PERRY: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-PERRY: done');
process.exit(0);
