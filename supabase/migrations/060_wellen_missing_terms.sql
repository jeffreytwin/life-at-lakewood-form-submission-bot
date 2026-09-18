-- ============================================================
-- 060: three subdivisions Wellen Park's terms could not reach
--
-- Found by checking the site's staged inventory against a Redfin export
-- Jeff pulled on 2026-09-18 with his own filters -- 171 rows, of which 167
-- come from Stellar MLS via MLS Grid and are therefore the same feed the
-- engine reads. Redfin's MLS# is our listing_id without the MFR prefix.
--
-- The two lists agree almost exactly, and where they differ the reason is
-- usually not ours:
--
--     167  Redfin rows from MLS Grid
--     167  of those the engine holds, all Active          <- nothing missing from the feed
--     154  of those staged or live on Life in Wellen Park
--      13  Redfin has, the site does not
--       2  the site has, Redfin does not  (BOCA ROYALE EAST UNIT 20)
--
-- Seven of the thirteen are other communities Redfin's map polygon happens
-- to cover: five in Plantation Golf & Country Club (BERMUDA CLUB EAST AT
-- PLANTATION, BUCKINGHAM MEADOWS x2, KENWOOD GLEN 1 OF ST ANDREWS E, ST
-- ANDREWS ESTS/PLANTATION) and two in Oak Forest, Englewood. The site is
-- right to leave those out. Two more -- THE RESERVE, on Tremingham Way --
-- are a judgement call for Jeff, not a defect: they sit in their own enclave
-- between Gran Paradiso and Plantation, and the site has no such
-- neighborhood. Worth recording that the terms held the line there: THE
-- RESERVE is one letter from The Preserve's 'the preserve', and a looser
-- term would have put two seven-figure homes on the wrong neighborhood page.
--
-- That leaves four the site should arguably show, and three of them are
-- fixed here. All four are resales; new construction is excluded on every
-- site (classify.ts, Jeff 2026-09-16), which is also what Jeff's Redfin
-- filter does -- 76 of the 78 Venice "wellen" listings the site does not
-- show are builder inventory, and both lists drop them.
--
-- 1 & 2. COACH HOMES II AT WELLEN PARK, PH 2   (12660 Radiance Court)
--        VERANDA III/WELLEN PARK PH I          (17475 Opal Sand Drive)
--
-- Both say WELLEN PARK in the subdivision, and both sit inside Wellen Park
-- Golf & Country Club -- 0.12 and 0.06 miles from a listing the site already
-- shows under that neighborhood. They are the club's attached product
-- (Terrace, Veranda, Coach Homes), and the terms only reached its
-- single-family spellings, 'wellen park golf' and 'wellen pk golf'.
--
-- The obvious repair -- a bare 'wellen park' term -- is the one that must
-- not be made. Longest-term-wins compares term lengths, and 'wellen park'
-- (11) beats 'brightmore' (10), 'sunstone' (8), 'lakespur' (8), 'palmera'
-- (7) and 'antigua' (7). It would quietly move BRIGHTMORE AT WELLEN PARK,
-- SUNSTONE AT WELLEN PARK and every other "<neighborhood> AT WELLEN PARK"
-- onto the country club's page. So the terms stay on the product names,
-- each checked against every subdivision the engine holds:
--
--     'veranda'      -- one subdivision in the whole database, this one.
--     'coach homes'  -- five, of which three are Gran Paradiso's
--                       (COACH HOMES 1 AT GRAN PARADISO, COACH HOMES 3 and
--                       4/GRAN PARADISO PH). Longest-wins would settle it,
--                       'gran paradiso' being 13 to 'coach homes' 11, but
--                       the exclusion says so outright rather than relying
--                       on an arithmetic accident two edits from now.
--
-- Also added, and free: 'wellen park g', which covers WELLEN PARK G & CC
-- alongside the spellings 'wellen park golf' already caught, and 'wellen
-- golf' for WELLEN GOLF & COUNTRY CLUB. Both match only this club's
-- spellings. Neither changes a row today -- every listing under them is
-- currently a lease or a builder listing -- but they are the shapes this MLS
-- has already shown us, and the next resale under one would otherwise be a
-- second round of this same fix. Still not covered, deliberately: a
-- double-space 'WELLEN  GOLF & COUNTRY CLUB' and the Terrace spellings
-- (TERRACE 11/WELLEN PK, TER III/WELLEN PK, WELLEN PK PH I TER I). A term
-- narrow enough to catch those is a transcription of one row each; they hold
-- no resale today and land in the unmatched view if they ever do.
--
-- 3. ENGLEWOOD GOLF COURSE  (84 Cayman Isles Boulevard)
--
-- Boca Royale under the name the club carried before it was Boca Royale.
-- All four of its nearest listings are Boca Royale, the closest being 11
-- Cayman Isles Boulevard at 0.15 miles -- the same street. 'englewood golf
-- course' matches this one subdivision in the whole database.
--
-- NOT fixed here: ENGLEWOOD GOLF VILLAS 11 (5 Barbados Road), the fourth.
-- The name and the street both fit Boca Royale's Caribbean pattern, but its
-- neighbours do not: HEBBLEWHITE COURT at 0.08 miles and OAK GROVE on
-- Englewood Road at 0.15, with the nearest Boca Royale listing 0.35 miles
-- off at the community's entrance boulevard. That is consistent with being
-- just outside the gates and equally consistent with being just inside
-- them, and a term of 'englewood golf' rather than 'englewood golf course'
-- is the only difference. Left for Jeff, who knows the ground.
--
-- VERIFIED after applying: the site goes 156 -> 159, the three listings land
-- on Wellen Park Country Club (x2) and Boca Royale (x1), and no other
-- listing changes neighborhood. Every resale Active Residential listing in
-- Venice, North Port or Englewood whose subdivision names Wellen Park or
-- Boca Royale is now on the site, except Englewood Golf Villas above.
--
-- Applied to production via the Supabase MCP on 2026-09-18 as migration
-- listings_wellen_missing_terms.
-- ============================================================

WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeinwellenpark.com')
INSERT INTO ls_village_terms (site_id, village_id, term, exclude_term)
SELECT site.id, v.id, t.term, t.exclude_term
  FROM site
  JOIN ls_villages v ON v.site_id = site.id AND v.name = 'Wellen Park Country Club'
  CROSS JOIN (VALUES
    ('veranda',       NULL),
    ('coach homes',   'gran paradiso'),
    ('wellen park g', NULL),
    ('wellen golf',   NULL)
  ) AS t(term, exclude_term)
ON CONFLICT DO NOTHING;

WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeinwellenpark.com')
INSERT INTO ls_village_terms (site_id, village_id, term)
SELECT site.id, v.id, 'englewood golf course'
  FROM site JOIN ls_villages v ON v.site_id = site.id AND v.name = 'Boca Royale'
ON CONFLICT DO NOTHING;
