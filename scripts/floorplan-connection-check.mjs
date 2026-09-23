// Build-step guard for the connection check. The work is in
// scripts/floorplan-connection-check.ts, bundled with the engine's own
// extractors — what it prints is what a run would queue. Bundled with
// esbuild rather than run under tsx: tsx keeps function names by wrapping
// them in a helper, and a function handed to a browser page takes the
// wrapper with it and dies there ("__name is not defined").
// Read-only; always exits 0 so a build never fails on it.
//
// The builders' sites are reachable from Vercel's build and not from where
// the code is written, so this runs there, on the working branch only; the
// results are read from the build log (FP-CHECK lines). What it checks is
// scripts/floorplan-connection-check.json.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK_BRANCH = 'claude/pensive-brahmagupta-u3j8vb';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== CHECK_BRANCH && process.env.FP_CHECK !== '1') {
  console.log(`FP-CHECK: branch ${branch ?? '(none)'} is not ${CHECK_BRANCH}; skipping.`);
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Inside the project, so the bundle finds the project's own node_modules.
const bundle = path.join(root, 'node_modules', '.cache', 'floorplan-connection-check.cjs');
try {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(here, 'floorplan-connection-check.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    tsconfig: path.join(root, 'tsconfig.json'),
    outfile: bundle,
    logLevel: 'warning',
  });
} catch (error) {
  console.log(`FP-CHECK: could not bundle the check: ${error?.message ?? error}`);
  process.exit(0);
}
const result = spawnSync(process.execPath, [bundle], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FP_CHECK_CONFIG: path.join(here, 'floorplan-connection-check.json') },
  timeout: 35 * 60 * 1000,
});
if (result.error) console.log(`FP-CHECK: could not run the check: ${result.error.message}`);
else if (result.status !== 0) console.log(`FP-CHECK: check exited ${result.status ?? 'null'}${result.signal ? ` (${result.signal})` : ''}; the build continues.`);
process.exit(0);
