-- Every picture the write-back puts on a row is first seen held by Wix
-- (GET /site-media/v1/files/{id}: an image, import READY, with a size);
-- verified_at records that, so a picture is asked about once. media_type
-- is Wix's word for what it filed: IMAGE, or VECTOR for an SVG imported
-- as-is before 2026-09-20, which never renders in a gallery and is
-- re-imported as a PNG. (Applied to production 2026-09-20 via MCP.)
ALTER TABLE fp_media_map ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE fp_media_map ADD COLUMN IF NOT EXISTS media_type TEXT;
