-- Add auto-approve toggle to system_settings (global, persisted)
ALTER TABLE system_settings
  ADD COLUMN auto_approve_drafts BOOLEAN NOT NULL DEFAULT false;
