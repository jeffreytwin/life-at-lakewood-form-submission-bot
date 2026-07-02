// Toll Brothers extractor (extraction_method: json_api).
//
// Toll Brothers community pages embed complete model/QMI data in
// __NEXT_DATA__ (masterCommunityComponent.homes.models). One fetch per
// community page yields every plan across its collections.
//
// extractor_params: { url: "https://www.tollbrothers.com/luxury-homes-for-sale/..." }
// Returns normalized plans (see pipeline/README.md for the canonical shape).

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const normKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const money = (n) =>
  typeof n === 'number' && n > 0 ? '$' + n.toLocaleString('en-US') : null;

function normalizeModel(m) {
  const beds =
    m.minBed && m.maxBed && m.maxBed !== m.minBed ? `${m.minBed} - ${m.maxBed}` : String(m.minBed ?? '');
  const baths =
    m.minBath && m.maxBath && m.maxBath !== m.minBath ? `${m.minBath} - ${m.maxBath}` : String(m.minBath ?? '');
  const garage = m.minGarage ? String(parseFloat(m.minGarage)) : null;
  const images = [];
  if (m.headShot?.media?.url) images.push(m.headShot.media.url);
  if (m.media?.url && !images.includes(m.media.url)) images.push(m.media.url);
  for (const fp of m.floorplans ?? []) {
    if (fp?.url && !images.includes(fp.url)) images.push(fp.url);
  }
  return {
    planKey: normKey(m.name),
    name: m.name,
    price: typeof m.pricedFrom === 'number' ? m.pricedFrom : null,
    priceDisplay: money(m.pricedFrom),
    beds,
    baths,
    sqft: m.minSqft ?? null,
    garages: garage ? `${garage} car` : null,
    homeType: m.homeType ?? null,
    quickMoveIn: m.isQMI === true,
    comingSoon: m.isComingSoon === true,
    sourceUrl: m.url ?? null,
    primaryImage: images[0] ?? null,
    galleryImages: images,
    raw: {
      masterPlanID: m.masterPlanID,
      commPlanID: m.commPlanID,
      stories: m.stories,
      communityId: m.communityId,
    },
  };
}

export async function extract(params) {
  if (!params?.url) throw new Error('toll-brothers extractor requires params.url');
  const res = await fetch(params.url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${params.url}: ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no __NEXT_DATA__ found (page structure changed?)');
  const data = JSON.parse(m[1]);
  const models =
    data?.props?.pageProps?.pageData?.masterCommunityComponent?.homes?.models;
  if (!Array.isArray(models)) throw new Error('homes.models missing from __NEXT_DATA__');
  return models.map(normalizeModel);
}
