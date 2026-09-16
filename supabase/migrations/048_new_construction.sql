-- ============================================================
-- 048: new construction is not shown (Jeff, 2026-09-16)
-- The old Velo pipelines never carried builder inventory (their id lists
-- were hand-picked); the engine, which takes every Active listing in the
-- market, staged 426 new-construction homes for Parrish. Decision: exclude
-- NewConstructionYN listings on every site, with a per-site switch so a
-- site can opt back in without a code change.
-- Applied to production via the Supabase MCP on 2026-09-16 (19:29 UTC) as
-- migration listings_new_construction.
-- ============================================================
ALTER TABLE ls_listings ADD COLUMN new_construction BOOLEAN;  -- RESO NewConstructionYN; null = the record does not say
COMMENT ON COLUMN ls_listings.new_construction IS 'RESO NewConstructionYN as received; classify: new_construction';

UPDATE ls_listings
   SET new_construction = (raw->>'NewConstructionYN')::boolean
 WHERE raw ? 'NewConstructionYN' AND raw->>'NewConstructionYN' IN ('true', 'false');

ALTER TABLE ls_sites ADD COLUMN show_new_construction BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN ls_sites.show_new_construction IS 'Show builder listings (NewConstructionYN)? Off on every site since 2026-09-16';

ALTER TABLE ls_site_listings DROP CONSTRAINT IF EXISTS ls_site_listings_reason_code_check;
ALTER TABLE ls_site_listings ADD CONSTRAINT ls_site_listings_reason_code_check CHECK (reason_code IS NULL OR reason_code IN (
  'status_change', 'property_type', 'no_village', 'city_change',
  'mls_revoked', 'not_in_feed', 'new_construction', 'manual_refresh'
));
