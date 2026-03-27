-- Add a scheduled time for auto-approve to turn on daily (Eastern time, e.g. "08:00")
-- NULL means no schedule (manual toggle only)
ALTER TABLE system_settings
  ADD COLUMN auto_approve_schedule_time TEXT DEFAULT NULL;

COMMENT ON COLUMN system_settings.auto_approve_schedule_time IS 'Time of day (HH:MM Eastern) to automatically enable auto_approve_drafts. NULL = disabled.';
