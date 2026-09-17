#!/usr/bin/env node
// Emits the SQL that seeds Life in Wellen Park's neighborhoods, subdivision
// terms and tag icons into ls_villages / ls_village_terms. The source is the
// site's manual dashboard page code (the `subDivisionName.search(...)` chain
// that assigns Village / VillageURL / village1, and the three tag ternaries
// in setDataObject), transcribed here so the engine classifies exactly as
// the hand-run process did. Run once to produce the data block of
// supabase/migrations/052_wellen_park_villages.sql; afterwards the Hub's
// Neighborhoods page is the place to change terms.
//
//   node scripts/listings-wellen-villages.mjs > /tmp/wellen-villages.sql
//
// Two things about this site's chain the transcription has to keep:
//
//  - **The Preserve is two anchored terms, not "preserve".** The dashboard
//    assigns it on `isThePreserve !== -1 && isKensington === -1`, which was
//    transcribed literally as the term "preserve" with an exclude_term of
//    "kensington" (migration 052, the one user of that column). That was
//    safe on the old pipeline, where the terms only sorted an already
//    curated MLS_id_list into neighborhoods. It is not safe here: the
//    engine has no curated list, so the same term is a filter across
//    Venice, North Port and Englewood, and on the first discovery run it
//    swept in four Englewood listings -- HAMMOCKS PRESERVE, GRANDE PRESERVE
//    ON LEMON BAY, HAMMOCKS-PRESERVE -- with EAGLE PRESERVE ESTATES queued
//    behind them. None are Wellen Park.
//
//    Migration 056 replaces it with the two forms the site actually
//    carries: "preserve/west" (PRESERVE/WEST VLGS PH 1 and PH 2) and
//    "the preserve"
//    (12099 Firewheel Place, which the MLS filed under the bare name).
//    Checked against an export of the live HousesforSale collection:
//    all 153 rows match a village, The Preserve gets exactly its 3, and no
//    Englewood "preserve" subdivision is caught. The kensington exclusion
//    is kept on the longer term; it is redundant against both of these but
//    it is what the dashboard meant, and it costs nothing.
//
//    "preserve/west" rather than "preserve/west vlgs" because this MLS
//    writes both halves of that name out: RENAISSANCE/WEST VILLAGES PH 1
//    and RENAISSANCE/WEST VLGS PH 2 are the same neighborhood. Stopping at
//    "west" covers either spelling and still matches only these two.
//    "PRESERVE AT WEST VILLAGES" -- the third shape the MLS uses, as in
//    ISLANDWALK AT WEST VILLAGES -- is deliberately not covered: no listing
//    uses it today, and a term too narrow lands in the unmatched view, one
//    click from a fix, where one too wide takes someone else's listing
//    quietly.
//  - **The tag ternaries are ordered, first match wins.** Gran Paradiso is
//    in both the clubhouse list (third) and the villageSpa list (fifth), so
//    it gets the clubhouse, exactly as the site does today.

const SITE_DOMAIN = "lifeinwellenpark.com";
const PAGE = (slug) => `https://www.lifeinwellenpark.com/neighborhood/${slug}`;

// name -> [page slug, HousesforSale-DynamicPages item id (village1)]
// The slugs and ids are the dashboard code's own VillageURL / village1
// values; the 14 the site had listings for on 2026-07-02 were independently
// confirmed against its crawled homes-for-sale page.
const VILLAGES = {
  "Antigua": ["antigua", "3da0b109-4054-4e80-aa64-1e9fd11ea07e"],
  "Ashcombe": ["ashcombe", "38b44315-bb96-4c47-88d7-b89b65480cf3"],
  "Avelina": ["avelina", "034d43aa-b316-4199-b4c1-be082fa423d1"],
  "Boca Royale": ["boca-royale", "21190230-c3b5-4735-b1f9-5a20f8b6fe1b"],
  "Brightmore": ["brightmore", "89fdb57a-e457-4988-a402-fbe1960978d9"],
  "Everly": ["everly", "723118e6-1936-4a34-8c3a-03162b135544"],
  "Gran Paradiso": ["gran-paradiso", "2471b0cc-a6e7-47be-a7ba-22ab1619230a"],
  "Gran Place": ["gran-place", "601c8467-717f-4a21-83de-7f84816f67ff"],
  "Grand Palm": ["grand-palm", "63ec8952-9a69-4644-afab-4cc113bf9c37"],
  "IslandWalk": ["islandwalk", "20581e1d-4aca-4197-8a64-ffb5db681e34"],
  "Lakespur": ["lakespur", "39d1e0ea-844c-4d7e-a1d4-a1c1a477c515"],
  "Oasis": ["oasis", "f296ced6-c6bb-456f-93f8-f1fab44ade3a"],
  "Palmera": ["palmera", "50964b35-341c-4609-af82-78157f20a6fb"],
  "Renaissance": ["renaissance", "ebc8d3bc-11c9-4a83-a463-887afa38acc7"],
  "Sarasota National": ["sarasota-national", "3bd7e70f-0408-40f6-9e24-096109b26472"],
  "Solstice": ["solstice", "957506cf-de3a-4d97-83c7-e6131b2da1a7"],
  "Sunstone": ["sunstone", "6df4a9cf-b9cc-46a2-9ea0-2b3669f69dcb"],
  "The Preserve": ["the-preserve", "17e150c4-05db-4e86-b70d-0c3f49a17945"],
  "Tortuga": ["tortuga", "47fc45eb-81bc-49f6-bae9-ac3b6e3369b4"],
  // The dashboard writes this URL with the ampersand percent-encoded.
  "Wellen Park Country Club": ["wellen-park-golf-%26-country-club", "da9dd9b8-b3e4-40b3-9162-771dc9e345dc"],
  "Wysteria": ["wysteria", "c697df42-4347-4121-ac7e-a9a50835c69f"],
};

