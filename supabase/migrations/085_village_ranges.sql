-- 085: Village price and square footage ranges (Jeff, 2026-10-26).
--
-- Each village's priceRange, priceRangeDropdown, priceRangeNew and
-- squareFootageRange in the site's villages collection (Lakewood's
-- AmenitiesbyVillage) are kept true to what is for sale: the site's Floor
-- Plans V2 rows plus its live Homes for Sale rows, nothing historical. The
-- job runs when a floor plan sync cycle completes, when approved plans are
-- written, when a listings run changes rows, and every two hours as a
-- safety net (src/lib/villages/sync.ts). It writes nothing until the
-- switch below is on; the preview endpoint works either way.
-- (Applied to production 2026-10-26 via MCP.)

ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS village_ranges_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS village_ranges_state JSONB NOT NULL DEFAULT '{}'::jsonb;
