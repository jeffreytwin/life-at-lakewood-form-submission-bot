-- Split quiet_hours_end into weekday and weekend variants.
-- The existing quiet_hours_end column is kept for backward compatibility
-- but the new columns take precedence in application code.

ALTER TABLE system_settings
  ADD COLUMN quiet_hours_end_weekday TEXT NOT NULL DEFAULT '06:30',
  ADD COLUMN quiet_hours_end_weekend TEXT NOT NULL DEFAULT '08:30';

-- Seed the new columns from the existing value (weekend keeps current, weekday is earlier)
UPDATE system_settings
SET quiet_hours_end_weekend = quiet_hours_end,
    quiet_hours_end_weekday = '06:30'
WHERE id = 1;