// The dashboard's search() terms, in its own order. Where two spellings map
// to one neighborhood the chain lists both (Gran/Grand Paradiso, Sarasota
// National/Sarasota N, Wellen Park Golf/Wellen Pk Golf).
const TERMS = {
  "antigua": "Antigua",
  "ashcombe": "Ashcombe",
  "avelina": "Avelina",
  "boca royale": "Boca Royale",
  "brightmore": "Brightmore",
  "everly": "Everly",
  "gran paradiso": "Gran Paradiso",
  "grand paradiso": "Gran Paradiso",
  "gran place": "Gran Place",
  "grand palm": "Grand Palm",
  "islandwalk": "IslandWalk",
  "lakespur": "Lakespur",
  "oasis": "Oasis",
  "palmera": "Palmera",
  "renaissance": "Renaissance",
  "sarasota national": "Sarasota National",
  "sarasota n": "Sarasota National",
  "solstice": "Solstice",
  "sunstone": "Sunstone",
  "preserve/west": "The Preserve",
  "the preserve": "The Preserve",
  "tortuga": "Tortuga",
  "wellen park golf": "Wellen Park Country Club",
  "wellen pk golf": "Wellen Park Country Club",
  "wysteria": "Wysteria",
};

/** term -> the subdivision text that takes the match back (the isKensington guard). */
const EXCLUSIONS = { "preserve/west": "kensington" };

const ICON = (path) => `https://static.wixstatic.com/media/${path}`;
const villageSpa = ICON("d0be81_c5146d6c05f045748f3f247b303b6328~mv2.png");
const maintenance = ICON("d0be81_876ff79d020e487784e082a441bd4d84~mv2.png");
const clubhouse = ICON("d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png");
const gated = ICON("d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png");
const dogPark = ICON("d0be81_9e082d4621b1411dad4efef57b55a033~mv2.png");
const scenicWalks = ICON("d0be81_8443577a57464e3bb5d27fe1a80f3c0f~mv2.png");
const kidsTotlot = ICON("d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png");
const tennis = ICON("d0be81_69220d35fef64735ab053df338ee0792~mv2.png");
const greenGolf2 = ICON("d0be81_a475422c6d434323bc793f973c6614ae~mv2.png");
const greenPickleball = ICON("d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png");
const fiftyFivePlus = ICON("d0be81_eb20d7968b4f44d1a6a2b12829e363d6~mv2.png");
const scenicView = ICON("d0be81_1e052bbc84164a3ebb11411e9b93d840~mv2.png");
const greenPlayground = ICON("d0be81_34c3ed762ada4f1da7b1b15908132e9f~mv2.png");

