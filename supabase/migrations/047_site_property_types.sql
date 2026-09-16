-- ============================================================
-- 047: which RESO PropertyType values a site shows
-- Jeff, 2026-09-16: vacant land is shown on Life in Longboat Key only; every
-- other site shows Residential alone for now. Until here the allowed types
-- were one constant for all sites (Residential and Land).
-- Applied to production via the Supabase MCP on 2026-09-16 (17:58 UTC) as
-- migration listings_site_property_types.
-- ============================================================
ALTER TABLE ls_sites
  ADD COLUMN property_types TEXT[] NOT NULL DEFAULT ARRAY['Residential']
  CONSTRAINT ls_sites_property_types_nonempty CHECK (cardinality(property_types) > 0);

UPDATE ls_sites SET property_types = ARRAY['Residential', 'Land'], updated_at = now()
 WHERE domain = 'lifeinlongboatkey.com';
