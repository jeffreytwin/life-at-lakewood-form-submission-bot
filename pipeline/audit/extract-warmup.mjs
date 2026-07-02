// Extract Wix warmup-data CMS records from recon snapshots.
//
// Wix server-renders pages with a <script id="wix-warmup-data"> JSON blob
// containing the dataset rows bound to the page (i.e. actual Floorplans
// collection records). This walks every snapshot, pulls out record-shaped
// objects, and writes per-site extracts: field keys seen, builder values,
// and sample records — the raw material for the legacy schema field maps
// and the builder roster.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SNAP_ROOT = path.join(import.meta.dirname, 'snapshots');
const OUT = path.join(import.meta.dirname, 'extracts');
import { mkdir } from 'node:fs/promises';

function* walkObjects(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* walkObjects(item);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const v of Object.values(node)) yield* walkObjects(v);
  }
}

// A CMS record: has _id plus at least a few non-underscore data fields.
function looksLikeRecord(obj) {
  if (!obj._id || typeof obj._id !== 'string') return false;
  const dataKeys = Object.keys(obj).filter((k) => !k.startsWith('_'));
  return dataKeys.length >= 3;
}

const siteDirs = (await readdir(SNAP_ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

await mkdir(OUT, { recursive: true });

for (const site of siteDirs) {
  const dir = path.join(SNAP_ROOT, site);
  const byShape = new Map(); // sorted field-key signature -> { keys, records: Map<_id, rec>, pages }
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.html')) continue;
    const html = await readFile(path.join(dir, file), 'utf8');
    const m = html.match(
      /<script[^>]*id="wix-warmup-data"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!m) continue;
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const obj of walkObjects(data)) {
      if (!looksLikeRecord(obj)) continue;
      const keys = Object.keys(obj)
        .filter((k) => !k.startsWith('_'))
        .sort();
      const sig = keys.join(',');
      if (!byShape.has(sig)) byShape.set(sig, { keys, records: new Map(), pages: new Set() });
      const shape = byShape.get(sig);
      shape.records.set(obj._id, obj);
      shape.pages.add(file);
    }
  }

  const shapes = [...byShape.values()]
    .map((s) => ({
      recordCount: s.records.size,
      pages: [...s.pages],
      fieldKeys: s.keys,
      samples: [...s.records.values()].slice(0, 3),
      builderValues: [
        ...new Set(
          [...s.records.values()]
            .map((r) => r.builder ?? r.builderName ?? r.builders)
            .filter((v) => typeof v === 'string'),
        ),
      ].sort(),
    }))
    .filter((s) => s.recordCount >= 3)
    .sort((a, b) => b.recordCount - a.recordCount);

  await writeFile(
    path.join(OUT, `${site}.json`),
    JSON.stringify({ site, shapes: shapes.slice(0, 15) }, null, 2),
  );
  console.log(`${site}: ${shapes.length} record shapes, top: ${shapes[0]?.recordCount ?? 0} records`);
}
console.log(`Extracts written to ${OUT}`);
