#!/usr/bin/env node
// Emits the SQL that seeds Life At Lakewood's neighborhoods, subdivision
// terms and tag icons into ls_villages / ls_village_terms. Run once to
// produce the data block of supabase/migrations/058_lakewood_villages.sql;
// afterwards the Hub's Neighborhoods page is the place to change terms.
//
//   node scripts/listings-lakewood-villages.mjs > /tmp/lakewood-villages.sql
//
// TWO SOURCES, and they agree. The names, page URLs, `village1` ids,
// villageSortHelp values and the three tag icons are the site's dashboard
// page code -- the `subDivisionName.search(...)` chain in $w.onReady and the
// tag ternaries in setDataObject. Every one of them was then checked against
// an export of the live HousesforSale collection (404 rows, 2026-09-17):
// each neighborhood carries exactly one blue/purple/green icon across its
// listings, and each icon is the constant the ternary names. The four
// neighborhoods with no listing today are the only ones the export cannot
// confirm, and they are marked below.
//
// THE TERMS ARE NOT A TRANSCRIPTION. That is the whole point of this file,
// and the reason it is longer than the Wellen Park one.
//
// The old pipeline pulled a curated MLS_id_list and used the dashboard's
// terms only to decide which neighborhood an already-chosen listing belonged
// to. The engine has no such list: the same term is a *filter* over every
// Active listing in Lakewood Ranch, Bradenton and Sarasota. On Life in
// Wellen Park the literal transcription of one such term ("preserve") put
// four Englewood listings on the site within minutes of switch-on (migration
// 056). This market is roughly five times the size, and the dashboard chain
// leans on single generic words.
//
// So every term here was tested. Two tests, one available now and one that
// needs the market:
//
//   1. **Against the site's own 404 rows.** A term set is only correct if it
//      files all 404 exactly where the site files them today. Checked on
//      every change; the narrowings below all pass 404/404.
//   2. **Against the MLS, for what else it would sweep in.** A term can be
//      perfect on the site's own listings and still catch a stranger's. The
//      engine already holds 6,164 listings in five OTHER cities (Venice,
//      North Port, Englewood, Parrish, Longboat Key), and nine of the
//      dashboard's terms collide there already:
//
//        isles       21 subdivisions  ALAMEDA ISLES, ENGLEWOOD ISLES, LEMON BAY ISLES
//        del webb     5               DEL WEBB AT BAYVIEW, DEL WEBB SUNCHASE (Parrish)
//        emerald      2               EMERALD HARBOR, EMERALD POINTE SOUTH
//        edgewater    1               EDGEWATER CENTER
//        esplanade    1               ESPLANADE AT WELLEN PARK
//        lake club    1               PINEBROOK LAKE CLUB
//        riverwalk    1               RIVERWALK MHP CO-OP
//        sweetwater   1               SWEETWATER VILLAS AT SOUTHWOOD
//        windward     1               WINDWARD BAY AMD
//
//      Those are five cities this site does not even cover, so the count is
//      a floor, not a measure. scripts/listings-lakewood-probe.ts runs the
//      real test against Lakewood Ranch, Bradenton and Sarasota before
//      anything is seeded.
//
// THE RULE USED HERE. Narrow a term wherever the export proves every MLS
// spelling of that neighborhood carries an anchor; leave it bare where the
// MLS writes the name with nothing to anchor to. The asymmetry is the
// reason: a term too narrow leaves a listing in the unmatched view, one
// click from a fix, while a term too wide puts someone else's house on the
// site quietly. The bare ones are listed in BARE_TERMS below and are what
// the probe exists to check.

const SITE_DOMAIN = "lifeatlakewood.com";

