-- Add photo_thumb_url columns so we can serve small thumbnails in list
-- views without downloading the full-resolution original.
ALTER TABLE agents ADD COLUMN photo_thumb_url TEXT;
ALTER TABLE locations ADD COLUMN photo_thumb_url TEXT;
