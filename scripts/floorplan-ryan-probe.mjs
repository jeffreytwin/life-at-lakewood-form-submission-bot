// Round four (Jeff, 2026-09-22) — Richmond American only; Ryan is settled.
//
// Ryan's quick move-in reads perfectly once the engine gets that far:
// "1 Quick Move-In Home Available [LINK .../specs/31336/...] Mayport
// $324,990 Available in October 2026 3 Bed 1,674 Sq.Ft." The run was
// dying on a bad tool answer before reaching it, which is fixed.
//
// Richmond is a Blazor app (_content/Blazored.Typeahead, Radzen.Blazor,
// BlazorGoogleMaps) whose HTML carries no price at all and whose own
// bundles name no endpoint — the plans arrive over Blazor's own wire.
// Last look before calling it unreadable without a browser: is there a
// JSON surface anywhere, and does the site publish plan pages of its own?
//
// Runs as a prebuild step on Vercel, guarded to the working branch;
// results are read from the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-RICH: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const get = async (url) => {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  return { res, body: await res.text().catch(() => '') };
};

const ROOT = 'https://www.richmondamerican.com';
const COMMUNITY = `${ROOT}/florida/tampa-new-homes/parrish/estates-at-rivers-edge/`;

// 1. Which Blazor is it, and does the page prerender anything on the server?
for (const path of ['_framework/blazor.boot.json', '_framework/blazor.server.js', '_framework/blazor.web.js']) {
  try {
    const { res, body } = await get(`${COMMUNITY}${path}`);
    console.log(`FP-RICH: ${path} -> ${res.status} (${body.length} bytes) ${res.ok ? body.slice(0, 200).replace(/\s+/g, ' ') : ''}`);
  } catch (err) {
    console.log(`FP-RICH: ${path} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
  }
}

// 2. A JSON surface, if the site has one at all.
const GUESSES = [
  `${ROOT}/api/communities/search?state=FL`,
  `${ROOT}/api/search/homes?market=tampa`,
  `${ROOT}/api/plans?community=estates-at-rivers-edge`,
  `${ROOT}/umbraco/api/community/getplans?community=estates-at-rivers-edge`,
  `${COMMUNITY}api/plans`,
  `${ROOT}/sitemap.xml`,
  `${ROOT}/robots.txt`,
];
for (const url of GUESSES) {
  try {
    const { res, body } = await get(url);
    const kind = (res.headers.get('content-type') ?? '').split(';')[0];
    console.log(
      `FP-RICH: ${url.slice(ROOT.length)} -> ${res.status} ${kind} (${body.length} bytes) ${body.slice(0, 220).replace(/\s+/g, ' ')}`
    );
  } catch (err) {
    console.log(`FP-RICH: ${url.slice(ROOT.length)} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
  }
}

// 3. Does the site publish a page per plan under this community? A plan
//    page that renders on the server is something the engine could read.
try {
  const { res, body } = await get(COMMUNITY);
  const hrefs = [...new Set([...body.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]))];
  const under = hrefs.filter((h) => /estates-at-rivers-edge\/[a-z0-9-]{2,}/i.test(h));
  console.log(`FP-RICH: ${hrefs.length} hrefs, ${under.length} under the community: ${JSON.stringify(under.slice(0, 20))}`);
  const first = under.find((h) => !/\.(js|css|png|jpe?g|svg|webp|ico)$/i.test(h) && !/_content|_framework|\/js\//.test(h));
  if (first) {
    const url = new URL(first, COMMUNITY).href;
    const { res: r, body: b } = await get(url);
    const priced = b.search(/\$\s?[1-9]\d{2},\d{3}/);
    console.log(
      `FP-RICH-PLAN: ${url} -> ${r.status} (${b.length} bytes), price at ${priced}` +
        (priced >= 0 ? ` >>> ${b.slice(Math.max(0, priced - 300), priced + 500).replace(/\s+/g, ' ')}` : ' — nothing rendered here either')
    );
  }
} catch (err) {
  console.log(`FP-RICH: links -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)}`);
}

console.log('FP-RICH: done');
process.exit(0);
