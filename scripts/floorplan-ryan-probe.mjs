// Round three (Jeff, 2026-09-22).
//
// Ryan: the Mayport quick move-in IS in the server-rendered HTML, inside a
// "qmi-slider" — name, price, availability, beds, baths, square feet and a
// link to its own /specs/ page. So the engine can see it; the run has been
// dying on a bad tool answer before it gets that far. Print what the
// engine's own distillation makes of that slider, to be sure.
//
// Richmond: the page carries no price anywhere in its HTML and names no
// API — 27 external scripts draw the plans at runtime. Find the endpoint
// they call by reading the site's own bundles.
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
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Ryan: what the engine actually reads where the quick move-in sits.
const RYAN = 'https://www.ryanhomes.com/new-homes/communities/10222120152673/florida/lakewood-ranch/amber-creek';
try {
  const { res, body } = await get(RYAN);
  const text = distill(body, res.url);
  const at = text.indexOf('Mayport');
  console.log(
    `FP-RYAN: ${res.status}, distilled ${text.length} chars, "Mayport" at ${at}` +
      (at < 0 ? ' — THE ENGINE CANNOT SEE IT' : '')
  );
  if (at >= 0) console.log(`FP-RYAN: engine sees >>> ${text.slice(Math.max(0, at - 700), at + 1500)}`);
  // And the plans themselves, for what the same read gives them.
  const plansAt = text.search(/Available Plans|Our Floorplans|Floorplans|Plans Available/i);
  if (plansAt >= 0) console.log(`FP-RYAN-PLANS: at ${plansAt} >>> ${text.slice(plansAt, plansAt + 1800)}`);
} catch (err) {
  console.log(`FP-RYAN: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

// ---- Richmond: which endpoint do the page's own scripts call?
const RICH = 'https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/';
try {
  const { res, body } = await get(RICH);
  const srcs = [...body.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const own = [...new Set(srcs.map((s) => {
    try {
      return new URL(s, res.url).href;
    } catch {
      return null;
    }
  }).filter((u) => u && u.includes('richmondamerican.com')))];
  console.log(`FP-RICH: ${srcs.length} scripts, ${own.length} on its own domain: ${JSON.stringify(own.slice(0, 10))}`);

  const found = new Set();
  for (const url of own.slice(0, 8)) {
    try {
      const { res: r, body: js } = await get(url);
      for (const m of js.matchAll(/["'`](\/(?:api|graphql|services|umbraco|sitecore)\/[^"'`\s?]{3,90})["'`]/gi)) found.add(m[1]);
      for (const m of js.matchAll(/["'`](https:\/\/[a-z0-9.-]*(?:richmondamerican|mdch|azurewebsites|cloudfront)[a-z0-9.-]*\/[^"'`\s]{3,90})["'`]/gi)) found.add(m[1]);
      console.log(`FP-RICH: ${url.split('/').pop()} -> ${r.status} ${js.length} bytes, running total ${found.size}`);
    } catch (err) {
      console.log(`FP-RICH: ${url} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
    }
  }
  console.log(`FP-RICH: endpoints named by the bundles (${found.size}): ${JSON.stringify([...found].slice(0, 40))}`);

  // The community's own identifier, which any such endpoint will want.
  for (const key of ['communityId', 'communityID', 'community_id', 'subdivisionId', 'planId', 'siteId', 'data-community']) {
    const at = body.indexOf(key);
    if (at >= 0) {
      console.log(`FP-RICH: "${key}" at ${at} >>> ${body.slice(at - 120, at + 260).replace(/\s+/g, ' ')}`);
      break;
    }
  }
} catch (err) {
  console.log(`FP-RICH: ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-RYAN: done');
process.exit(0);
