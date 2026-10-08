// Build-step guard for the model comparison. The work is in
// scripts/floorplan-model-compare.ts, bundled with the engine's own
// prompts and tools — what it asks is what a run asks. Bundled with
// esbuild as the connection check is (floorplan-connection-check.mjs).
// Read-only; always exits 0 so a build never fails on it.
//
// The Claude and Supabase keys are in Vercel's build and not where the
// code is written, so this runs there, on the working branch only; the
// results are read from the build log (FP-COMPARE lines).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPARE_BRANCH = 'claude/upbeat-ptolemy-2m8y40';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== COMPARE_BRANCH && process.env.FP_COMPARE !== '1') {
  console.log(`FP-COMPARE: branch ${branch ?? '(none)'} is not ${COMPARE_BRANCH}; skipping.`);
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bundle = path.join(root, 'node_modules', '.cache', 'floorplan-model-compare.cjs');
try {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(here, 'floorplan-model-compare.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    tsconfig: path.join(root, 'tsconfig.json'),
    outfile: bundle,
    logLevel: 'warning',
  });
} catch (error) {
  console.log(`FP-COMPARE: could not bundle the comparison: ${error?.message ?? error}`);
  process.exit(0);
}
const result = spawnSync(process.execPath, [bundle], { cwd: root, stdio: 'inherit', env: process.env, timeout: 15 * 60 * 1000 });
if (result.error) console.log(`FP-COMPARE: could not run the comparison: ${result.error.message}`);
else if (result.status !== 0) console.log(`FP-COMPARE: comparison exited ${result.status ?? 'null'}${result.signal ? ` (${result.signal})` : ''}; the build continues.`);
process.exit(0);