// name -> [page path, Villages-collection item id (village1)]
// Both are the dashboard code's own VillageURL / village1 values. The 37
// neighborhoods that have a listing today were confirmed against the export,
// which carries the same id and link on every row.
const VILLAGES = {
  "Arbor Grande": ["arbor-grande", "107fa313-ad7f-42c1-90c9-7c964dd37c7e"],
  "Aurora": ["aurora", "cad6ac3f-5e35-4078-a4cd-9afe1d6ea60e"],
  "Avalon Woods": ["avalon-woods", "216a3208-8f23-4eaa-9af0-726792f205c9"],
  "Azario - Esplanade": ["azario-esplanade", "8e57d32f-c8ec-44d1-9027-04a6dddee749"],
  "Azario - Park East": ["azario-park-east", "935d19a3-2a46-464f-8553-71a220c4c4b7"],
  "Bridgewater": ["bridgewater", "959e7850-a310-401b-b137-cad7e57bcdfa"],
  "Central Park": ["central-park", "042aeeb9-6363-40e6-8b65-3c2a1bb7c0b2"],
  "Country Club East": ["country-club-east", "c5b82142-2550-40f5-9ce2-74b701619455"],
  "Cresswind": ["cresswind", "b64fa510-088f-4799-ba71-a26e5e1a8d6d"],
  "Del Webb": ["del-webb", "861eb358-8673-4cac-9c45-5299f9201079"],
  "Edgewater": ["edgewater", "b88749df-4c7f-4632-8eef-f92564e86e16"],
  "Esplanade Golf & Country Club": ["esplanade-golf-and-country-club", "d333f9b6-61dd-4f9e-a4c9-31eda20d4e2b"],
  "Greenbrook Village": ["greenbrook-village", "848b5723-347c-4457-95d9-f5dc989363a6"],
  "Harmony": ["harmony", "0a7da735-4136-4a98-9d4b-2631293bba0e"],
  "Indigo": ["indigo", "224cc2b4-5375-4acd-bfdc-2956be570350"],
  "Lakewood National": ["lakewood-national", "f79f9fce-77b8-4f1b-b145-3b4bddaa016c"],
  "Lorraine Lakes": ["lorraine-lakes", "86da6c3e-3055-4b22-9ce5-c312bb63a046"],
  "Mallory Park": ["mallory-park", "2f752a9d-68e2-47df-8bb2-d43897def90a"],
  "Palisades": ["palisades", "1ce48cc7-fd95-4621-8532-4f371752ed54"],
  "Polo Run": ["polo-run", "cb44f492-711e-46ac-9b14-94a884cd2148"],
  // Riverwalk is NOT a neighborhood of its own here; see SUMMERFIELD below.
  "Sapphire Point": ["sapphire-point", "df7652e1-8e7b-4804-bf8c-70b0e1262868"],
  "Savanna": ["savanna", "fd4f3104-77c3-4f02-953e-fde4dba58ec4"],
  "Solera": ["solera", "849b17da-ccf0-407c-a850-42b2650e6eb7"],
  "Star Farms": ["star-farms", "d0285478-446b-408f-8e64-67720f4599d7"],
  // SUMMERFIELD carries Riverwalk's terms as well as its own, and there is a
  // decision inside that worth knowing about.
  //
  // The dashboard treats them as two neighborhoods -- two blocks, two
  // Village texts, two villageSortHelp values -- but writes THE SAME
  // VillageURL and THE SAME village1 for both, and the page they share is
  // called "summerfield-and-riverwalk". One Villages row, two labels.
  //
  // The engine cannot hold that. ls_villages has a unique index on
  // (site_id, wix_item_id), and it is not arbitrary: village-stats.ts writes
  // each neighborhood's active count, price range, square footage and
  // bedroom range back to its Villages row, and two neighborhoods pointing
  // at one row would race, each overwriting the other with half the picture.
  // One row, one neighborhood.
  //
  // So they are one neighborhood here, named Summerfield, holding the terms
  // for both. What changes: the two RIVERWALK listings (RIVERWALK RIDGE and
  // RIVERWALK VILLAGE CYPRESS BANKS) carry village "Summerfield" rather than
  // "Riverwalk", and the site's filter loses "Riverwalk" as an option. The
  // other 13 are untouched, the shared page is unaffected, and its stats get
  // all 15 listings rather than 13.
  //
  // Put to Jeff on 2026-09-18 and confirmed: fold it in. It stays
  // reversible -- a real Riverwalk row in HousesforSale-DynamicPages, with
  // its own id, makes it two neighborhoods again and costs one migration,
  // and scripts/listings-lakewood-probe.ts lists that collection, so the
  // first run of it says whether such a row already exists.
  "Summerfield": ["summerfield-and-riverwalk", "5a88ccbb-3ebf-4545-87bb-4e1599415b0e"],
  "Sweetwater": ["sweetwater", "b963c227-7acb-47e1-a81b-31c29cfe7007"],
  "The Country Club": ["country-club", "39b23fe1-5893-4b62-a2aa-cf87e0df6694"],
  "The Isles": ["the-isles", "b44fc9cf-68cb-4abd-aec9-bcae4f829875"],
  "The Lake Club": ["the-lake-club", "9dfd1bad-e515-4cdb-b73b-d4f122b00bcc"],
  "Waterside - Avanti": ["waterside-avanti", "546e31bc-56ff-451f-93fa-6c9487261d68"],
  "Waterside - Emerald Landing": ["waterside-emerald-landing", "5ee249ae-9ee9-4481-b1e1-430fb96b8f7c"],
  "Waterside - LakeHouse Cove": ["waterside-lakehouse-cove", "65a10f06-4ee7-4f40-a7fd-35dd80a9fded"],
  "Waterside - Nautique": ["waterside-nautique", "b6cc0bcb-5bfd-47ca-930a-b64420a09493"],
  "Waterside - Shellstone": ["waterside-shellstone", "1b62edcc-23fc-45c2-9f7b-63bf9fcc4efd"],
  "Waterside - Shoreview": ["waterside-shoreview", "123379b1-1f66-4f08-af66-3c71917db022"],
  "Waterside - The Alcove": ["waterside-the-alcove", "2e8a6259-2bbd-4000-ac8d-f019d8329d3f"],
  "Waterside - Wild Blue": ["waterside-wild-blue", "d66b8553-79bf-4d53-8d48-7e8d145a1d0f"],
  "Windward": ["windward", "607ac859-6946-459e-868b-b32f590ec4d0"],
  "Woodleaf Hammock": ["woodleaf-hammock", "8dbceaba-b54a-4b58-b85a-4690d3b1c28b"],
};