// Each tag's ternary chain as written, in order. First list a neighborhood
// appears in wins; a neighborhood in none gets "" and carries no tag.
const BLUE = [
  [["Wysteria", "Tortuga", "Gran Place", "Antigua", "Avelina"], maintenance],
  [["Lakespur"], kidsTotlot],
  [["Boca Royale", "Brightmore", "Everly", "Gran Paradiso", "Grand Palm", "IslandWalk", "Palmera", "Renaissance", "Sarasota National", "Solstice", "Sunstone", "The Preserve", "Ashcombe"], clubhouse],
  [["Oasis"], scenicWalks],
  // Gran Paradiso is here too, but the clubhouse list above already claimed it.
  [["Wellen Park Country Club", "Gran Paradiso"], villageSpa],
];
const PURPLE = [
  [["Boca Royale", "Gran Paradiso", "Grand Palm", "IslandWalk", "Renaissance", "Sarasota National", "Solstice", "Wellen Park Country Club"], tennis],
  [["Antigua", "Avelina", "Everly", "Gran Place", "Lakespur", "Oasis", "Palmera", "Sunstone", "The Preserve", "Tortuga", "Wysteria"], gated],
  [["Brightmore"], fiftyFivePlus],
];
const GREEN = [
  [["Brightmore", "Everly", "Gran Paradiso", "Grand Palm", "IslandWalk", "Oasis", "Palmera", "Renaissance", "Sunstone", "The Preserve", "Wysteria"], greenPickleball],
  [["Lakespur", "Solstice"], dogPark],
  [["Boca Royale", "Sarasota National", "Wellen Park Country Club"], greenGolf2],
  [["Avelina", "Antigua", "Gran Place"], scenicView],
  [["Tortuga"], greenPlayground],
];

const firstMatch = (chain, name) => chain.find(([names]) => names.includes(name))?.[1] ?? null;

export function wellenVillages() {
  const out = [];
  for (const [name, [slug, itemId]] of Object.entries(VILLAGES)) {
    // villageSortHelp is the neighborhood's own name on every row here.
    const display = { villageSortHelp: name };
    const blue = firstMatch(BLUE, name);
    const purple = firstMatch(PURPLE, name);
    const green = firstMatch(GREEN, name);
    if (blue) display.blueTag1 = blue;
    if (purple) display.purpleTag1 = purple;
    if (green) display.greenTag1 = green;
    const terms = Object.entries(TERMS)
      .filter(([, v]) => v === name)
      .map(([term]) => ({ term, exclude_term: EXCLUSIONS[term] ?? null }));
    if (!terms.length) throw new Error(`neighborhood ${name} has no term`);
    out.push({ name, slug, itemId, pageUrl: PAGE(slug), display, terms });
  }
  for (const v of Object.values(TERMS)) if (!VILLAGES[v]) throw new Error(`term points at unknown neighborhood ${v}`);
  for (const t of Object.keys(EXCLUSIONS)) if (!TERMS[t]) throw new Error(`exclusion is set on unknown term ${t}`);
  return out;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const qn = (s) => (s === null || s === undefined ? "NULL" : q(s));

export function wellenVillagesSql() {
  const villages = wellenVillages();
  const rows = villages.map((v) => `    (${q(v.name)}, ${q(v.slug)}, ${q(v.itemId)}, ${q(v.pageUrl)}, ${q(JSON.stringify(v.display))}::jsonb)`);
  const termRows = villages.flatMap((v) => v.terms.map((t) => `    (${q(v.name)}, ${q(t.term)}, ${qn(t.exclude_term)})`));
  return [
    `-- ${villages.length} neighborhoods, ${termRows.length} subdivision terms (scripts/listings-wellen-villages.mjs).`,
    `WITH site AS (SELECT id FROM ls_sites WHERE domain = ${q(SITE_DOMAIN)}),`,
    `village_rows(name, wix_slug, wix_item_id, page_url, display) AS (VALUES`,
    rows.join(",\n"),
    `)`,
    `INSERT INTO ls_villages (site_id, name, wix_slug, wix_item_id, page_url, display)`,
    `SELECT site.id, v.name, v.wix_slug, v.wix_item_id, v.page_url, v.display FROM village_rows v, site`,
    `ON CONFLICT (site_id, name) DO UPDATE SET wix_slug = EXCLUDED.wix_slug, wix_item_id = EXCLUDED.wix_item_id, page_url = EXCLUDED.page_url, display = EXCLUDED.display, updated_at = now();`,
    ``,
    `WITH site AS (SELECT id FROM ls_sites WHERE domain = ${q(SITE_DOMAIN)}),`,
    `term_rows(village_name, term, exclude_term) AS (VALUES`,
    termRows.join(",\n"),
    `)`,
    `INSERT INTO ls_village_terms (site_id, village_id, term, exclude_term)`,
    `SELECT site.id, v.id, t.term, t.exclude_term FROM term_rows t JOIN site ON true JOIN ls_villages v ON v.site_id = site.id AND v.name = t.village_name`,
    `ON CONFLICT DO NOTHING;`,
  ].join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.stdout.write(wellenVillagesSql() + "\n");
}
