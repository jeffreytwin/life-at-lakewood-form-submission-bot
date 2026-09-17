// Build-step guard for the Life in Wellen Park onboarding probe. The work is
// in scripts/listings-wellen-probe.ts, run under tsx so it uses the engine's
// own Wix client and its own term derivation -- what it prints is what the
// village import would write. Read-only; always exits 0 so a build never
// fails on it.
//
// Vercel is the only environment that holds WIX_API_KEY, so this runs there:
// set LS_WELLEN_PROBE=1 and deploy the branch. It is off by default, and
// every build that does not set it says so in one line.
//
// Env: WIX_API_KEY (required), and optionally LS_WELLEN_SITE_ID,
// LS_WELLEN_DOMAIN, LS_WELLEN_LIVE_COLLECTION, LS_WELLEN_SHADOW_COLLECTION,
// LS_WELLEN_VILLAGES_COLLECTION, LS_WELLEN_MEDIA_FOLDER -- the defaults are
// the values in supabase/migrations/051_wellen_park_site.sql, so overriding
// them points the probe at another site being onboarded the same way.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.LS_WELLEN_PROBE !== '1') {
  console.log(`WP: LS_WELLEN_PROBE is not set; skipping (branch ${process.env.VERCEL_GIT_COMMIT_REF ?? '(none)'}).`);
  process.exit(0);
}
if (!process.env.WIX_API_KEY) {
  console.log('WP: missing WIX_API_KEY; skipping.');
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(cli)) {
  console.log('WP: tsx is not installed; skipping.');
  process.exit(0);
}
const result = spawnSync(process.execPath, [cli, path.join(here, 'listings-wellen-probe.ts')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  timeout: 8 * 60 * 1000,
});
if (result.error) console.log(`WP: could not run the probe: ${result.error.message}`);
else if (result.status !== 0) console.log(`WP: probe exited ${result.status ?? 'null'}${result.signal ? ` (${result.signal})` : ''}; the build continues.`);
process.exit(0);
