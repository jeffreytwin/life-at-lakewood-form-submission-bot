// Round two (Jeff, 2026-09-22). Round one said both failing pages fetch
// fine and distill to almost nothing: Ryan's 204KB becomes 23.5KB of
// marketing prose, Richmond's 240KB becomes 15KB of nav chrome with not
// one dollar sign in it. The plans are drawn by the page's own scripts —
// which distillation throws away — so the engine reads a page that never
// mentions them.
//
// So: is the data in the payload, and in what shape? Ryan should carry
// "Mayport" at 324,990; Richmond should carry its 23 plans. Find them,
// print what surrounds them, and name any API the page calls.
//
// Runs as a prebuild step on Vercel, guarded to the working branch;
// results are read from the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-RYAN: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const get = async (url, headers = HEADERS) => {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  return { res, body: await res.text().catch(() => '') };
};

/** Where a needle sits in the haystack, with what surrounds it. */
function show(tag, html, needle, span = 900) {
  const at = html.indexOf(needle);
  if (at < 0) {
    console.log(`${tag}: "${needle}" NOT in the raw HTML`);
    return -1;
  }
  console.log(`${tag}: "${needle}" at ${at} >>> ${html.slice(Math.max(0, at - span / 3), at + span)}`);
  return at;
}

/** The script carriers a page might be using, and any API it names. */
function payloadShape(tag, html) {
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  const ids = [...new Set(scripts.map((s) => (s.match(/id=["']([^"']+)["']/i) ?? [])[1]).filter(Boolean))];
  const srcs = (html.match(/<script\b[^>]*src=["']([^"']+)["']/gi) ?? []).length;
  console.log(
    `${tag}: ${scripts.length} script tags (${srcs} external), ids: ${JSON.stringify(ids.slice(0, 18))}; ` +
      `__NEXT_DATA__ ${html.includes('__NEXT_DATA__')}, self.__next_f ${html.includes('self.__next_f')}, ` +
      `window.__ ${(html.match(/window\.__[A-Za-z_]+/g) ?? []).slice(0, 6).join(',') || 'none'}, ` +
      `application/ld+json ${(html.match(/application\/ld\+json/g) ?? []).length}`
  );
  const apis = [...new Set((html.match(/["'](?:https?:\/\/[^"']*)?\/(?:api|umbraco|sitecore|graphql|services)\/[^"'\s]{4,120}["']/gi) ?? []).map((s) => s.slice(1, -1)))];
  console.log(`${tag}: api-looking paths (${apis.length}): ${JSON.stringify(apis.slice(0, 14))}`);
}

// ---- Ryan Homes: Amber Creek, one quick move-in named Mayport at $324,990.
const RYAN = 'https://www.ryanhomes.com/new-homes/communities/10222120152673/florida/lakewood-ranch/amber-creek';
try {
  const { res, body } = await get(RYAN);
  console.log(`FP-RYAN: ${res.status} ${body.length} bytes`);
  payloadShape('FP-RYAN', body);
  show('FP-RYAN', body, 'Mayport');
  show('FP-RYAN', body, '324,990') < 0 && show('FP-RYAN', body, '324990');
  show('FP-RYAN', body, '1,674') < 0 && show('FP-RYAN', body, '1674');
  // The one community link round one found: a spec (quick move-in) home.
  const spec = 'https://www.ryanhomes.com/new-homes/communities/10222120152673/specs/31336/florida/lakewood-ranch/amber-creek';
  const { res: r2, body: b2 } = await get(spec);
  console.log(`FP-RYAN-SPEC: ${r2.status} ${r2.url} ${b2.length} bytes`);
  show('FP-RYAN-SPEC', b2, 'Mayport', 700);
} catch (err) {
  console.log(`FP-RYAN: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

// ---- Richmond American: 23 plans once, none now.
const RICH = 'https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/';
try {
  const { res, body } = await get(RICH);
  console.log(`FP-RICH: ${res.status} ${body.length} bytes`);
  payloadShape('FP-RICH', body);
  // A price anywhere in the payload, and the shape around it.
  const priced = body.search(/\$\s?[3-9]\d{2},\d{3}|"price"\s*:\s*\d{5,}|[3-9]\d{5}(?=[,}])/);
  console.log(
    priced >= 0
      ? `FP-RICH: first price-looking value at ${priced} >>> ${body.slice(Math.max(0, priced - 500), priced + 900)}`
      : 'FP-RICH: no price-looking value anywhere in the raw HTML'
  );
  const sq = body.search(/"squareF|"sqft|"squareFeet|sq\.? ?ft/i);
  if (sq >= 0) console.log(`FP-RICH: square feet at ${sq} >>> ${body.slice(Math.max(0, sq - 400), sq + 800)}`);
} catch (err) {
  console.log(`FP-RICH: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-RYAN: done');
process.exit(0);
