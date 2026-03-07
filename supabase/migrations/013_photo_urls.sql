-- Add photo_url columns for agents and locations
ALTER TABLE agents ADD COLUMN photo_url TEXT;
ALTER TABLE locations ADD COLUMN photo_url TEXT;