/** Neighborhoods the 404-row export has no listing for: names, ids, tags and
 *  terms are the dashboard's word alone, and their terms are guesses at a
 *  spelling this MLS has never shown us. Deliberately narrow. */
const UNCONFIRMED = ["Waterside - The Alcove", "Windward", "Waterside - Shellstone", "Palisades"];

// term -> neighborhood. Every term is lowercase and matched with `includes`
// against the subdivision, longest term winning (see classify.matchVillage).
//
// Where a term differs from the dashboard's, the dashboard's word is in the
// comment with the reason. Where it is the same, the MLS gives nothing to
// anchor to -- see BARE_TERMS.
const TERMS = {
  // -- anchored by the export: every MLS spelling carries the anchor --------
  "harmony at lakewood": "Harmony", //            was "harmony"; all 16 rows are HARMONY AT LAKEWOOD RANCH
  "isles at lakewood ranch": "The Isles", //      was "isles"; 21 other-market subdivisions hold that word
  "savanna at lakewood": "Savanna", //            was "savanna"
  "solera at lakewood": "Solera", //              was "solera"
  "lakewood ranch solera": "Solera", //           the other spelling the MLS uses for it
  "sweetwater at lakewood": "Sweetwater", //      was "sweetwater"; cf. SWEETWATER VILLAS AT SOUTHWOOD
  "sweetwater villas at lakewood": "Sweetwater",
  "bridgewater ph": "Bridgewater", //             was "bridgewater"; the MLS writes BRIDGEWATER PH I AT LAKEWOOD RANCH
  "lakewood national": "Lakewood National",
  "lakewood natl": "Lakewood National", //        the dashboard's two abbreviations, kept
  "lakewood ntl": "Lakewood National",

  // -- anchored by the name's own second word -------------------------------
  "edgewater village": "Edgewater", //            was "edgewater"; cf. EDGEWATER CENTER
  "moorings at edgewater": "Edgewater", //        the other two rows the site files under Edgewater
  "summerfield hollow": "Summerfield", //         was "summerfield"
  "summerfield village": "Summerfield",
  "riverwalk ridge": "Summerfield", //             was "riverwalk" -> Riverwalk; cf. RIVERWALK MHP CO-OP
  "riverwalk village": "Summerfield", //           and Riverwalk is Summerfield now, see VILLAGES
  "central park subphase": "Central Park", //     was "central park"
  "central park lakewood": "Central Park", //     CENTRAL PARK  LAKEWOOD RANCH -- both spacings, the
  "central park  lakewood": "Central Park", //    MLS wrote a double space and nothing collapses it

  // -- Esplanade: the hardest one on the site -------------------------------
  // The dashboard says `search("esplanade") !== -1 && search("azario") === -1`.
  // Esplanade is a Taylor Morrison brand name, not a place: this MLS already
  // has ESPLANADE AT WELLEN PARK in another market, and Sarasota -- which IS
  // in this market -- carries Esplanade communities of its own. So the bare
  // word cannot be the filter. These six cover 21 of the 22 rows the site
  // files under it; the exception is one row whose subdivision is the single
  // word ESPLANADE, which no anchored term can reach and which will land in
  // the unmatched view where it can be looked at.
  //
  // "esplanade ph" works because an Esplanade elsewhere is written
  // <NAME> <PLACE> PH <n>, so its phase marker never follows the brand
  // directly. The azario exclusion is kept on all of them: redundant,
  // because "azario esplanade" is the longer term and wins anyway, but it is
  // what the dashboard meant.
  "esplanade ph": "Esplanade Golf & Country Club",
  "esplanade phase": "Esplanade Golf & Country Club", // 0579900; ESPLANADE PHASE I; LOT 110; PB 55/11
  "esplanade golf": "Esplanade Golf & Country Club",
  "esplanade at lakewood": "Esplanade Golf & Country Club",
  "esplanade lakewood": "Esplanade Golf & Country Club",
  "bacciano": "Esplanade Golf & Country Club", //  the condo names inside it

  // -- The Country Club: "country club village" dropped ---------------------
  // The dashboard matches on three terms. Two of them cover all 40 rows the
  // site files here; the third, "country club village", covers nothing they
  // do not and would match any "... COUNTRY CLUB VILLAGE" in Bradenton or
  // Sarasota. Dropped rather than transcribed.
  "lakewood ranch country club": "The Country Club",
  "lakewood ranch cc": "The Country Club", //      covers LAKEWOOD RANCH CC and CCV
  "country club east": "Country Club East", //     longest-wins keeps this off the ... COUNTRY CLUB EAST
  //                                                BELLEISLE row, which the site files under The Country Club

  // -- Waterside: both spellings the MLS uses -------------------------------
  "avanti at waterside": "Waterside - Avanti", //  was "avanti"
  "avanti/waterside": "Waterside - Avanti",
  "emerald lndg": "Waterside - Emerald Landing", // was "emerald"; cf. EMERALD HARBOR, EMERALD POINTE
  "emerald landing": "Waterside - Emerald Landing", // the spelled-out form, not seen yet
  "lakehouse cove": "Waterside - LakeHouse Cove",
  "nautique": "Waterside - Nautique",
  "shellstone": "Waterside - Shellstone",
  "shoreview": "Waterside - Shoreview",
  "wild blue": "Waterside - Wild Blue",
  "alcove at waterside": "Waterside - The Alcove", // was "alcove"; no listing has ever shown the spelling
  "alcove/waterside": "Waterside - The Alcove",
  "windward at lakewood": "Windward", //           was "windward"; cf. WINDWARD BAY AMD on Longboat Key
  "windward/lakewood": "Windward",

  // -- Azario, both neighborhoods ------------------------------------------
  "azario esplanade": "Azario - Esplanade",
  "esplanade at azario": "Azario - Esplanade",
  "azario lakewood ranch": "Azario - Esplanade",
  "park east at azario": "Azario - Park East",

  // -- distinctive already: two-word names this MLS uses for one place ------
  "arbor grande": "Arbor Grande",
  "avalon woods": "Avalon Woods",
  "greenbrook": "Greenbrook Village", //           GREENBROOK VILLAGE, GREENBROOK WALK, GREENBROOK RIVERS
  "lorraine lakes": "Lorraine Lakes",
  "mallory park": "Mallory Park",
  "polo run": "Polo Run",
  "sapphire point": "Sapphire Point",
  "star farms": "Star Farms", //                   also covers the MLS's STAR FARMSPH V-SUB typo
  "woodleaf hammock": "Woodleaf Hammock",
  "cresswind": "Cresswind",

  // -- bare, because the MLS gives nothing to anchor to ---------------------
  "aurora": "Aurora", //                           every row's subdivision is the single word AURORA
  "del webb": "Del Webb", //                       DEL WEBB, DEL WEBB PH I-A ... a national brand name
  "indigo": "Indigo",
  "lake club": "The Lake Club", //                 cf. PINEBROOK LAKE CLUB in Venice
  "palisades": "Palisades",
};

