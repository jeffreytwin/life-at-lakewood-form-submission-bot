// Phase 2: run the listings engine core against Longboat Key's shadow
// collection from a Vercel build (the environment that holds WIX_API_KEY and
// the Supabase service key), guarded to the engine branch; LS_PHASE2_RUN=1
// runs it anywhere. The work is in scripts/listings-engine-phase2.ts, run
// under tsx so it uses the engine's own modules. Always exits 0.
//
// Env: WIX_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (required; skipped without them), MLSGRID_API_KEY (the MLSGrid pulls are
// skipped without it), LS_PHASE2_SITE_DOMAIN (default lifeinlongboatkey.com),
// LS_PHASE2_MAX_PAGES (incremental page cap, default 10),
// LS_PHASE2_RUN_BUDGET_MS (per run, default 200000),
// LS_PHASE2_RESET_SHADOW=1 (empty the shadow collection first; refused when
// the site's target is its live collection).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_BRANCH = 'claude/listings-engine-phase1-longboat-tzysk9';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (process.env.LS_PHASE2_RUN !== '1' && branch !== ENGINE_BRANCH) {
  console.log(`LS2: branch ${branch ?? '(none)'} is not ${ENGINE_BRANCH} and LS_PHASE2_RUN is not set; skipping.`);
  process.exit(0);
}
if (!process.env.WIX_API_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('LS2: WIX_API_KEY or the Supabase env is missing; skipping.');
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(cli)) {
  console.log('LS2: tsx is not installed; skipping.');
  process.exit(0);
}
const script = path.join(here, 'listings-engine-phase2.ts');
const result = spawnSync(process.execPath, [cli, script], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  timeout: 12 * 60 * 1000,
});
if (result.error) console.log(`LS2: could not run the script: ${result.error.message}`);
else if (result.status !== 0) console.log(`LS2: script exited ${result.status ?? 'null'}${result.signal ? ` (${result.signal})` : ''}; the build continues.`);
process.exit(0);
