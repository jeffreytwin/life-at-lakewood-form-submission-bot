// Two failing connections, both on the generic Claude engine (Jeff,
// 2026-09-22). Ryan Homes probe: the Amber Creek connection errors mid-extraction
// ("(input.plans ?? []).filter is not a function") and has never brought
// back the one quick move-in the page advertises (Jeff, 2026-09-22).
//
// Two things to learn. How big the distilled page is, and how much of it
// is picture markers — a page that fills the model's answer before it
// reaches the end would explain both the broken tool call and a quick
// move-in that is listed last going missing. And where the quick move-in
// actually lives: a section of the community page, or a page of its own.
//
// Runs as a prebuild step on Vercel, guarded to the working branch;
// results are read from the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-RYAN: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const COMMUNITY =
  'https://www.ryanhomes.com/new-homes/communities/10222120152673/florida/lakewood-ranch/amber-creek';

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

/** The same distillation the engine feeds Claude, so the sizes are the real ones. */
function distill(html, baseUrl) {
  const abs = (u) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  const withImgs = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<img\b[^>]*?src=["']([^"']+)["'][^>]*>/gi, (_, src) => ` [IMG ${abs(src)}] `)
    .replace(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>/gi, (_, href) => ` [LINK ${abs(href)}] `);
  return withImgs
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const get = async (url) => {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  return { res, html: await res.text().catch(() => '') };
};

try {
  const { res, html } = await get(COMMUNITY);
  console.log(`FP-RYAN: community -> ${res.status} ${res.url} (${html.length} bytes)`);
  if (res.ok) {
    const full = distill(html, res.url);
    const imgs = full.match(/\[IMG [^\]]+\]/g) ?? [];
    const links = full.match(/\[LINK [^\]]+\]/g) ?? [];
    const cut = full.slice(0, 90_000);
    console.log(
      `FP-RYAN: distilled ${full.length} chars, ${imgs.length} IMG, ${links.length} LINK; ` +
        `the engine sends the first 90000 (${full.length > 90_000 ? 'TRUNCATED' : 'whole page'}), ` +
        `markers in that slice: ${(cut.match(/\[IMG /g) ?? []).length} IMG / ${(cut.match(/\[LINK /g) ?? []).length} LINK`
    );

    // Where the quick move-in sits, and whether the engine's 90k slice reaches it.
    const at = full.search(/quick move[- ]in/i);
    console.log(
      `FP-RYAN: "quick move-in" first at char ${at} of ${full.length}` +
        (at >= 0 ? ` (${at < 90_000 ? 'inside' : 'BEYOND'} the slice)` : '')
    );
    if (at >= 0) {
      console.log(`FP-RYAN: around it >>> ${full.slice(Math.max(0, at - 300), at + 1400)}`);
    }

    // How the plans themselves are shaped, for comparison.
    const plansAt = full.search(/floor ?plans?/i);
    if (plansAt >= 0) {
      console.log(`FP-RYAN: plans at char ${plansAt} >>> ${full.slice(plansAt, plansAt + 1400)}`);
    }

    // Community-level pages the site links to: anything that smells like inventory.
    const hrefs = [...new Set(links.map((l) => l.slice(6, -1)))];
    const inventory = hrefs.filter((h) => /quick-move|inventory|move-in|available-homes|homes-for-sale/i.test(h));
    console.log(`FP-RYAN: ${hrefs.length} distinct links; inventory-looking: ${JSON.stringify(inventory.slice(0, 12))}`);
    const amber = hrefs.filter((h) => /amber-creek/i.test(h));
    console.log(`FP-RYAN: amber-creek links: ${JSON.stringify(amber.slice(0, 20))}`);
  }
} catch (err) {
  console.log(`FP-RYAN: community -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

// The obvious guesses for a page of its own, in case the section above is only a teaser.
for (const url of [
  `${COMMUNITY}/quick-move-in-homes`,
  `${COMMUNITY}/quick-move-ins`,
  `${COMMUNITY}/available-homes`,
  `${COMMUNITY}/homes`,
]) {
  try {
    const { res, html } = await get(url);
    const text = res.ok ? distill(html, res.url) : '';
    console.log(
      `FP-RYAN: guess ${url.slice(COMMUNITY.length)} -> ${res.status} ${res.url} (${html.length} bytes` +
        (res.ok ? `, ${text.length} distilled, quick-move-in at ${text.search(/quick move[- ]in/i)}` : '') +
        ')'
    );
  } catch (err) {
    console.log(`FP-RYAN: guess ${url.slice(COMMUNITY.length)} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
  }
}

// Richmond American: the connection came back with no plans at all three
// runs running, though it found 23 once and the page looks right in a
// browser — it just takes a moment to fill in. Is what a fetch gets the
// page, a shell waiting on its scripts, or a challenge?
const RICHMOND = 'https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/';
try {
  const { res, html } = await get(RICHMOND);
  console.log(`FP-RICH: community -> ${res.status} ${res.url} (${html.length} bytes)`);
  const text = distill(html, res.url);
  const imgs = (text.match(/\[IMG /g) ?? []).length;
  console.log(
    `FP-RICH: distilled ${text.length} chars, ${imgs} IMG; ` +
      `"$" x${(text.match(/\$[0-9]/g) ?? []).length}, ` +
      `"sq" x${(text.match(/sq\.? ?ft/gi) ?? []).length}, ` +
      `"bed" x${(text.match(/\bbeds?\b/gi) ?? []).length}, ` +
      `plan-at ${text.search(/floor ?plans?/i)}`
  );
  console.log(`FP-RICH: head >>> ${text.slice(0, 1600)}`);
  const plansAt = text.search(/floor ?plans?/i);
  if (plansAt >= 0) console.log(`FP-RICH: plans >>> ${text.slice(plansAt, plansAt + 1600)}`);
} catch (err) {
  console.log(`FP-RICH: community -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-RYAN: done');
process.exit(0);
