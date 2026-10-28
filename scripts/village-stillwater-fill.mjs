// Fills in the Stillwater draft row of Life At Lakewood's villages
// collection (AmenitiesbyVillage), Jeff 2026-10-28: "I already have it as a
// draft in our villages collection ... Can you fill out the information in
// the row for me before I take a look at it?"
//
// Runs as a prebuild step on Vercel (the only environment holding
// WIX_API_KEY and the Supabase service key), guarded to its own branch so
// production and other preview builds skip it. Always exits 0: it must never
// fail or slow a deploy.
//
// Only blank fields are written: anything already on the row (Jeff's own
// edits, or the village ranges sync's numbers) is left as it is. The row
// stays a draft: the update carries _publishStatus back as read, because a
// Wix update that leaves it out publishes the row (docs/VILLAGE_RANGES.md).
// The row as written is cached in fp_legacy_items so it can be checked from
// a sandbox with no Wix credentials.
//
// Sources, read 2026-10-28:
//  - lennar.com Stillwater at Lakewood Ranch: gated, single-family, two
//    collections (Executive, Manor), eight plans $501,999 to $767,204 with
//    quick move-ins, 1,850 to 2,724 sq ft, 2 to 4 beds, 2 to 3 baths.
//  - lakewoodranch.com/our-villages/stillwater: 105 homes, gated, south of
//    SR-70 on Bourneside Boulevard, 2 to 4 bedrooms, up to 3-car garages,
//    "low-maintenance" homes, HOA about $350 to $360 a month.
//  - Lennar's announcement (2025-07-24): Manor plans have three-bay garages;
//    Everything's Included; parks and trails are Lakewood Ranch's.
//  - fp_floor_plans: the eight Lennar plans live in Floor Plans V2 (2 car
//    Executive, 3 car Manor), all single family.
// Neither official page lists an on-site pool, clubhouse or other amenity
// beyond the gate, so the gate is the only amenity marked Yes.

const BRANCHES = new Set(['claude/stillwater-village-fill']);
const SITE_ID = '4fbabb96-2d6c-4f20-a240-9223153498b5'; // lifeatlakewood.com
const COLLECTION = 'AmenitiesbyVillage';
const ITEM_ID = 'd2761142-c536-4c15-a0b3-b980b2f8335d'; // "Stillwater", DRAFT

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (!BRANCHES.has(branch)) {
  console.log(`STILLWATER: branch ${branch ?? '(none)'} is not the fill branch; skipping.`);
  process.exit(0);
}
const wixKey = process.env.WIX_API_KEY;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!wixKey || !supaUrl || !supaKey) {
  console.log('STILLWATER: missing WIX_API_KEY or Supabase env; skipping.');
  process.exit(0);
}

const log = (...a) => console.log('STILLWATER', ...a);

