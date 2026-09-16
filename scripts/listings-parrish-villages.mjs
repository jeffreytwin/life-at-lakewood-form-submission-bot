#!/usr/bin/env node
// Emits the SQL that seeds Life At Parrish's neighborhoods, subdivision terms
// and tag icons into ls_villages / ls_village_terms. The source is the site's
// manual dashboard page code (the `subDivisionName.search(...)` list and the
// three tag ternaries in setDataObject), transcribed here so the engine
// classifies exactly as the hand-run process did. Run once to produce the
// data block of supabase/migrations/046_parrish_site.sql; afterwards the Hub's
// Neighborhoods page is the place to change terms.
//
//   node scripts/listings-parrish-villages.mjs > /tmp/parrish-villages.sql

const SITE_DOMAIN = "lifeatparrish.com";
const PAGE = (slug) => `https://www.lifeatparrish.com/neighborhood/${slug}`;

// name -> [page slug, HousesforSale-DynamicPages item id (village1)]
const VILLAGES = {
  "Aberdeen": ["aberdeen", "a1d14dd0-0470-468a-915b-7835e90bb0c6"],
  "Ancient Oaks": ["ancient-oaks", "df896cfd-c5fa-41e3-beaf-f30d4d8f094d"],
  "Aviary at Rutland Ranch": ["aviary-at-rutland-ranch", "ef3e49d3-a2b6-4422-ae52-797cdd24beeb"],
  "Bella Lago": ["bella-lago", "432d734b-059c-4cce-8955-6236356e795c"],
  "North River Ranch": ["north-river-ranch", "faee3374-9bdb-48bb-872b-166c759e6923"],
  "Broadleaf": ["broadleaf", "1673fe32-bb2e-44d9-ad96-68517e22f352"],
  "Canoe Creek": ["canoe-creek", "0ecbf0ff-4ed7-4baf-8d9d-6009749fcedc"],
  "Chelsea Oaks": ["chelsea-oaks", "81583010-5d54-4bcf-872e-925d794e2748"],
  "Copperstone": ["copperstone", "7ba0577e-fb03-4dcf-a6cd-3d5983619130"],
  "Creekside Oaks": ["creekside-oaks", "ba9b1209-2c6c-476f-95df-01ae1cee457b"],
  "Creekside Preserve": ["creekside-preserve", "f069eff5-2ac9-41df-a06e-869c4910db58"],
  "Creekside at Rutland Ranch": ["creekside-at-rutland-ranch", "ee8c7c34-d300-4049-83a7-3a0b5578bbe2"],
  "Cross Creek": ["cross-creek", "9960ce18-95c9-4669-8ae1-e57681d72a2e"],
  "Crosswind": ["crosswind-point", "133e204d-ae4c-4c24-9360-215edf07930e"],
  "Del Webb Sunchase": ["del-webb-sunchase", "20f479ec-3124-410a-ac06-4f7522850ba5"],
  "Del Webb At Bayview": ["del-webb-at-bayview", "4c6971b1-4a1d-44c8-85f3-fa1d4143602b"],
  "Firethorn": ["firethorn", "8b5c944a-71bb-41ed-b160-7384af3ccda2"],
  "Forest Creek": ["forest-creek", "d30a0060-00a9-4fc7-b365-97b0ea8da502"],
  "Foxbrook": ["foxbrook", "fcbf8ad9-3943-4d34-93e5-48c99b9580ec"],
  "Gamble Creek Estates": ["gamble-creek-estates", "ead6a877-726c-4b9b-83d3-302d8aaa9513"],
  "Grand Oak Preserve": ["grand-oak-preserve", "7e027556-dbc9-4b53-893d-311b8390a11f"],
  "Harrison Ranch": ["harrison-ranch", "9831be08-5d40-4ec7-b352-101411dcc668"],
  "Isles at Bayview": ["isles-at-bayview", "117fa6da-1210-4625-80a3-8c91c205d7a2"],
  "Kingsfield": ["kingsfield", "e5e4d3b8-b534-4609-8366-45b8b5e1db9c"],
  "Kingsfield Lakes": ["kingsfield-lakes", "4ece3001-89c6-4db3-8f7c-48c9cbd5f208"],
  "Lakeside Preserve": ["lakeside-preserve", "0b9b1062-15f7-43b8-baf4-544672a8f2dd"],
  "Legacy Preserve": ["legacy-preserve", "23a451f2-1d38-480c-a4d2-aa7047121bef"],
  "Lexington": ["lexington", "69d106c3-2f52-4cc0-993a-771139a23d66"],
  "McKinley Oaks": ["mckinley-oaks", "349e45c5-7cce-42e2-b85f-6da2b9a31132"],
  "Oakfield": ["oakfield", "f1bf8a4d-e8fb-42dc-ba4d-55e5bb72520e"],
  "Parkwood Lakes": ["parkwood-lakes", "935001ed-23ad-4cdf-8f3a-1583386730d3"],
  "Prosperity Lakes": ["prosperity-lakes", "b3e0a6a0-eb52-4c28-9e07-6c065740f0fc"],
  "River Plantation": ["river-plantation", "43febbfd-41f2-4bfb-b9cc-b5f1f20c8933"],
  "River Wilderness": ["river-wilderness", "0f8e2b1f-150a-41ed-8c92-cca85b01cc5d"],
  "River Woods": ["river-woods", "bfd6e345-cc72-4521-b5ac-6ad5f12cdda8"],
  "Rivers Reach": ["rivers-reach", "3ed76e5f-6a63-4803-b4aa-1886477a7d5d"],
  "Riversong": ["riversong", "bfa84164-7332-4cf1-b714-e490b8023125"],
  "Rye Crossing": ["rye-crossing", "852b5871-d06b-4817-9763-e842c3027dd0"],
  "Rye Ranch": ["rye-ranch", "79da75ec-b41e-4154-a859-5383f73a8814"],
  "Salt Meadows": ["salt-meadows", "d0ec2799-324f-4b95-8520-d7609398556c"],
  "Sawgrass Lakes": ["sawgrass-lakes", "2ac9bd59-b28d-4c40-a317-aac12b66d4df"],
  "Seaire": ["seaire", "5f5bede6-e2cd-4f00-ba57-17d3d08e3d9c"],
  "Silverleaf": ["silverleaf", "075e646a-f3e7-4b21-a82d-fa1a643cd3ad"],
  "Southern Oaks": ["southern-oaks", "953913c5-8508-4bbe-8bc3-0301b58ca512"],
  "Summerwoods": ["summerwoods", "3d256b8f-277c-4f33-8410-d469d7fb73eb"],
  "The Islands on The Manatee River": ["the-islands-on-the-manatee-river", "f2289121-f7cb-4fc1-ac6b-f1477280acb5"],
  "The Willows & The Laurels": ["the-willows", "17ffd87f-bb0e-4aa2-8b07-a9ba1ef94642"],
  "Timberly": ["timberly", "c170a900-e9f7-4107-ac64-99c73bf69465"],
  "Twin Rivers": ["twin-rivers", "1c3047f3-731b-4d15-91f8-652b79382eb5"],
  "Windwater": ["windwater", "15877619-6a54-4b12-b717-ca976d2e2eef"],
  "Woodland Preserve": ["woodland-preserve", "81f1131e-4524-4ca3-be13-c712fafeebb9"],
};

