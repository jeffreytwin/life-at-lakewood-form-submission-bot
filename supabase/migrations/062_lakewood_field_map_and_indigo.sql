-- ============================================================
-- 062: what the Life At Lakewood probe found
--
-- The probe finally ran on 2026-09-18 at 15:56, triggered by a push rather
-- than a Vercel variable, with the cron engine paused so the two would not
-- collide on the MLSGrid key. It scanned 111,289 Active listings in 557
-- requests over 469 s and found 6,804 in Lakewood Ranch, Bradenton and
-- Sarasota. Of those, 743 match a neighborhood term; 159 are new
-- construction and 205 are not Residential, both excluded, leaving about
-- 415 the engine would stage against the 404 rows the collection holds
-- today. LifeAtLakewoodListingPhotos resolved.
--
-- Two things came out of it, and one of them is the reason the probe exists.
--
-- ONE BAD TERM. "indigo" reaches INDIGO RIDGE AT UNIVERSITY PLACE. That is
-- University Place, a different master-planned community, and it would have
-- landed on this site's Indigo page -- the same failure "preserve" caused on
-- Wellen Park (migration 056), caught this time before a row staged.
--
-- The site's own twelve Indigo rows are all the bare name or a phase:
-- INDIGO, INDIGO PH I, INDIGO PH IV & V, INDIGO PH VI SUBPHASE 6A 6B & 6C,
-- INDIGO PH VI SUBPHASE 6B & 6C REP, INDIGO PH VII SUBPHASE 7A & 7B,
-- INDIGO PH VIII SUBPH 8A, 8B & 8C. So the term stays "indigo" and gains the
-- guard the dashboard never needed: not the one in University Place. That is
-- the same shape as Wellen Park's kensington exclusion, and it is written
-- against the community rather than against "indigo ridge" so a second
-- University Place spelling cannot slip past it.
--
-- The other five bare terms came back clean and are left alone: "cresswind"
-- reaches only CRESSWIND LAKEWOOD RANCH; "del webb" reaches Del Webb
-- Catalina at Lakewood Ranch (Parrish's Del Webb at Bayview is in Parrish,
-- which this site's city gate excludes); "lake club" and "palisades" match
-- nothing the site does not already show; and "aurora" reaches AURORA SUB,
-- which Jeff confirmed is this site's Aurora (2026-09-18). Two terms were
-- also confirmed that had been guesses -- "windward at lakewood" and
-- "windward/lakewood" both hit real spellings, so Windward is no longer
-- unconfirmed.
--
-- A SITE'S OWN FIELD NAMES. The probe also reported that the engine writes
-- four fields neither Lakewood collection has: villageSortHelp,
-- listingBrokerageContactInformation, lotSize, isPublished. Jeff's export
-- showed why -- three of them exist under this site's own older names:
--
--     engine                              Life At Lakewood
--     villageSortHelp                      villageSort
--     listingBrokerageContactInformation   listingBrokerContactInfo
--     lotSize                              lotSize      (Jeff added it)
--     isPublished                          isPublished  (Jeff added it)
--
-- This is the original site; its collection predates the engine. Its page
-- code reads those names, so writing the engine's names would put the data
-- in fields nothing renders: an empty neighborhood sort, and no brokerage
-- attribution, which the MLS requires be displayed.
--
-- ls_sites.field_map renames the engine's keys per site on the way out (see
-- transform.applyFieldMap). The alternative was adding the engine's names
-- alongside the site's, which is what Wellen Park did -- its collection
-- carries both `Listing Broker Contact Information` and
-- `listingBrokerageContactInformation`. That works and leaves two fields
-- meaning one thing, and the next site drifts its own way again. Jeff chose
-- the map (2026-09-18).
--
-- Every other site gets '{}' and is unaffected. `_id` can never be remapped:
-- applyFieldMap refuses it, because deleteStaleRows and loadOwnedIds both
-- match on it.
--
-- Applied to production via the Supabase MCP on 2026-09-18 as migration
-- listings_lakewood_field_map_and_indigo.
-- ============================================================

ALTER TABLE ls_sites
  ADD COLUMN IF NOT EXISTS field_map jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN ls_sites.field_map IS
  'The site''s own names for engine fields, where its collection differs: {"<engine key>": "<site key>"}. Applied by transform.applyFieldMap on the way to Wix. _id is never remapped.';

UPDATE ls_sites
   SET field_map = jsonb_build_object(
         'villageSortHelp', 'villageSort',
         'listingBrokerageContactInformation', 'listingBrokerContactInfo')
 WHERE domain = 'lifeatlakewood.com';

-- Indigo is this site's, unless it is University Place's.
WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeatlakewood.com')
UPDATE ls_village_terms t
   SET exclude_term = 'university place'
  FROM site, ls_villages v
 WHERE t.site_id = site.id AND v.id = t.village_id
   AND v.name = 'Indigo' AND t.term = 'indigo';
