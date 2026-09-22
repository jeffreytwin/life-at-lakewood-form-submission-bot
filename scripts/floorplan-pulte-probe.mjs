// Pulte's North River Ranch answers with its plans spelled as text rather
// than listed — twice running, at both ceilings, so it is what that page
// draws and not an answer cut short (Jeff, 2026-09-22). Parsing the text
// back into a list is cheap and probably the whole answer, but it is only
// the answer if the page is readable at all. If it is a shell like
// Richmond's and Perry's, Pulte belongs on the browser engine instead.
//
// Runs as a prebuild step on Vercel, guarded to the working branch;
// results are read from the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-PULTE: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

/** The engine's own distillation, so the sizes and the text are the real ones. */
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

const URL_ = 'https://www.pulte.com/homes/florida/sarasota/parrish/longmeadow-at-north-river-ranch-211403';

try {
  const res = await fetch(URL_, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  const html = await res.text().catch(() => '');
  const text = distill(html, res.url);
  const cut = text.slice(0, 90_000);
  console.log(
    `FP-PULTE: ${res.status} ${html.length} bytes -> distilled ${text.length} chars ` +
      `(engine sends ${Math.min(text.length, 90_000)}${text.length > 90_000 ? ', TRUNCATED' : ''}); ` +
      `prices x${(cut.match(/\$\s?\d{1,3},\d{3}/g) ?? []).length}, ` +
      `sqft x${(cut.match(/[\d,]+\s*sq\.? ?ft/gi) ?? []).length}, ` +
      `beds x${(cut.match(/\b\d\s*(?:bd|beds?)\b/gi) ?? []).length}, ` +
      `IMG x${(cut.match(/\[IMG /g) ?? []).length}, LINK x${(cut.match(/\[LINK /g) ?? []).length}`
  );

  // Where the plans would be: the first price, and what surrounds it.
  const at = cut.search(/\$\s?\d{1,3},\d{3}/);
  console.log(
    at >= 0
      ? `FP-PULTE: around the first price >>> ${cut.slice(Math.max(0, at - 700), at + 1800)}`
      : 'FP-PULTE: no price anywhere in what the engine reads'
  );
  // And the head, to see whether this is a page or a shell.
  console.log(`FP-PULTE: head >>> ${cut.slice(0, 1200)}`);
} catch (err) {
  console.log(`FP-PULTE: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-PULTE: done');
process.exit(0);
