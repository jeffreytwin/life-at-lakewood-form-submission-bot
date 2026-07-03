// Egress probe: do the builders that block GitHub-runner IPs (ICI Homes,
// Neal Signature — 403 even to real Chrome) and the API that hangs
// non-browser TLS (M/I Homes SSC Search) behave differently from Vercel's
// egress? Runs as a prebuild step on Vercel, guarded to the working
// branch; results are read from the build logs. Always exits 0.

const PROBE_BRANCH = 'claude/wix-floor-plan-automation-sbqc80-hyk0qe';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-EGRESS: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const TARGETS = [
  ['ici-home', 'https://www.icihomes.com/'],
  ['neal-signature-home', 'https://www.nealsignaturehomes.com/'],
  ['neal-signature-robots', 'https://www.nealsignaturehomes.com/robots.txt'],
  ['mihomes-ssc-plans', 'https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=plans&typeahead_type=markets'],
  ['mihomes-ssc-inventory', 'https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api/Search?search=Sarasota%20Metro&searchtype=inventory&typeahead_type=markets'],
];

for (const [slug, url] of TARGETS) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text().catch(() => '');
    console.log(
      `FP-EGRESS: ${slug} -> ${res.status} (${text.length} bytes, ${Date.now() - started}ms)${
        res.status !== 200 ? ` head=${JSON.stringify(text.slice(0, 120))}` : ''
      }`
    );
  } catch (err) {
    console.log(`FP-EGRESS: ${slug} -> ERROR ${String(err?.cause?.message ?? err?.message ?? err)} (${Date.now() - started}ms)`);
  }
}
console.log('FP-EGRESS: done');
process.exit(0);
