-- ============================================================
-- 049: photo dimensions, so imported photos get a Wix image URI
-- that Wix can actually render (Jeff, 2026-09-16)
--
-- A Wix image URI needs its origin dimensions:
--   wix:image://v1/<fileId>/<name>#originWidth=1600&originHeight=898
-- The engine's own imports were writing it without the fragment, so Wix
-- refused the gallery: the CMS showed a warning and a broken primary
-- image, and the site's gallery fell back to its editor placeholder — the
-- same stock photo on every affected listing. The photos seeded from the
-- live collection at cutover carried Wix's own URIs, fragment included,
-- which is why only listings the engine imported photos for were wrong.
--
-- Every MLSGrid Media record carries ImageWidth/ImageHeight (48,296 of
-- 48,296 at the time of writing), so nothing has to be re-imported: the
-- dimensions are backfilled here and the URIs are rebuilt from them.
-- Applied to production via the Supabase MCP on 2026-09-16 (21:1x UTC) as
-- migration listings_media_dimensions.
-- ============================================================
ALTER TABLE ls_listing_media
  ADD COLUMN image_width INTEGER,
  ADD COLUMN image_height INTEGER;

COMMENT ON COLUMN ls_listing_media.image_width IS 'MLSGrid Media.ImageWidth; Wix image URIs need originWidth to render';
COMMENT ON COLUMN ls_listing_media.image_height IS 'MLSGrid Media.ImageHeight; Wix image URIs need originHeight to render';

UPDATE ls_listing_media lm
   SET image_width = (e->>'ImageWidth')::int,
       image_height = (e->>'ImageHeight')::int
  FROM ls_listings l, LATERAL jsonb_array_elements(l.raw->'Media') e
 WHERE l.listing_id = lm.listing_id
   AND jsonb_typeof(l.raw->'Media') = 'array'
   AND e->>'MediaKey' = lm.media_key
   AND (e->>'ImageWidth') IS NOT NULL
   AND (e->>'ImageHeight') IS NOT NULL;