// The amenity rows, in the collection's order (amenitiesImage1..15). The
// icons are the two the collection uses for each amenity: "1" is Yes, "2"
// is No, except the pool, whose Yes icon is "Amenities Icon". Yes rows are
// font_8, No rows font_9, as on every other village.
const AMENITIES = [
  { n: 1, key: 'pool', label: 'Pool', on: false,
    yes: 'd0be81_ec844aad9faf4a34a2000d11c6fc5b25~mv2.png/Amenities%20Icon.png#originWidth=853&originHeight=854',
    no: 'd0be81_4c31884cd67f4e918ba5fcae27dfe70d~mv2.png/Pool%202.png#originWidth=497&originHeight=497' },
  { n: 2, key: 'spa', label: 'Spa', on: false,
    yes: 'd0be81_ef799a94952745f3b76671b2816b280f~mv2.png/Spa%201.png#originWidth=648&originHeight=648',
    no: 'd0be81_3efcd7c1bae54757b2209782707d42a9~mv2.png/Spa%202.png#originWidth=648&originHeight=648' },
  { n: 3, key: 'fitnessCenter', label: 'Fitness Center', on: false,
    yes: 'd0be81_0abb769dae554dd0865fd5a065f68dac~mv2.png/Fitness%20Center%201.png#originWidth=631&originHeight=631',
    no: 'd0be81_c25458abbdef4703b382a386d9a1a1b9~mv2.png/Fitness%20Center%202.png#originWidth=631&originHeight=631' },
  { n: 4, key: 'lifestyleDirector', label: 'Lifestyle Director', on: false,
    yes: 'd0be81_954cb9d8758a49a4982b81380891499b~mv2.png/Lifestyle%20Director%201.png#originWidth=628&originHeight=628',
    no: 'd0be81_0036e34235254d7a9a1012197a9efa7e~mv2.png/Lifestyle%20Director%202.png#originWidth=628&originHeight=628' },
  { n: 5, key: 'tennis', label: 'Tennis', on: false,
    yes: 'd0be81_4c9a651351ec40cd99f56f47489f8e6a~mv2.png/Tennis%201.png#originWidth=658&originHeight=657',
    no: 'd0be81_f91b013ee0524bfa9b192efeabf41b65~mv2.png/Tennis%202.png#originWidth=658&originHeight=657' },
  { n: 6, key: 'pickleball', label: 'Pickleball', on: false,
    yes: 'd0be81_d77262d59f224a39b7520b0c71893a0f~mv2.png/Pickleball%201.png#originWidth=586&originHeight=586',
    no: 'd0be81_37523ee6691b44cf9497be5212bd34f4~mv2.png/Pickleball%202.png#originWidth=586&originHeight=586' },
  { n: 7, key: 'restaurantOrBar', label: 'Restaurant or Bar', on: false,
    yes: 'd0be81_f8346cedaada497e8ffdf2a240eb97e5~mv2.png/Restaurant%201.png#originWidth=751&originHeight=752',
    no: 'd0be81_1dbb4856cbde44eaabf366042f46efad~mv2.png/Restaurant%202.png#originWidth=751&originHeight=752' },
  { n: 8, key: 'golf', label: 'Golf', on: false,
    yes: 'd0be81_441305cb31f94305ae279505e25faa56~mv2.png/Golf%201.png#originWidth=537&originHeight=537',
    no: 'd0be81_777cb8d72937406cb6bb658573e3ecc3~mv2.png/Golf%202.png#originWidth=537&originHeight=537' },
  { n: 9, key: 'walkingPaths', label: 'Walking Paths', on: false,
    yes: 'd0be81_4bb35438b1ac48ecbb33163328b9368a~mv2.png/Walking%20Paths%201.png#originWidth=623&originHeight=623',
    no: 'd0be81_3fbc3cc7ef234c06946623acb357fccb~mv2.png/Walking%20Paths%202.png#originWidth=623&originHeight=623' },
  { n: 10, key: 'totLot', label: 'Tot Lot', on: false,
    yes: 'd0be81_aafbbf4fea60458cbf503d7a4f94f86d~mv2.png/Tot%20Lot%201.png#originWidth=1257&originHeight=1257',
    no: 'd0be81_58f5d0f7bb6c4125be5b75101ec72134~mv2.png/Tot%20Lot%202.png#originWidth=1257&originHeight=1257' },
  { n: 11, key: 'dogPark', label: 'Dog Park', on: false,
    yes: 'd0be81_bbaa6f7603f44dac8b918a593894be09~mv2.png/Dog%20Park%201.png#originWidth=442&originHeight=442',
    no: 'd0be81_2daa86e78a0749d2800ccce2d8c34c6c~mv2.png/Dog%20Park%202.png#originWidth=442&originHeight=442' },
  { n: 12, key: 'gate', label: 'Gated', on: true,
    yes: 'd0be81_c3e4b73896c541a4be634cf2998b3267~mv2.png/Gate%201.png#originWidth=382&originHeight=382',
    no: 'd0be81_e30e6afe44c747efb85dda864d99fdcd~mv2.png/Gate%202.png#originWidth=382&originHeight=382' },
  { n: 13, key: 'clubhouse', label: 'Clubhouse', on: false,
    yes: 'd0be81_4088af45fa34498f8d6b6b2758bb3843~mv2.png/Clubhouse%201.png#originWidth=773&originHeight=773',
    no: 'd0be81_03a189e9add7402d9ee49cc6443e9dbf~mv2.png/Clubhouse%202.png#originWidth=773&originHeight=773' },
  { n: 14, key: 'maintenanceIncluded', label: 'Maintenance Included', on: false,
    yes: 'd0be81_6bda2e5e7d6d4e15818d7c20c2cc68e9~mv2.png/Maintenance%201.png#originWidth=498&originHeight=498',
    no: 'd0be81_9ed9a7d5863340a89bd28c50b31e3537~mv2.png/Maintenance%202.png#originWidth=498&originHeight=498' },
  { n: 15, key: 'ageRestricted', label: '55+ Community', on: false,
    yes: 'd0be81_27477187b07c4c639f0203c56d1acb61~mv2.png/Age%20Restricted%201.png#originWidth=1530&originHeight=1529',
    no: 'd0be81_80418ec795714c179f4d407f57869d6c~mv2.png/Age%20Restricted%202.png#originWidth=1530&originHeight=1529' },
];

function amenityFields() {
  const out = {};
  for (const a of AMENITIES) {
    const font = a.on ? 'font_8' : 'font_9';
    out[`amenitiesImage${a.n}`] = `wix:image://v1/${a.on ? a.yes : a.no}`;
    out[`amenities${a.n}Description`] = a.label;
    out[`${a.key}V2`] = `<p class="${font}">${a.label}</p>`;
    out[`${a.key}V3`] = `<p class="${font}" style="text-align: right">${a.on ? 'Yes' : 'No'}</p>`;
  }
  return out;
}