// subdivision term (lowercase, `SubdivisionName.search(term)`) -> village name
const TERMS = {
  "aberdeen": "Aberdeen",
  "ancient oaks": "Ancient Oaks",
  "aviary": "Aviary at Rutland Ranch",
  "bella lago": "Bella Lago",
  "brightwood": "North River Ranch",
  "broadleaf": "Broadleaf",
  "canoe creek": "Canoe Creek",
  "chelsea oaks": "Chelsea Oaks",
  "copperstone": "Copperstone",
  "creekside oaks": "Creekside Oaks",
  "creekside preserve": "Creekside Preserve",
  "creekside at": "Creekside at Rutland Ranch",
  "crescent creek": "North River Ranch",
  "cross creek": "Cross Creek",
  "crosscreek": "Cross Creek",
  "crosswind": "Crosswind",
  "del webb explore": "North River Ranch",
  "del webb sunchase": "Del Webb Sunchase",
  "del webb at bayview": "Del Webb At Bayview",
  "firethorn": "Firethorn",
  "forest creek": "Forest Creek",
  "foxbrook": "Foxbrook",
  "gamble creek": "Gamble Creek Estates",
  "grand oak preserve": "Grand Oak Preserve",
  "harrison ranch": "Harrison Ranch",
  "highview": "North River Ranch",
  "isles at bayview": "Isles at Bayview",
  "kingsfield": "Kingsfield",
  "kingsfield lakes": "Kingsfield Lakes",
  "lakeside preserve": "Lakeside Preserve",
  "legacy preserve": "Legacy Preserve",
  "lexington": "Lexington",
  "longmeadow": "North River Ranch",
  "mckinley oaks": "McKinley Oaks",
  "north river ranch": "North River Ranch",
  "oakfield lakes": "Oakfield",
  "oakfield trails": "Oakfield",
  "parkwood lakes": "Parkwood Lakes",
  "prosperity lakes": "Prosperity Lakes",
  "river plantation": "River Plantation",
  "river wilderness": "River Wilderness",
  "river woods": "River Woods",
  "reach": "Rivers Reach",
  "riverfield": "North River Ranch",
  "riversong": "Riversong",
  "rye crossing": "Rye Crossing",
  "rye ranch": "Rye Ranch",
  "salt meadows": "Salt Meadows",
  "saltmdws": "Salt Meadows",
  "saltmeadows": "Salt Meadows",
  "sawgrass lakes": "Sawgrass Lakes",
  "seaire": "Seaire",
  "silverleaf": "Silverleaf",
  "southern oaks": "Southern Oaks",
  "summerwoods": "Summerwoods",
  "the islands on the manatee": "The Islands on The Manatee River",
  "willows": "The Willows & The Laurels",
  "laurels": "The Willows & The Laurels",
  "timberly": "Timberly",
  "twin rivers": "Twin Rivers",
  "wildleaf": "North River Ranch",
  "windwater": "Windwater",
  "woodland preserve": "Woodland Preserve",
};

