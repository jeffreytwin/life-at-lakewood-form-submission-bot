-- ============================================================
-- 057: Life At Lakewood onboarding (the site row)
--
-- The fourth listings site, and the largest by every measure: 404 listings
-- in its live collection against Parrish's 276 and Longboat Key's 199, 40
-- neighborhoods against Wellen Park's 22, and a market of three cities that
-- are not a master-planned community but two whole cities plus a CDP.
--
-- THE MARKET. Jeff, 2026-09-17: Lakewood Ranch, Bradenton, Sarasota. The
-- export of the live collection agrees and shows why all three are needed --
-- of its 404 rows, 250 are filed under Bradenton, 130 under Lakewood Ranch
-- and 24 under Sarasota. Lakewood Ranch straddles Manatee and Sarasota
-- counties and most of it posts as Bradenton (34202, 34211, 34212); the
-- Waterside villages on its southern edge post as Sarasota.
--
-- That list is also the largest bill the engine has taken on. The city gate
-- is the first filter, not the last, so the engine will store every Active
-- listing in all three cities whether or not a neighborhood term matches.
-- Bradenton and Sarasota are far bigger markets than Venice or North Port,
-- so expect ls_listings to grow by several thousand rows, most of which no
-- site will ever show -- and the full run to verify all of them nightly.
-- The cursor and the per-pass cap added on 2026-09-17 (migrations aside, PRs
-- #325 and #326) are what make that survivable; watch the first few nightly
-- cycles after this site is switched on.
--
-- THE ROW LANDS INACTIVE AND IN SHADOW MODE, and there is one more gate
-- than the other sites had. Before it is switched on:
--   1. HousesforSale2 has to exist on the site -- Jeff created it on
--      2026-09-17 (duplicate HousesforSale without data, admin-only writes);
--   2. LifeAtLakewoodListingPhotos has to exist in the Media Manager --
--      also created on 2026-09-17. A named folder that does not resolve
--      holds every photo import for the site (migration 046);
--   3. the neighborhoods have to be seeded (migration 058);
--   4. **the terms have to be tested against the market**, which is the new
--      gate. scripts/listings-lakewood-probe.ts asks MLSGrid for every
--      Active listing in the three cities and reports, term by term, what
--      each one would sweep in. Six of this site's terms have no anchor
--      available in the way the MLS writes the name -- aurora, cresswind,
--      del webb, indigo, lake club, palisades -- and a bare word is how
--      Wellen Park put four Englewood listings on a Wellen Park site within
--      minutes of switch-on (migration 056). The other 55 terms were
--      narrowed until the site's own 404 rows still filed correctly; see
--      scripts/listings-lakewood-villages.mjs for the reasoning on each.
--
-- property_types is Residential alone: the live collection's Home Type
-- values are Single Family Residence, Condominium, Townhouse and Villa, all
-- of them RESO PropertySubType values under PropertyType 'Residential'. No
-- land.
--
-- price_sort_style is shorthand, not ranges: the live collection tags prices
-- "$300s", "$400s", "1M+", the same Velo getNumber scheme as Parrish
-- (migration 050) and Wellen Park. Ranges here would leave the price filter
-- matching nothing.
--
-- wix_site_id is not a guess: the floor-plan pipeline has held this site's
-- id since 2026-07-02 (fp_sites, 'Lakewood Ranch').
--
-- ONE DIFFERENCE FROM THE SITE AS IT RUNS TODAY, worth knowing before the
-- comparison is made: 18 of the 404 rows are Coming Soon, not Active. The
-- dashboard chain meant to require Active -- it computes isActive -- but JS
-- precedence binds that `&&` to the last term of the `||` chain alone, so
-- everything except Woodleaf Hammock passed whatever its status. The engine
-- has no such bug and will not stage them (classify). Expect the engine's
-- count to come in about 18 short of the collection's for that reason alone,
-- before new construction is even considered.
--
-- Applied to production via the Supabase MCP on 2026-09-17 as migration
-- listings_lakewood_site, with the site row inactive.
-- ============================================================

INSERT INTO ls_sites (
  name, domain, wix_site_id,
  target_collection_id, live_collection_id, villages_collection_id,
  market_cities, property_types, write_mode, price_sort_style,
  active, media_folder_name
)
VALUES (
  'Life At Lakewood', 'lifeatlakewood.com', '4fbabb96-2d6c-4f20-a240-9223153498b5',
  'HousesforSale2', 'HousesforSale', 'HousesforSale-DynamicPages',
  ARRAY['Lakewood Ranch', 'Bradenton', 'Sarasota'], ARRAY['Residential'], 'shadow', 'shorthand',
  false, 'LifeAtLakewoodListingPhotos'
)
ON CONFLICT (domain) DO NOTHING;