/** The terms no anchor was available for. The probe reports what each one
 *  would sweep in across Lakewood Ranch, Bradenton and Sarasota; a term that
 *  catches a stranger gets narrowed before the site is seeded. */
export const BARE_TERMS = ["aurora", "del webb", "indigo", "lake club", "palisades", "cresswind"];

/** term -> subdivision text that takes the match back (classify's exclude_term). */
const EXCLUSIONS = {
  "esplanade ph": "azario",
  "esplanade phase": "azario",
  "esplanade golf": "azario",
  "esplanade at lakewood": "azario",
  "esplanade lakewood": "azario",
};

// The tag icons, exactly as the dashboard's constants write them -- some
// carry a /v1/fit/ rendition and some do not, and the export shows the site
// stores whichever the constant says. Names are the dashboard's variables.
const ICON = (id, fit) =>
  fit
    ? `https://static.wixstatic.com/media/${id}~mv2.png/v1/fit/w_924,h_520/${id}~mv2.png`
    : `https://static.wixstatic.com/media/${id}~mv2.png`;
/** The dashboard's icon constants, by its own variable names. */
export const ICONS = {
  villageSpa: ICON("d0be81_b31fc860894445a89f08c3fb8b530e34", true),
  maintenance: ICON("d0be81_4f9303a511cc42fa986017d290513167", false),
  clubhouse: ICON("d0be81_aae6b9125c784fffbe6b679d403c01d6", true),
  gated: ICON("d0be81_1f03e4c773b540359c5228a34fcf0ff3", true),
  dogPark: ICON("d0be81_2ce27035a8414b3985909fd0b3060f29", true),
  scenicWalks: ICON("d0be81_62b3be4d3f8b4d09ab6f1e14225c7349", true),
  kidsTotlot: ICON("d0be81_da59bb5bd8b841f28d2166013b0a68d1", true),
  totLot: ICON("d0be81_1404b3ad1f824281a42918207217e9a9", true),
  tennis: ICON("d0be81_0342a27fc9e14170b51b20affba893aa", true),
  greenTennis: ICON("d0be81_34fcb186a4a54099911cf64a9ec80359", true),
  greenGolf2: ICON("d0be81_ba68daa783d14ab68ac7dc7082fa3d63", false),
  villagePool: ICON("d0be81_51600c69200340bf92f94d78f4f47d60", false),
  scenicViews: ICON("d0be81_a065767388d54189879749c19953381f", false),
  greenPickleball: ICON("d0be81_2212bb342e44447a9ecc8ca4951b6a01", true),
};
const {
  villageSpa, maintenance, clubhouse, gated, dogPark, scenicWalks, kidsTotlot,
  totLot, tennis, greenTennis, greenGolf2, villagePool, scenicViews, greenPickleball,
} = ICONS;
const iconKey = (url) => Object.entries(ICONS).find(([, v]) => v === url)?.[0] ?? null;

