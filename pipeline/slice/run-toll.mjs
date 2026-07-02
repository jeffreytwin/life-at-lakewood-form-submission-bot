// Vertical slice runner: extract Toll Brothers plans for The Isles at
// Lakewood Ranch and write the normalized output for diffing.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extract } from '../extractors/toll-brothers.mjs';

const plans = await extract({
  url: 'https://www.tollbrothers.com/luxury-homes-for-sale/Florida/The-Isles-at-Lakewood-Ranch',
});
const out = path.join(import.meta.dirname, 'toll-isles-normalized.json');
await writeFile(out, JSON.stringify({ extractedFor: 'toll-brothers|the-isles', plans }, null, 2));
console.log(`extracted ${plans.length} plans (${plans.filter((p) => p.quickMoveIn).length} QMI)`);
for (const p of plans.slice(0, 30)) {
  console.log(`  ${p.quickMoveIn ? '[QMI] ' : ''}${p.name} | ${p.priceDisplay} | ${p.beds}bd ${p.baths}ba ${p.sqft}sqft`);
}