const FILL = {
  villagesDescription:
    'Stillwater is a boutique gated village of just 105 single-family homes by Lennar, set among natural preserves just south of State Road 70 on Bourneside Boulevard in Lakewood Ranch.',
  description:
    "Stillwater offers quiet, gated living with preserve and water views, Lennar's Everything's Included® homes, and easy access to Lakewood Ranch's parks, trails, shopping and dining.",
  buttonLink: 'https://www.lifeatlakewood.com/stillwater',
  homesForSaleLink: 'https://www.lifeatlakewood.com/homes-for-sale-in-stillwater',
  amenityLevel: 'Low',
  amenityLevelDropdown: 'Low, Show All',
  showAll: 'Show All Amenities, Gated',
  amenitiesDropdownNew: ['Gated Community'],
  ...amenityFields(),
  // The village ranges sync owns these and keeps them current; written here
  // only if the sync has not filled them yet, from today's Lennar plans.
  priceRange: '$500s - $700s',
  priceRangeDropdown: 'Show All Price Ranges, $500s, $600s, $700s',
  priceRangeNew: ['$500s', '$600s', '$700s'],
  squareFootageRange: '1,900 - 2,700 square feet',
  bedrooms: '2 - 4',
  bedroomsNew: ['2', '3', '4'],
  bedroomsDropdown: '2, 3, 4, Show All',
  bathrooms: '2 - 3',
  bathroomsNew: ['2', '3'],
  bathroomsDropdown: '2, 3, Show All',
  garages: '2 - 3 Car',
  garagesNew: ['2', '3'],
  garagesDropdown: '2, 3, Show All',
  homeTypes: 'Single Family',
  homeTypeNew: ['Single Family Home'],
  homeTypesDropdown: 'Single Family Home, Show All',
  hasListingsOrNewConstruction: true,
  hasNewConstruction: true,
  buildYourHomeColor: '#2C9E37',
};

async function wix(method, path, body) {
  const res = await fetch(`https://www.wixapis.com${path}`, {
    method,
    headers: { authorization: wixKey, 'wix-site-id': SITE_ID, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, json, text };
}

async function supa(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${supaUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: supaKey,
      authorization: `Bearer ${supaKey}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const getItem = () =>
  wix('GET', `/wix-data/v2/items/${ITEM_ID}?dataCollectionId=${COLLECTION}&publishPluginOptions.includeDraftItems=true`);

const blank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

async function main() {
  const read = await getItem();
  const item = read.json?.dataItem;
  if (read.status !== 200 || !item) {
    log(`read ${read.status} ${(read.text ?? '').slice(0, 300)}`);
    return;
  }
  const data = item.data ?? {};
  if (data.title !== 'Stillwater') {
    log(`item ${ITEM_ID} is "${data.title}", not Stillwater; nothing written.`);
    return;
  }
  const changes = Object.fromEntries(Object.entries(FILL).filter(([k]) => blank(data[k])));
  const kept = Object.keys(FILL).filter((k) => !(k in changes));
  log(`status ${data._publishStatus}; filling ${Object.keys(changes).length} fields; already set: ${kept.join(', ') || 'none'}`);
  if (Object.keys(changes).length === 0) return;

  const base = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')));
  const payload = { ...base, ...changes, _id: ITEM_ID, ...(data._publishStatus ? { _publishStatus: data._publishStatus } : {}) };
  const put = await wix('PUT', `/wix-data/v2/items/${ITEM_ID}`, {
    dataCollectionId: COLLECTION,
    dataItem: { id: ITEM_ID, data: payload },
    publishPluginOptions: { includeDraftItems: true },
  });
  if (put.status !== 200) {
    log(`update ${put.status} ${(put.text ?? '').slice(0, 500)}`);
    return;
  }
  const after = (await getItem()).json?.dataItem;
  const status = after?.data?._publishStatus;
  log(`written; row is now ${status}${status !== data._publishStatus ? ' (CHANGED)' : ''}`);

  const sites = await supa('fp_sites?domain=eq.lifeatlakewood.com&select=id');
  if (after && sites?.[0]?.id) {
    await supa('fp_legacy_items?on_conflict=site_id,collection_id,wix_record_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        site_id: sites[0].id,
        collection_id: COLLECTION,
        wix_record_id: ITEM_ID,
        data: after.data,
        publish_status: status ?? null,
        imported_at: new Date().toISOString(),
      }],
    });
    log('cached in fp_legacy_items');
  }
}

main().catch((error) => log(`failed: ${error?.message ?? error}`)).finally(() => process.exit(0));