// Each tag's ternary chain as written, in order: the first list a
// neighborhood appears in wins, and one in no list carries no tag. All three
// chains were replayed against the export -- every one of the 404 rows
// carries the icon these produce.
const BLUE = [
  [["Waterside - Avanti", "Aurora"], maintenance],
  [["Windward", "Avalon Woods"], kidsTotlot],
  [["Bridgewater", "Del Webb", "Lorraine Lakes", "Waterside - Nautique", "Summerfield", "Edgewater", "Waterside - The Alcove", "Woodleaf Hammock"], scenicWalks],
  [["Azario - Park East", "Country Club East", "Harmony", "Indigo", "Lakewood National", "Mallory Park", "Palisades", "Polo Run", "Sapphire Point", "Savanna", "Solera", "Star Farms", "Sweetwater", "The Isles", "Waterside - Emerald Landing", "Waterside - Shoreview", "Cresswind", "Waterside - LakeHouse Cove", "Waterside - Wild Blue", "Waterside - Shellstone"], clubhouse],
  [["Arbor Grande", "Central Park", "Esplanade Golf & Country Club", "Greenbrook Village", "The Country Club", "Azario - Esplanade", "The Lake Club"], villageSpa],
];
const PURPLE = [
  [["Esplanade Golf & Country Club", "Greenbrook Village", "Star Farms", "Waterside - Shoreview", "Waterside - LakeHouse Cove", "Azario - Esplanade", "Windward", "Waterside - Emerald Landing", "Waterside - Wild Blue", "Waterside - Shellstone"], tennis],
  [["Azario - Park East", "Harmony", "Indigo", "Lorraine Lakes", "Waterside - Nautique", "Solera", "Summerfield", "Sweetwater", "Aurora", "Woodleaf Hammock"], totLot],
  [["Arbor Grande", "Bridgewater", "Central Park", "Country Club East", "Del Webb", "Edgewater", "Lakewood National", "Mallory Park", "Palisades", "Polo Run", "Sapphire Point", "Savanna", "The Country Club", "The Isles", "Cresswind", "The Lake Club"], gated],
];
const GREEN = [
  [["Del Webb", "Indigo", "Mallory Park", "The Lake Club", "Waterside - Shoreview", "Star Farms", "Sweetwater", "Waterside - LakeHouse Cove", "Waterside - Nautique", "Cresswind", "Windward", "Waterside - Wild Blue", "Waterside - Shellstone"], greenPickleball],
  [["Central Park", "Lorraine Lakes", "Polo Run", "Summerfield", "The Isles"], greenTennis],
  [["Bridgewater"], scenicViews],
  [["Solera", "Azario - Park East", "Harmony", "Palisades", "Aurora"], villagePool],
  [["Arbor Grande", "Greenbrook Village", "Sapphire Point", "Savanna", "Waterside - Emerald Landing", "Woodleaf Hammock"], dogPark],
  [["Country Club East", "Esplanade Golf & Country Club", "Azario - Esplanade", "Lakewood National", "The Country Club"], greenGolf2],
];