const ICON = (id) => `https://static.wixstatic.com/media/${id}~mv2.png`;
const maintenance = ICON("d0be81_876ff79d020e487784e082a441bd4d84");
const clubhouse = ICON("d0be81_aae6b9125c784fffbe6b679d403c01d6");
const gated = ICON("d0be81_12f5e34e37d54c11a1b630db35b9fcd6");
const dogParkGreen = ICON("d0be81_ad755db7cad5428a89a7f9c1edd7a14e");
const scenicWalks = ICON("d0be81_8443577a57464e3bb5d27fe1a80f3c0f");
const yellowPickleball = ICON("d0be81_7616448739964b708d5025c8b261e914");
const yellowPlayground = ICON("d0be81_1228248c285845f1a9a0e2073fd93fde");
const purpleTennis = ICON("d0be81_7b27a5adc02a4354a2b7892f7af85c2c");
const gym = ICON("d0be81_d3a6386624504bdeb73cae209f6b469d");
const greenGolf2 = ICON("d0be81_c4b96b4e8980473db8573538ae5a4a31");
const greenPickleball = ICON("d0be81_b01f771f67cf41c6b51d04672c8b0da0");
const trails = ICON("d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39");
const fiftyFivePlus = ICON("d0be81_8d4ae4966d7144039c8a9e212c09b48f");
const dogParkPurple = ICON("d0be81_09510d25dd304733a8924eebaf2c2147");
const scenicView = ICON("d0be81_d6998a26979b4dbdba0bde53d873a30f");
const greenPlayground = ICON("d0be81_0f25a5fa4f72410aaa780cd592870c13");
const yellowVillagePool = ICON("d0be81_2af917ac843644e9ad62ecba90efdf1a");
const greenVillagePool = ICON("d0be81_8047b9269ae3438182f3f075f661ec92");

// The ternary chains from setDataObject, in order: the first list naming the
// village wins, and a village in no list gets "". Names that never reach a
// listing (Crescent Creek, Del Webb Explore, Riverfield, Longmeadow all map
// to North River Ranch; "Del Webb at Bayview" differs in case) are kept so
// the transcription can be checked against the source.
const BLUE = [
  [["Crescent Creek"], maintenance],
  [["Foxbrook", "Kingsfield", "Kingsfield Lakes", "Creekside Oaks", "Cross Creek", "Southern Oaks", "Rye Crossing", "Chelsea Oaks", "Copperstone", "Rivers Reach", "Summerwoods", "McKinley Oaks", "Broadleaf", "Lakeside Preserve", "Creekside Preserve", "Aberdeen"], yellowPlayground],
  [["North River Ranch", "The Islands on The Manatee River", "Oakfield", "Forest Creek", "Salt Meadows", "Prosperity Lakes", "Del Webb Explore", "Harrison Ranch", "Woodland Preserve", "Riverfield", "Del Webb At Bayview", "River Plantation", "Bella Lago", "Del Webb Sunchase", "Windwater", "Isles at Bayview", "River Wilderness", "Canoe Creek", "Silverleaf", "Legacy Preserve"], clubhouse],
  [["Ancient Oaks", "Twin Rivers"], scenicWalks],
  [["Parkwood Lakes", "Gamble Creek Estates", "Grand Oak Preserve"], scenicView],
  [["Aviary at Rutland Ranch", "Rye Ranch"], yellowPickleball],
  [["Timberly", "Firethorn", "Lexington", "Crosswind", "River Woods", "Seaire", "Sawgrass Lakes"], yellowVillagePool],
];
const PURPLE = [
  [["Aviary at Rutland Ranch", "Gamble Creek Estates", "Cross Creek", "Lexington", "Summerwoods", "Aberdeen", "Crosswind"], trails],
  [["Del Webb Explore", "Del Webb At Bayview", "River Plantation", "Bella Lago", "Longmeadow"], purpleTennis],
  [["North River Ranch", "Oakfield", "Salt Meadows", "Harrison Ranch", "Silverleaf", "Rye Ranch"], gym],
  [["The Islands on The Manatee River", "Creekside Preserve", "Forest Creek", "Creekside Oaks", "Prosperity Lakes", "Rye Crossing", "Woodland Preserve", "Chelsea Oaks", "Copperstone", "Riverfield", "Seaire", "Rivers Reach", "Del Webb Sunchase", "Twin Rivers", "River Wilderness"], gated],
  [["Kingsfield", "Southern Oaks", "Windwater", "Isles at Bayview", "Canoe Creek", "Legacy Preserve"], dogParkPurple],
];
const GREEN = [
  [["The Islands on The Manatee River", "Kingsfield", "Cross Creek", "Southern Oaks", "Rye Crossing", "Chelsea Oaks", "Copperstone", "Bella Lago", "Rivers Reach", "Summerwoods", "Windwater", "Isles at Bayview", "Silverleaf"], greenVillagePool],
  [["Aviary at Rutland Ranch", "Forest Creek", "Riverfield", "River Plantation", "Crosswind", "Longmeadow", "Twin Rivers"], greenPlayground],
  [["River Wilderness"], greenGolf2],
  [["North River Ranch", "Oakfield", "Salt Meadows", "Del Webb Explore", "Harrison Ranch", "Woodland Preserve", "Lexington", "Del Webb At Bayview", "Del Webb Sunchase", "Canoe Creek", "Legacy Preserve"], greenPickleball],
  [["Prosperity Lakes", "Del Webb Explore", "Woodland Preserve", "Del Webb at Bayview", "Del Webb Sunchase"], fiftyFivePlus],
  [["Seaire", "Rye Ranch"], dogParkGreen],
];

