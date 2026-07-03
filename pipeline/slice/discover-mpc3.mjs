// MPC discovery round 3 (GitHub Actions), fetch-only. Both MPC sites run the
// same home-search platform: the home-list HTML embeds every home as
// <article data-comp="property" data-builder-name=… data-neighborhood=…
// data-price=… data-beds=… …> with <h3> name/address, <h4> price, <img>,
// and a detail <a href>. Confirm Lakewood Ranch serves the same structure in
// raw HTML (round-1 text-strip hid it — the data lives in attributes), and
// lock the builder-name / neighborhood slug vocabulary so the extractor can
// filter precisely. Output: pipeline/slice/discovery/mpc3/.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'discovery', 'mpc3');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const PAGES = [
  ['wellenpark', 'https://www.wellenpark.com/available-homes/'],
  ['lakewoodranch', 'https://www.lakewoodranch.com/home-finder/'],
];

async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    return { status: res.status, url: res.url, text: await res.text().catch(() => '') };
  } catch (err) {
    return { status: 0, url, text: '', error: String(err?.cause?.message ?? err?.message ?? err) };
  }
}
const save = (name, data) =>
  writeFile(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));

// Pull data-* attributes off an <article ...> opening tag.
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/data-([a-z0-9_-]+)=["']([^"']*)["']/gi)) out[m[1]] = m[2];
  return out;
}

await mkdir(OUT, { recursive: true });
const summary = {};

for (const [slug, url] of PAGES) {
  const res = await get(url);
  const s = { url: res.url, status: res.status, bytes: res.text.length, error: res.error };
  if (res.status === 200) {
    // Each card: <article ... data-comp="property" ...> … </article>
    const cards = [...res.text.matchAll(/<article\b([^>]*data-comp=["']property["'][^>]*)>([\s\S]*?)<\/article>/gi)];
    s.cards = cards.length;
    const byBuilder = {};
    const byNeighborhood = {};
    const availability = {};
    const samples = [];
    for (const [i, m] of cards.entries()) {
      const a = attrs('<x ' + m[1] + '>');
      const inner = m[2];
      byBuilder[a['builder-name'] ?? '?'] = (byBuilder[a['builder-name'] ?? '?'] ?? 0) + 1;
      byNeighborhood[a.neighborhood ?? '?'] = (byNeighborhood[a.neighborhood ?? '?'] ?? 0) + 1;
      availability[a.availability || '(blank)'] = (availability[a.availability || '(blank)'] ?? 0) + 1;
      if (i < 6 || /mi-homes|ici|neal/i.test(a['builder-name'] ?? '')) {
        if (samples.length < 12) {
          samples.push({
            attrs: a,
            h3: (inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '').replace(/<[^>]+>/g, '').trim(),
            h4: (inner.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? '').replace(/<[^>]+>/g, '').trim(),
            detail: inner.match(/href=["']([^"']+\/home\/[^"']+)["']/i)?.[1] ?? inner.match(/href=["']([^"']+detail[^"']*)["']/i)?.[1] ?? null,
            img: inner.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null,
            neighborhoodText: [...inner.matchAll(/<p[^>]*>([^<]{2,60})<\/p>/gi)].map((x) => x[1].trim()).filter((t) => !/^(Single|Multi|Builder:|View)/i.test(t)).slice(0, 2),
          });
        }
      }
    }
    s.byBuilder = byBuilder;
    s.availability = availability;
    s.neighborhoods = Object.keys(byNeighborhood).sort();
    await save(`${slug}-cards.sample.json`, samples);
    // Raw HTML of the first two cards for exact structure reference.
    if (cards.length) await save(`${slug}-card-raw.html`, cards.slice(0, 2).map((m) => m[0]).join('\n\n<!-- ---- -->\n\n'));
  }
  summary[slug] = s;
}

await save('mpc3-summary.json', summary);
console.log('MPC discovery 3 complete:', JSON.stringify(summary, null, 1));