/** The dashboard's villageSortHelp, which is the neighborhood's own name
 *  except where the site sorts it under a different word. */
const SORT_HELP = {
  "Azario - Esplanade": "Esplanade - Azario",
  "Azario - Park East": "Park East - Azario",
  "Esplanade Golf & Country Club": "Original Esplanade",
  "Waterside - Avanti": "Avanti - Waterside",
  "Waterside - Emerald Landing": "Emerald Landing - Waterside",
  "Waterside - LakeHouse Cove": "LakeHouse Cove - Waterside",
  "Waterside - Nautique": "Nautique - Waterside",
  "Waterside - Shellstone": "Shellstone - Waterside",
  "Waterside - Shoreview": "Shoreview - Waterside",
  "Waterside - The Alcove": "The Alcove - Waterside",
  "Waterside - Wild Blue": "Wild Blue - Waterside",
};

const PAGE = (slug) => `https://www.lifeatlakewood.com/${slug}`;
const firstMatch = (chain, name) => chain.find(([names]) => names.includes(name))?.[1] ?? null;

export function lakewoodVillages() {
  const out = [];
  for (const [name, [slug, itemId]] of Object.entries(VILLAGES)) {
    const display = { villageSortHelp: SORT_HELP[name] ?? name };
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
    out.push({ name, slug, itemId, pageUrl: PAGE(slug), display, terms, unconfirmed: UNCONFIRMED.includes(name) });
  }
  for (const v of Object.values(TERMS)) if (!VILLAGES[v]) throw new Error(`term points at unknown neighborhood ${v}`);
  for (const t of Object.keys(EXCLUSIONS)) if (!TERMS[t]) throw new Error(`exclusion is set on unknown term ${t}`);
  for (const t of BARE_TERMS) if (!TERMS[t]) throw new Error(`BARE_TERMS names a term that is not in the set: ${t}`);
  for (const n of UNCONFIRMED) if (!VILLAGES[n]) throw new Error(`UNCONFIRMED names an unknown neighborhood: ${n}`);
  return out;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const qn = (s) => (s === null || s === undefined ? "NULL" : q(s));

export function lakewoodVillagesSql() {
  const villages = lakewoodVillages();
  // The icons are named rather than repeated: three of these URLs are 200
  // characters and would otherwise appear 120 times between them, which
  // makes the one thing worth reading here -- which neighborhood carries
  // which tag -- the hardest thing to see.
  const iconRows = Object.entries(ICONS).map(([key, url]) => `    (${q(key)}, ${q(url)})`);
  const rows = villages.map((v) => {
    const cell = (field) => qn(v.display[field] ? iconKey(v.display[field]) : null);
    return `    (${q(v.name)}, ${q(v.slug)}, ${q(v.itemId)}, ${q(v.pageUrl)}, ${q(v.display.villageSortHelp)}, ${cell("blueTag1")}, ${cell("purpleTag1")}, ${cell("greenTag1")})`;
  });
  const termRows = villages.flatMap((v) => v.terms.map((t) => `    (${q(v.name)}, ${q(t.term)}, ${qn(t.exclude_term)})`));
  return [
    `-- ${villages.length} neighborhoods, ${termRows.length} subdivision terms (scripts/listings-lakewood-villages.mjs).`,
    `WITH site AS (SELECT id FROM ls_sites WHERE domain = ${q(SITE_DOMAIN)}),`,
    `icon(key, url) AS (VALUES`,
    iconRows.join(",\n"),
    `),`,
    `village_rows(name, wix_slug, wix_item_id, page_url, sort_help, blue, purple, green) AS (VALUES`,
    rows.join(",\n"),
    `)`,
    `INSERT INTO ls_villages (site_id, name, wix_slug, wix_item_id, page_url, display)`,
    `SELECT site.id, v.name, v.wix_slug, v.wix_item_id, v.page_url,`,
    `       jsonb_strip_nulls(jsonb_build_object('villageSortHelp', v.sort_help, 'blueTag1', b.url, 'purpleTag1', p.url, 'greenTag1', g.url))`,
    `  FROM village_rows v`,
    `  CROSS JOIN site`,
    `  LEFT JOIN icon b ON b.key = v.blue`,
    `  LEFT JOIN icon p ON p.key = v.purple`,
    `  LEFT JOIN icon g ON g.key = v.green`,
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
  process.stdout.write(lakewoodVillagesSql() + "\n");
}
