// Build-step guard for the Life At Lakewood onboarding probe. The work is in
// scripts/listings-lakewood-probe.ts, run under tsx so it uses the engine's
// own Wix client, its own MLSGrid client and its own classifier -- what it
// prints is what the engine would do. Read-only; always exits 0 so a build
// never fails on it.
//
// Vercel is the only environment that holds WIX_API_KEY and MLSGRID_API_KEY,
// so this runs there: set LS_LAKEWOOD_PROBE=1 and deploy the branch. It is
// off by default, and every build that does not set it says so in one line.
//
// It takes longer than the Wellen Park probe and that is deliberate. Section
// 5 pages every Active listing in the MLS -- about 111,000 records at 200 a
// page, spaced at MLSGrid's documented 2 requests/s -- to find out what the
// site's six unanchored terms would sweep in across Lakewood Ranch,
// Bradenton and Sarasota. Budget fifteen minutes; the timeout below is
// twenty, well inside a Vercel build. LS_LAKEWOOD_MAX_PAGES caps the scan
// for a quick smoke test, and the probe says so in its output when it does.
//
// Env: WIX_API_KEY (required), MLSGRID_API_KEY (required for the market
// test; without it the probe still does the Wix half), and optionally
// LS_LAKEWOOD_SITE_ID, LS_LAKEWOOD_DOMAIN, LS_LAKEWOOD_LIVE_COLLECTION,
// LS_LAKEWOOD_SHADOW_COLLECTION, LS_LAKEWOOD_VILLAGES_COLLECTION,
// LS_LAKEWOOD_MEDIA_FOLDER, LS_LAKEWOOD_MARKET_CITIES, LS_LAKEWOOD_MAX_PAGES
// -- the defaults are the values in supabase/migrations/057_lakewood_site.sql.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The probe ran on 2026-09-18 and its findings are in migration 062; the
// branch trigger that made it run is gone again, because a build that pays
// eight minutes for an answer already had is pure cost. Set
// LS_LAKEWOOD_PROBE=1, or re-add a branch check the way
// listings-engine-phase2.mjs does, to run it again.
if (process.env.LS_LAKEWOOD_PROBE !== '1') {
  console.log(`LWR: LS_LAKEWOOD_PROBE is not set; skipping (branch ${process.env.VERCEL_GIT_COMMIT_REF ?? '(none)'}).`);
  process.exit(0);
}
if (!process.env.WIX_API_KEY) {
  console.log('LWR: missing WIX_API_KEY; skipping.');
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(cli)) {
  console.log('LWR: tsx is not installed; skipping.');
  process.exit(0);
}
const result = spawnSync(process.execPath, [cli, path.join(here, 'listings-lakewood-probe.ts')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  timeout: 20 * 60 * 1000,
});
if (result.error) console.log(`LWR: could not run the probe: ${result.error.message}`);
else if (result.status !== 0) console.log(`LWR: probe exited ${result.status ?? 'null'}${result.signal ? ` (${result.signal})` : ''}; the build continues.`);
process.exit(0);
