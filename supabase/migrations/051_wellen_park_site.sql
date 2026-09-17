-- ============================================================
-- 051: Life in Wellen Park onboarding (the site row)
--
-- The third listings site, and the first whose market is not one city.
-- Wellen Park is a master-planned community the size of a town, straddling
-- Sarasota County and the City of North Port, so the MLS files its homes
-- under whichever postal city the address falls in: Venice for most of it
-- (34293), North Port on its eastern side, Englewood for the neighborhoods
-- the site carries down there (Boca Royale). Jeff, 2026-09-17: Englewood,
-- North Port and Venice, and add more if the engine turns any up.
--
-- A wide city list is safe because the city is only the first gate: a
-- listing still has to match one of the site's neighborhood terms to reach
-- the site (classify, plan decision 5), and the terms for a community like
-- this one name the community. It is not free, though -- the engine stores
-- every Active listing in a market city, so these three cities put a few
-- thousand rows in ls_listings that no site will show, and the Hub's
-- unmatched view for this site is correspondingly noisier than Longboat
-- Key's or Parrish's. Watch the run counts after the first discovery; the
-- city list is one UPDATE away from narrower.
--
-- The row lands INACTIVE and in shadow mode. Before it is switched on:
--   1. HousesforSale2 has to exist on the site (duplicate HousesforSale
--      without data, admin-only writes), as on Longboat Key and Parrish;
--   2. the Media Manager folder below has to exist, or every photo import
--      holds with a folder_missing error (migration 046);
--   3. the neighborhoods have to be seeded -- POST
--      /api/internal/listings/villages/import with
--      { siteId, source: "site-collections" }, which reads the site's own
--      Neighborhoods collection and derives each one's subdivision terms
--      from the listings it is already showing. This site has no Villages
--      collection to import the Longboat Key way.
--
-- price_sort_style is shorthand, not ranges: the site's live collection
-- tags prices "$300s", "$400s", "1M+", "2M+" (the older Velo getNumber),
-- the same scheme Parrish needed in migration 050. Ranges here would leave
-- the price filter matching nothing.
--
-- Applied to production via the Supabase MCP on 2026-09-17 as migration
-- listings_wellen_park_site, with the site row inactive. Two of its values
-- were read off the site's own pages rather than the live API (this
-- session's egress policy blocks Wix and lifeinwellenpark.com): the market
-- cities, and the price scheme. scripts/listings-wellen-probe.mjs confirms
-- both against the live collection from a Vercel build, and reports the
-- shadow collection and the media folder while it is there.
-- ============================================================

INSERT INTO ls_sites (
  name, domain, wix_site_id,
  target_collection_id, live_collection_id, villages_collection_id,
  market_cities, property_types, write_mode, price_sort_style,
  active, media_folder_name
)
VALUES (
  'Life in Wellen Park', 'lifeinwellenpark.com', '1a8c2755-823e-4882-ae32-e6c108a30e39',
  'HousesforSale2', 'HousesforSale', 'HousesforSale-DynamicPages',
  ARRAY['Venice', 'North Port', 'Englewood'], ARRAY['Residential'], 'shadow', 'shorthand',
  false, 'WellenParkListingPhotos'
)
ON CONFLICT (domain) DO NOTHING;
