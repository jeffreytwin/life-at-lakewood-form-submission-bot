-- ============================================================
-- 056: The Preserve is two anchored terms, not "preserve"
--
-- Caught on Life in Wellen Park's first discovery run, in shadow mode,
-- before anything reached a collection.
--
-- Migration 052 transcribed the dashboard's `isThePreserve !== -1 &&
-- isKensington === -1` literally: the term "preserve" with an exclude_term
-- of "kensington". That was a faithful port and still wrong here, for the
-- reason the Phase 5 notes predicted. The old pipeline pulled a curated
-- MLS_id_list and used its terms only to decide which neighborhood an
-- already-chosen listing belonged to. The engine has no such list: the same
-- term is a *filter* over every Active listing in Venice, North Port and
-- Englewood. So "preserve" stopped meaning "which of our neighborhoods is
-- this" and started meaning "is this ours at all".
--
-- What it swept in, within minutes of the site being switched on: all four
-- listings staged for Wellen Park were Englewood, and none were Wellen
-- Park's -- HAMMOCKS PRESERVE PH 01 and PH 14, HAMMOCKS-PRESERVE PHASE 14
-- BUILD, GRANDE PRESERVE ON LEMON BAY. EAGLE PRESERVE ESTATES was queued
-- behind them. 100% of the site's staged inventory was wrong.
--
-- THE REPLACEMENT, and how it was checked. Jeff exported the live
-- HousesforSale collection -- 153 rows, the ground truth for what this site
-- shows today -- and it files three listings under The Preserve:
--
--     PRESERVE/WEST VLGS PH 1
--     PRESERVE/WEST VLGS PH 2
--     THE PRESERVE            (12099 Firewheel Place, Venice)
--
-- So two terms, both anchored on a form the site actually carries:
--
--   'preserve/west'  -- and not 'preserve/west vlgs', because this MLS
--                       writes both halves of that name out in full:
--                       RENAISSANCE/WEST VILLAGES PH 1 and RENAISSANCE/WEST
--                       VLGS PH 2 are one neighborhood. Stopping at "west"
--                       covers either spelling and still matches only these
--                       two subdivisions.
--   'the preserve'   -- the bare name, which the MLS used for Firewheel
--                       Place. Across the site's three cities it matches
--                       that one subdivision and nothing else; the only
--                       other holder is THE PRESERVE/LONGBEACH on Longboat
--                       Key, which this site's city gate excludes anyway.
--
-- Longest-term-wins keeps them apart, and neither reaches an Englewood
-- "preserve". The kensington exclusion stays on 'preserve/west': redundant
-- against both of these, but it is what the dashboard meant and it costs
-- nothing.
--
-- Not covered, deliberately: "PRESERVE AT WEST VILLAGES", the third shape
-- this MLS uses (cf. ISLANDWALK AT WEST VILLAGES). No listing uses it
-- today. seed-villages.ts's rule applies -- a term too narrow lands in the
-- unmatched view, one click from a fix; one too wide takes someone else's
-- listing quietly.
--
-- VERIFIED against the 153-row export after the change: all 153 match a
-- village (up from 152), The Preserve gets exactly its 3, and no Englewood
-- "preserve" subdivision is caught. The one row that did not match before
-- was Firewheel Place.
--
-- Applied to production via the Supabase MCP on 2026-09-17 as migration
-- listings_wellen_preserve_terms.
-- ============================================================

WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeinwellenpark.com')
UPDATE ls_village_terms t
   SET term = 'preserve/west'
  FROM site, ls_villages v
 WHERE t.site_id = site.id AND v.id = t.village_id
   AND v.name = 'The Preserve' AND t.term = 'preserve';

WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeinwellenpark.com')
INSERT INTO ls_village_terms (site_id, village_id, term)
SELECT site.id, v.id, 'the preserve'
  FROM site JOIN ls_villages v ON v.site_id = site.id AND v.name = 'The Preserve'
ON CONFLICT DO NOTHING;
