-- Quiet hours: defer follow-up sequences during nighttime hours.
-- Leads arriving during quiet hours are still assigned and the initial SMS is sent,
-- but the follow-up timeout is deferred until quiet_hours_end the next morning.

ALTER TABLE system_settings
  ADD COLUMN quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN quiet_hours_start TEXT NOT NULL DEFAULT '21:00',
  ADD COLUMN quiet_hours_end TEXT NOT NULL DEFAULT '08:30';
