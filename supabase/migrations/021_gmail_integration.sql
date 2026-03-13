-- Gmail integration: sent-version tracking + OAuth token fields

-- Track what was actually sent vs. what the AI drafted
ALTER TABLE email_drafts
  ADD COLUMN sent_body_text TEXT,
  ADD COLUMN was_changed BOOLEAN NOT NULL DEFAULT false;

-- Gmail OAuth tokens stored in email_accounts.credentials JSONB:
--   { access_token, refresh_token, token_type, expiry_date, scope }
-- Add sync cursor for incremental polling
ALTER TABLE email_accounts
  ADD COLUMN sync_history_id TEXT,
  ADD COLUMN sent_sync_history_id TEXT;

COMMENT ON COLUMN email_accounts.sync_history_id IS 'Gmail History ID for incremental inbox sync';
COMMENT ON COLUMN email_accounts.sent_sync_history_id IS 'Gmail History ID for incremental sent-folder sync';
COMMENT ON COLUMN email_drafts.sent_body_text IS 'What was actually sent from Gmail (may differ from AI draft body_text)';
COMMENT ON COLUMN email_drafts.was_changed IS 'True if sent_body_text differs from original body_text';