const firstMatch = (chain, name) => (chain.find(([names]) => names.includes(name)) ?? [null, ""])[1];

export function parrishVillages() {
  const out = [];
  for (const [name, [slug, itemId]] of Object.entries(VILLAGES)) {
    const display = {};
    const blue = firstMatch(BLUE, name);
    const purple = firstMatch(PURPLE, name);
    const green = firstMatch(GREEN, name);
    if (blue) display.blueTag1 = blue;
    if (purple) display.purpleTag1 = purple;
    if (green) display.greenTag1 = green;
    const terms = Object.entries(TERMS).filter(([, v]) => v === name).map(([t]) => t);
    if (!terms.length) throw new Error(`village ${name} has no term`);
    out.push({ name, slug, itemId, pageUrl: PAGE(slug), display, terms });
  }
  for (const v of Object.values(TERMS)) if (!VILLAGES[v]) throw new Error(`term points at unknown village ${v}`);
  return out;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function parrishVillagesSql() {
  const villages = parrishVillages();
  const rows = villages.map((v) => `    (${q(v.name)}, ${q(v.slug)}, ${q(v.itemId)}, ${q(v.pageUrl)}, ${q(JSON.stringify(v.display))}::jsonb)`);
  const termRows = villages.flatMap((v) => v.terms.map((t) => `    (${q(v.name)}, ${q(t)})`));
  return [
    `-- ${villages.length} neighborhoods, ${termRows.length} subdivision terms (scripts/listings-parrish-villages.mjs).`,
    `WITH site AS (SELECT id FROM ls_sites WHERE domain = ${q(SITE_DOMAIN)}),`,
    `village_rows(name, wix_slug, wix_item_id, page_url, display) AS (VALUES`,
    rows.join(",\n"),
    `)`,
    `INSERT INTO ls_villages (site_id, name, wix_slug, wix_item_id, page_url, display)`,
    `SELECT site.id, v.name, v.wix_slug, v.wix_item_id, v.page_url, v.display FROM village_rows v, site`,
    `ON CONFLICT (site_id, name) DO UPDATE SET wix_slug = EXCLUDED.wix_slug, wix_item_id = EXCLUDED.wix_item_id, page_url = EXCLUDED.page_url, display = EXCLUDED.display, updated_at = now();`,
    ``,
    `WITH site AS (SELECT id FROM ls_sites WHERE domain = ${q(SITE_DOMAIN)}),`,
    `term_rows(village_name, term) AS (VALUES`,
    termRows.join(",\n"),
    `)`,
    `INSERT INTO ls_village_terms (site_id, village_id, term)`,
    `SELECT site.id, v.id, t.term FROM term_rows t JOIN site ON true JOIN ls_villages v ON v.site_id = site.id AND v.name = t.village_name`,
    `ON CONFLICT DO NOTHING;`,
  ].join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.stdout.write(parrishVillagesSql() + "\n");
}
