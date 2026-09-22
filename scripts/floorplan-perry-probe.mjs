// Perry, again (Jeff, 2026-09-22): "Star Farms at Lakewood Ranch 90" and
// "75" are categories with floor plans listed below them, and a plan
// marked "[MONTH] Move-in" is a quick move-in. Twice now the structure has
// been read wrong from the outside, so read the section pages as the
// engine sees them and print what is actually there.
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

/** The engine's own distillation, so what is printed is what Claude reads. */
function distill(html, baseUrl) {
  const abs = (u) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<img\b[^>]*?src=["']([^"']+)["'][^>]*>/gi, (_, src) => ` [IMG ${abs(src)}] `)
    .replace(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>/gi, (_, href) => ` [LINK ${abs(href)}] `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const ROOT = 'https://www.perryhomes.com/new-homes/florida/southwest-florida/star-farms-at-lakewood-ranch';

for (const lot of ['75', '90']) {
  const url = `${ROOT}/star-farms-at-lakewood-ranch-${lot}`;
  try {
    const { res, html } = await get(url);
    const text = distill(html, res.url);
    console.log(`FP-PERRY[${lot}]: ${res.status}, ${html.length} bytes, distilled ${text.length} chars`);

    // Where a plan list would be: the first price after the hero.
    const moveIn = [...text.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+Move-?in/gi)].map((m) => m[0]);
    console.log(`FP-PERRY[${lot}]: "[Month] Move-in" x${moveIn.length} ${JSON.stringify(moveIn.slice(0, 12))}`);

    // The body of the page, in two slices, so the plan list is visible whole.
    const start = Math.max(0, text.search(/From the \$|Sq\.? ?Ft/i) - 200);
    console.log(`FP-PERRY[${lot}]: body A >>> ${text.slice(start, start + 2600)}`);
    console.log(`FP-PERRY[${lot}]: body B >>> ${text.slice(start + 2600, start + 5200)}`);

    // Every link under this section: plan pages would live here.
    const links = [...new Set([...text.matchAll(/\[LINK ([^\]]+)\]/g)].map((m) => m[1]))].filter((h) =>
      h.includes(`star-farms-at-lakewood-ranch-${lot}/`)
    );
    console.log(`FP-PERRY[${lot}]: ${links.length} links below the section: ${JSON.stringify(links.slice(0, 25))}`);
  } catch (err) {
    console.log(`FP-PERRY[${lot}]: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
  }
}

console.log('FP-PERRY: done');
process.exit(0);
