-- ============================================================
-- 050: how the price filter tag reads, per site (Jeff, 2026-09-16)
--
-- The engine wrote one scheme everywhere: "Under $500k", "$500k - $1M",
-- "$1M - $2M"... That is Longboat Key's, ported from its own pipeline.
-- Life At Parrish's live collection uses the older Velo getNumber scheme
-- instead: "$600s" for a six-figure price, "3M+" above a million. Writing
-- ranges there would leave the site's price filter matching nothing.
-- Caught in the shadow collection before cutover.
-- Applied to production via the Supabase MCP on 2026-09-16 as migration
-- listings_price_sort_style.
-- ============================================================
ALTER TABLE ls_sites
  ADD COLUMN price_sort_style TEXT NOT NULL DEFAULT 'ranges'
  CONSTRAINT ls_sites_price_sort_style_check CHECK (price_sort_style IN ('ranges', 'shorthand'));

COMMENT ON COLUMN ls_sites.price_sort_style IS
  'How listingPriceSort reads on this site: ranges = "Under $500k"/"$1M - $2M" (Longboat Key); shorthand = "$600s"/"3M+" (the older Velo getNumber, Parrish)';

UPDATE ls_sites SET price_sort_style = 'shorthand', updated_at = now()
 WHERE domain = 'lifeatparrish.com';
