-- ============================================================
-- 064: floor plan photo dimensions, so the write-back's Wix image URIs
--      are ones Wix can render
--
-- A Wix image URI needs its origin dimensions:
--   wix:image://v1/<fileId>/<name>#originWidth=1920&originHeight=1240
-- The listings engine found this on 2026-09-16 (migration 049): without
-- the fragment Wix refuses the field, the CMS shows a broken primary
-- image, and the site's gallery falls back to its editor placeholder. The
-- floor plan write-back was writing the same dimension-less URIs, and the
-- 24 rows in fp_media_map (the ten Toll Brothers drafts on Lakewood) are
-- all of that shape.
--
-- Builder photos carry no size metadata, so the write-back now fetches and
-- measures each photo before Wix imports it, stores the size here, and
-- rebuilds the URI from these columns on every use. The 24 existing rows
-- keep their Wix file id and are measured the next time a change that
-- touches them is approved; content_hash, unused until now, is filled the
-- same way.
-- (Applied to production 2026-09-18 via the Supabase MCP as
-- floor_plan_media_dimensions.)
-- ============================================================
ALTER TABLE fp_media_map
  ADD COLUMN width INTEGER,
  ADD COLUMN height INTEGER;

COMMENT ON COLUMN fp_media_map.width IS 'Pixel width of the imported photo; Wix image URIs need originWidth to render';
COMMENT ON COLUMN fp_media_map.height IS 'Pixel height of the imported photo; Wix image URIs need originHeight to render';
