// Stock's quick move-ins live on their own page, away from the floor plans
// the connection is pointed at, so the engine has never seen them (Jeff,
// 2026-09-22). Report what that page carries — how each home is named and
// priced, where its own page sits, and whether it says which plan it is
// built from, which is what ties it to one. Guarded to the working branch;
// always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-STOCKINV: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html',
};

const INVENTORY = 'https://www.stockdevelopment.com/projects/wild-blue-at-waterside/inventory/';

const squash = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The same distillation the fetch_claude engine feeds Claude. */
function distill(html, baseUrl) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<img\b[^>]*?src=["']([^"']+)["'][^>]*>/gi, (_, src) => ` [IMG ${abs(src)}] `)
    .replace(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>/gi, (_, href) => ` [LINK ${abs(href)}] `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

try {
  const res = await fetch(INVENTORY, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const html = await res.text().catch(() => '');
  const text = distill(html, res.url);
  console.log(`FP-STOCKINV: ${res.status} ${res.url} html=${html.length}b distilled=${text.length} chars`);

  // Where each home's own page sits.
  const links = [...new Set([...html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["']/gi)]
    .map((m) => { try { return new URL(m[1], res.url).href; } catch { return ''; } })
    .filter((u) => /\/projects\/wild-blue-at-waterside\//.test(u) && u !== res.url))];
  console.log(`FP-STOCKINV: community-links=${links.length}`);
  for (const u of links.slice(0, 24)) console.log(`FP-STOCKINV: link ${u}`);

  // Headings and the price-looking text beside them, in page order.
  const marks = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]{0,200}?)<\/h\1>/gi)) marks.push([m.index, `H${m[1]} ${squash(m[2]).slice(0, 70)}`]);
  for (const m of html.matchAll(/\$\s?\d[\d,]{4,}/g)) marks.push([m.index, `$ ${m[0]}`]);
  marks.sort((a, b) => a[0] - b[0]);
  const lines = marks.map(([o, t]) => `@${o} ${t}`);
  for (let i = 0; i < lines.length && i < 150; i += 6) console.log(`FP-STOCKINV: | ${lines.slice(i, i + 6).join(' | ')}`);
  console.log(`FP-STOCKINV: marks=${marks.length}`);

  // Does a home say which plan it is built from?
  for (const m of [...html.matchAll(/(floor ?plan|model|plan:|built on|the .{3,20} plan)/gi)].slice(0, 4)) {
    console.log(`FP-STOCKINV: near-plan ${JSON.stringify(squash(html.slice(Math.max(0, m.index - 250), m.index + 250)))}`);
  }

  // The distilled text Claude would be handed, from the first price on.
  const start = Math.max(0, text.search(/\$\s?\d[\d,]{4,}/) - 700);
  for (let i = 0; i < 4; i++) {
    const slice = text.slice(start + i * 1500, start + (i + 1) * 1500);
    if (slice) console.log(`FP-STOCKINV: TEXT[${i}] ${JSON.stringify(slice)}`);
  }
} catch (error) {
  console.log(`FP-STOCKINV: FAILED ${error?.message ?? error}`);
}
