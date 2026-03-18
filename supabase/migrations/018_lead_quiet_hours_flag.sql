-- Add a flag to record whether a lead arrived during quiet hours.
-- This is stamped at ingestion time so that later changes to quiet-hours
-- settings don't retroactively reclassify historical leads.

ALTER TABLE leads
  ADD COLUMN arrived_during_quiet_hours boolean NOT NULL DEFAULT false;

-- Backfill the single existing quiet-hours lead (arrived ~1:34 AM ET on 2026-03-13).
-- Quiet hours at time of arrival were 23:00–06:30 ET.
UPDATE leads
  SET arrived_during_quiet_hours = true
  WHERE created_at AT TIME ZONE 'America/New_York'
        BETWEEN '2026-03-13 00:00:00' AND '2026-03-13 06:30:00';
